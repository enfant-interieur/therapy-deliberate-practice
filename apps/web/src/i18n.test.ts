import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "./locales/en/common.json";
import fr from "./locales/fr/common.json";

const collectLocaleKeys = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectLocaleKeys(entry, `${prefix}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectLocaleKeys(entry, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
};

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

const resolveLocalTsxImport = (
  containingFile: string,
  importPath: string,
): string | null => {
  if (!importPath.startsWith(".")) return null;
  const base = path.resolve(path.dirname(containingFile), importPath);
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const collectRouteOwnedSources = () => {
  const discovered = new Set<string>();

  const visitFile = (absolutePath: string) => {
    if (discovered.has(absolutePath)) return;
    discovered.add(absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    const file = ts.createSourceFile(
      absolutePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    for (const statement of file.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const imported = resolveLocalTsxImport(
          absolutePath,
          statement.moduleSpecifier.text,
        );
        if (imported) visitFile(imported);
      }
    }
    for (const match of source.matchAll(/import\(["']([^"']+)["']\)/g)) {
      const imported = resolveLocalTsxImport(absolutePath, match[1]);
      if (imported) visitFile(imported);
    }
  };

  visitFile(path.join(sourceRoot, "routes.tsx"));
  visitFile(path.join(sourceRoot, "components/admin/AdminTasksPage.tsx"));
  return [...discovered]
    .map((absolutePath) => path.relative(sourceRoot, absolutePath))
    .sort();
};

const auditedSources = collectRouteOwnedSources();

const collectInterpolationTokens = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectInterpolationTokens(entry, `${prefix}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectInterpolationTokens(entry, prefix ? `${prefix}.${key}` : key),
    );
  }
  if (typeof value !== "string") return [];

  const tokens = [...value.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort();
  return tokens.map((token) => `${prefix}:${token}`);
};

const collectLiteralTranslationKeys = (relativePath: string) => {
  const source = fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
  const file = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const keys: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      keys.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return keys;
};

const localeHasKey = (locale: unknown, key: string) => {
  const segments = key.split(".");
  let current = locale;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      const pluralKey = `${segments.at(-1)}_one`;
      if (
        segment === segments.at(-1) &&
        current &&
        typeof current === "object" &&
        pluralKey in current
      ) {
        return true;
      }
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
};

const findRawUserFacingStrings = (relativePath: string) => {
  const source = fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
  const file = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const visibleAttributeNames = new Set([
    "alt",
    "aria-label",
    "placeholder",
    "title",
  ]);
  const isUserFacingAttributeName = (name: string) =>
    visibleAttributeNames.has(name) ||
    /(?:Label|Title|Subtitle|Description|Message|Reason)$/.test(name);
  const userFacingPropertyNames = new Set([
    "description",
    "helper",
    "label",
    "message",
    "placeholder",
    "rawMessage",
    "recommendedAction",
    "response_text",
    "summary_feedback",
    "subtitle",
    "title",
    "what_to_improve_next",
  ]);
  const userFacingCallNames = new Set([
    "setError",
    "setMessage",
    "setPromptExhaustedMessage",
    "setStatus",
    "setSubmitError",
    "setTranscriptionError",
  ]);
  const technicalOnlyStrings = new Set([
    "Apple Metal",
    "CPU",
    "HTTP …",
    "Invalid reader result",
    "Linux (x64)",
    "macOS (Apple silicon)",
    "macOS (Intel)",
    "NVIDIA CUDA",
    "useToast must be used within ToastProvider",
    "Windows (x64)",
  ]);
  const isLikelyUserFacing = (text: string) =>
    /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text) &&
    (/\s/.test(text) || /^[A-ZÀ-Ý]/.test(text)) &&
    !/^(?:https?:\/\/|\/api\/|[a-z][\w-]*(?:\.[\w-]+)+$)/.test(text);
  const location = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const addFinding = (node: ts.Node, text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (
      isLikelyUserFacing(normalized) &&
      !technicalOnlyStrings.has(normalized)
    ) {
      findings.push(`${relativePath}:${location(node)}: ${normalized}`);
    }
  };
  const isTranslationArgument = (node: ts.Node) => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isStatement(current)) {
      if (
        ts.isCallExpression(current) &&
        ts.isIdentifier(current.expression) &&
        current.expression.text === "t"
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  };
  const stringValue = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      return [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].join("…");
    }
    return null;
  };
  const inspectExpression = (expression: ts.Node) => {
    const value = stringValue(expression);
    if (value && !isTranslationArgument(expression)) {
      addFinding(expression, value);
    }
    if (ts.isConditionalExpression(expression)) {
      inspectExpression(expression.whenTrue);
      inspectExpression(expression.whenFalse);
    } else if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      inspectExpression(expression.left);
      inspectExpression(expression.right);
    } else if (ts.isArrayLiteralExpression(expression)) {
      expression.elements.forEach(inspectExpression);
    } else if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      inspectExpression(expression.expression);
    }
  };
  const enclosingReturnName = (node: ts.ReturnStatement) => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text;
      }
      if (
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isVariableDeclaration(current.parent) &&
        ts.isIdentifier(current.parent.name)
      ) {
        return current.parent.name.text;
      }
      if (
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isCallExpression(current.parent) &&
        ts.isVariableDeclaration(current.parent.parent) &&
        ts.isIdentifier(current.parent.parent.name)
      ) {
        return current.parent.parent.name.text;
      }
      current = current.parent;
    }
    return "";
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      addFinding(node, node.text);
    }
    if (
      ts.isJsxAttribute(node) &&
      isUserFacingAttributeName(node.name.getText(file)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      !isTranslationArgument(node.initializer)
    ) {
      addFinding(node, node.initializer.text);
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      userFacingPropertyNames.has(node.name.text)
    ) {
      if (node.initializer) inspectExpression(node.initializer);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:copy|labels?)$/i.test(node.name.text) &&
      node.initializer
    ) {
      if (ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) {
          if (ts.isPropertyAssignment(property)) {
            inspectExpression(property.initializer);
          }
        }
      } else {
        inspectExpression(node.initializer);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      userFacingCallNames.has(node.expression.text)
    ) {
      if (node.arguments[0]) inspectExpression(node.arguments[0]);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text.endsWith("Error")
    ) {
      const argument = node.arguments?.[0];
      if (argument) inspectExpression(argument);
    }
    if (ts.isReturnStatement(node) && node.expression) {
      const returnName = enclosingReturnName(node);
      if (
        /(?:error|message|feedback|action|label|description)/i.test(returnName)
      ) {
        inspectExpression(node.expression);
      }
    }
    if (ts.isJsxExpression(node) && node.expression) {
      if (
        ts.isJsxAttribute(node.parent) &&
        !isUserFacingAttributeName(node.parent.name.getText(file))
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      inspectExpression(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
};

describe("web locale integrity", () => {
  it("keeps recursive English and French locale keys in exact parity", () => {
    expect(collectLocaleKeys(fr).sort()).toEqual(collectLocaleKeys(en).sort());
  });

  it("keeps interpolation placeholders in exact English and French parity", () => {
    expect(collectInterpolationTokens(fr).sort()).toEqual(
      collectInterpolationTokens(en).sort(),
    );
  });

  it("derives the complete audited surface from routes and its local components", () => {
    expect(auditedSources).toEqual(
      expect.arrayContaining([
        "routes.tsx",
        "components/AppShell.tsx",
        "pages/PracticePage.tsx",
        "pages/MinigamesPage.tsx",
        "pages/AdminPortalPage.tsx",
        "pages/AdminLibraryPage.tsx",
        "pages/AdminParseTaskPage.tsx",
        "pages/AdminTaskEditPage.tsx",
        "components/admin/AdminTasksPage.tsx",
      ]),
    );
  });

  it("resolves every literal translation key used by a routed surface", () => {
    const missing = auditedSources.flatMap((relativePath) =>
      collectLiteralTranslationKeys(relativePath)
        .filter((key) => !localeHasKey(en, key))
        .map((key) => `${relativePath}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("keeps every route-owned surface free of raw interface strings", () => {
    expect(auditedSources.flatMap(findRawUserFacingStrings)).toEqual([]);
  });
});
