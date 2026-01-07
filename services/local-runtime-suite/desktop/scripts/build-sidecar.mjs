import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = path.resolve(desktopDir, "..", "python");
const tauriDir = path.resolve(desktopDir, "src-tauri");
const binariesDir = path.resolve(tauriDir, "binaries");
const resourcesDir = path.resolve(tauriDir, "resources");
const runtimeOutDir = path.resolve(resourcesDir, "local-runtime-python");

const venvDir = path.resolve(pythonRoot, ".venv-tauri");
const stampPath = path.resolve(venvDir, ".deps.stamp.json");

const targetByPlatform = {
  darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
  linux: { arm64: "aarch64-unknown-linux-gnu", x64: "x86_64-unknown-linux-gnu" },
  win32: { arm64: "aarch64-pc-windows-msvc", x64: "x86_64-pc-windows-msvc" },
};

const exeSuffix = process.platform === "win32" ? ".exe" : "";
const sidecarName = "local-runtime-gateway";

const explicitTarget =
  process.env.LOCAL_RUNTIME_SIDECAR_TARGET ?? process.env.TAURI_TARGET ?? process.env.CARGO_BUILD_TARGET;

const venvPython =
  process.platform === "win32"
    ? path.resolve(venvDir, "Scripts", "python.exe")
    : path.resolve(venvDir, "bin", "python");

function banner(step, total, message) {
  console.log(`(${step}/${total}) ${message}`);
}

function runCommand(label, executable, args, options) {
  const cwd = options?.cwd ?? process.cwd();
  try {
    execFileSync(executable, args, { stdio: "inherit", ...options });
  } catch (error) {
    const commandLine = [executable, ...args].join(" ");
    const details = [
      `${label} failed.`,
      `Interpreter: ${executable}`,
      `Working directory: ${cwd}`,
      `Command: ${commandLine}`,
      `Retry: (cd ${cwd} && ${commandLine})`,
    ];
    if (error instanceof Error && error.message) details.push(`Error: ${error.message}`);
    throw new Error(details.join("\n"));
  }
}

function resolveHostTarget() {
  const platformTargets = targetByPlatform[process.platform];
  if (!platformTargets) throw new Error(`Unsupported platform: ${process.platform}`);
  const target = platformTargets[process.arch];
  if (!target) throw new Error(`Unsupported architecture: ${process.arch}`);
  return target;
}

function resolveTarget() {
  return explicitTarget ?? resolveHostTarget();
}

function readPythonVersion(executable) {
  const version = execFileSync(
    executable,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"],
    { encoding: "utf8" },
  ).trim();
  const [major, minor] = version.split(".").map((v) => Number(v));
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 3 || (major === 3 && minor < 10)) {
    throw new Error(`Python ${version} is too old.`);
  }
  return version;
}

function resolveSystemPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push(process.env.PYTHON);
  else if (process.platform === "win32") candidates.push("python");
  else candidates.push("python3.12", "python3.11", "python3.10", "python3");

  for (const c of candidates) {
    try {
      const version = readPythonVersion(c);
      return { path: c, version };
    } catch {}
  }
  throw new Error("Python 3.10+ is required (prefer 3.11–3.12). Set PYTHON if needed.");
}

function computeStamp(pyprojectHash, pythonVersion) {
  return JSON.stringify({ pyprojectHash, pythonVersion }, null, 2);
}

function loadStamp() {
  if (!existsSync(stampPath)) return null;
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function hashPyproject() {
  const pyprojectPath = path.resolve(pythonRoot, "pyproject.toml");
  const contents = readFileSync(pyprojectPath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function ensureVenv() {
  if (!existsSync(venvDir)) {
    const systemPython = resolveSystemPython();
    runCommand("Virtual environment creation", systemPython.path, ["-m", "venv", venvDir], { cwd: pythonRoot });
  }
  if (!existsSync(venvPython)) throw new Error(`Expected venv python at ${venvPython}, but it was not found.`);
}

function syncBuildVenv() {
  banner(2, 5, "Preparing build venv...");
  const pyprojectHash = hashPyproject();
  const pythonVersion = readPythonVersion(venvPython);
  const stamp = loadStamp();
  if (stamp?.pyprojectHash === pyprojectHash && stamp?.pythonVersion === pythonVersion) {
    console.log("Build venv unchanged; skipping.");
    return;
  }
  runCommand("Pip upgrade", venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: pythonRoot,
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
  });
  runCommand("Certifi install", venvPython, ["-m", "pip", "install", "--upgrade", "certifi"], {
    cwd: pythonRoot,
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
  });
  writeFileSync(stampPath, computeStamp(pyprojectHash, pythonVersion));
}

function buildPortableRuntime(target) {
  banner(3, 5, "Building embedded Python runtime (installing from pyproject.toml)...");
  mkdirSync(resourcesDir, { recursive: true });
  rmSync(runtimeOutDir, { recursive: true, force: true });

  runCommand(
    "Build portable runtime",
    venvPython,
    ["-m", "tools.build_portable_sidecar", "--project-root", pythonRoot, "--runtime-root", runtimeOutDir, "--force"],
    {
      cwd: pythonRoot,
      env: {
        ...process.env,
        LOCAL_RUNTIME_SIDECAR_TARGET: target,
        PYTHONNOUSERSITE: "1",
        PYTHONPATH: pythonRoot,
      },
    },
  );
}

function buildRustLauncher(target) {
  banner(4, 5, "Building Rust sidecar launcher...");
  runCommand(
    "Cargo build launcher",
    "cargo",
    ["build", "--manifest-path", path.resolve(tauriDir, "Cargo.toml"), "--bin", sidecarName, "--target", target],
    { cwd: tauriDir, env: { ...process.env } },
  );

  const builtPath = path.resolve(tauriDir, "target", target, "debug", `${sidecarName}${exeSuffix}`);
  if (!existsSync(builtPath)) throw new Error(`Expected launcher at ${builtPath} but it was not produced.`);

  mkdirSync(binariesDir, { recursive: true });
  const devOutPath = path.resolve(binariesDir, `${sidecarName}${exeSuffix}`);
  const targetOutPath = path.resolve(binariesDir, `${sidecarName}-${target}${exeSuffix}`);
  for (const outPath of [devOutPath, targetOutPath]) {
    rmSync(outPath, { force: true });
    cpSync(builtPath, outPath);
    if (process.platform !== "win32") chmodSync(outPath, 0o755);
  }
  return devOutPath;
}

async function main() {
  const target = resolveTarget();
  banner(1, 5, `Preparing sidecar for ${target} (NO PyInstaller)...`);
  ensureVenv();
  syncBuildVenv();
  buildPortableRuntime(target);
  const out = buildRustLauncher(target);
  banner(5, 5, `Sidecar ready: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
