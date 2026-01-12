import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function stripInlineComments(line) {
  let inSingle = false;
  let inDouble = false;
  let result = "";
  for (const char of line) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      result += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      break;
    }
    result += char;
  }
  return result;
}

export function loadReleaseEnvFiles(repoRoot) {
  const envFiles = [".env.release", ".env.release.local"];
  let loadedAny = false;
  for (const relPath of envFiles) {
    const filePath = path.join(repoRoot, relPath);
    if (!existsSync(filePath)) {
      continue;
    }
    console.log(`Loading release environment: ${relPath}`);
    loadedAny = true;
    const contents = readFileSync(filePath, "utf8");
    const lines = contents.split(/\r?\n/);
    for (const rawLine of lines) {
      let line = stripInlineComments(rawLine);
      line = line.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      if (line.startsWith("export ")) {
        line = line.slice(7).trim();
      }
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      const key = line.slice(0, eqIndex).trim();
      if (!key) {
        continue;
      }
      let value = line.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
  if (!loadedAny) {
    console.warn(
      "No .env.release files found. Copy .env.release.example to .env.release to inject release secrets and remote builder settings.",
    );
  }
}
