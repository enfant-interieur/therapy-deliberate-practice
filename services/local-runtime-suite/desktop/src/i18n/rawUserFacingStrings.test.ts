import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const AUDITED_SOURCES = [
  new URL("../App.tsx", import.meta.url),
  new URL("../components/GatewayLaunchButton.tsx", import.meta.url),
  new URL("../hooks/useGatewayBoot.ts", import.meta.url)
];
const TECHNICAL_TEXT = new Set(["LLM", "STT", "Port", "ms"]);

describe("bounded desktop raw user-facing string guard", () => {
  it.each(AUDITED_SOURCES)("keeps JSX copy in locale resources: %s", (url) => {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const parsed = ts.createSourceFile(
      fileURLToPath(url),
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const rawText: string[] = [];
    const rawAccessibleAttributes: string[] = [];
    const rawUserFacingExpressions: string[] = [];
    const isRawCopy = (node: ts.Node | undefined) =>
      Boolean(
        node &&
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateExpression(node)) &&
          /[A-Za-zÀ-ÿ]/.test(node.getText(parsed))
      );
    const inspect = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (/[A-Za-zÀ-ÿ]/.test(text) && !TECHNICAL_TEXT.has(text)) rawText.push(text);
      }
      if (
        ts.isJsxAttribute(node) &&
        ["aria-label", "title", "placeholder", "alt"].includes(node.name.getText(parsed)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[A-Za-zÀ-ÿ]/.test(node.initializer.text)
      ) {
        rawAccessibleAttributes.push(node.initializer.text);
      }
      if (ts.isCallExpression(node)) {
        const callName = node.expression.getText(parsed);
        if (
          ["logEvent", "setPortSaveError", "window.confirm"].includes(callName) &&
          isRawCopy(node.arguments[0])
        ) {
          rawUserFacingExpressions.push(node.getText(parsed));
        }
      }
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(parsed) === "Error" &&
        isRawCopy(node.arguments?.[0])
      ) {
        rawUserFacingExpressions.push(node.getText(parsed));
      }
      if (
        ts.isPropertyAssignment(node) &&
        ["error", "preview"].includes(node.name.getText(parsed)) &&
        isRawCopy(node.initializer)
      ) {
        rawUserFacingExpressions.push(node.getText(parsed));
      }
      if (
        ts.isVariableDeclaration(node) &&
        ["message", "recovery"].includes(node.name.getText(parsed)) &&
        isRawCopy(node.initializer)
      ) {
        rawUserFacingExpressions.push(node.getText(parsed));
      }
      ts.forEachChild(node, inspect);
    };
    inspect(parsed);

    expect(rawText).toEqual([]);
    expect(rawAccessibleAttributes).toEqual([]);
    expect(rawUserFacingExpressions).toEqual([]);
  });

  it("routes confirmation dialogs through translations", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../App.tsx", import.meta.url)),
      "utf8"
    );
    expect(source).not.toMatch(/window\.confirm\(\s*["'`]/);
  });

  it("keeps native Doctor results as stable codes and technical data", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src-tauri/src/main.rs", import.meta.url)),
      "utf8"
    );
    const doctorSource = source.slice(
      source.indexOf("fn gateway_doctor("),
      source.indexOf("#[tauri::command]\nfn gateway_models")
    );

    expect(doctorSource).not.toMatch(/"title"\s*:/);
    expect(doctorSource).not.toMatch(/"fix"\s*:/);
    expect(doctorSource).toContain('"code": "gateway_configuration"');
    expect(doctorSource).toContain('"code": "gateway_health"');
  });

  it("preserves deterministic accessible state and reduced-motion contracts", () => {
    const app = readFileSync(
      fileURLToPath(new URL("../App.tsx", import.meta.url)),
      "utf8"
    );
    const styles = readFileSync(
      fileURLToPath(new URL("../styles.css", import.meta.url)),
      "utf8"
    );

    expect(app).toContain('role="dialog"');
    expect(app).toContain('aria-modal="true"');
    expect(app).toContain('aria-label={t("accessibility.languageSelect")}');
    expect(app).toContain('<div className="error-banner" role="alert">');
    const reducedMotionRule = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)")
    );
    expect(reducedMotionRule).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(reducedMotionRule).toContain(
      "transition-duration: 0.01ms !important"
    );
    expect(reducedMotionRule).toContain(
      "animation-duration: 0.01ms !important"
    );
    expect(reducedMotionRule).toContain(
      "animation-iteration-count: 1 !important"
    );
    for (const animationBearingControl of [
      ".hero-glow",
      ".simple-step",
      ".launch-btn",
      ".launch-btn--busy::before",
      ".launch-btn--busy .launch-btn__shimmer",
      ".launch-btn__message",
      ".launch-gradientText",
      ".launch-spinner-head"
    ]) {
      expect(styles, animationBearingControl).toContain(animationBearingControl);
    }
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("overflow-wrap: anywhere");
  });
});
