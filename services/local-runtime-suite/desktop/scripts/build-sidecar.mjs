import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = path.resolve(desktopDir, "..", "python");
const binariesDir = path.resolve(desktopDir, "src-tauri", "binaries");

const targetByPlatform = {
  darwin: {
    arm64: "aarch64-apple-darwin",
    x64: "x86_64-apple-darwin",
  },
  linux: {
    arm64: "aarch64-unknown-linux-gnu",
    x64: "x86_64-unknown-linux-gnu",
  },
  win32: {
    arm64: "aarch64-pc-windows-msvc",
    x64: "x86_64-pc-windows-msvc",
  },
};

const platformTargets = targetByPlatform[process.platform];
if (!platformTargets) {
  throw new Error(`Unsupported platform: ${process.platform}`);
}

const target = platformTargets[process.arch];
if (!target) {
  throw new Error(`Unsupported architecture: ${process.arch}`);
}

const exeSuffix = process.platform === "win32" ? ".exe" : "";
const sidecarName = "local-runtime-gateway";
const distPath = path.resolve(pythonRoot, "dist", `${sidecarName}${exeSuffix}`);
const outputName = `${sidecarName}-${target}${exeSuffix}`;
const outputPath = path.resolve(binariesDir, outputName);

mkdirSync(binariesDir, { recursive: true });
rmSync(path.resolve(pythonRoot, "dist"), { recursive: true, force: true });
rmSync(path.resolve(pythonRoot, "build"), { recursive: true, force: true });

const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

execFileSync(
  python,
  [
    "-m",
    "PyInstaller",
    "--clean",
    "--onefile",
    "--name",
    sidecarName,
    path.resolve(pythonRoot, "local_runtime", "main.py"),
  ],
  {
    stdio: "inherit",
    cwd: pythonRoot,
    env: {
      ...process.env,
      PYTHONPATH: pythonRoot,
    },
  },
);

if (!existsSync(distPath)) {
  throw new Error(`Expected sidecar binary at ${distPath}, but it was not produced.`);
}

cpSync(distPath, outputPath);
console.log(`Sidecar built at ${outputPath}`);
