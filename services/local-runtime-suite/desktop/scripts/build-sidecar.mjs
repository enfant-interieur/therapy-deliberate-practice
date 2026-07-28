import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = path.resolve(desktopDir, "..", "python");
const tauriDir = path.resolve(desktopDir, "src-tauri");
const binariesDir = path.resolve(tauriDir, "binaries");
const runtimeOutDir = path.resolve(tauriDir, "resources", "local-runtime-python");
const assetManifest = path.resolve(pythonRoot, "python-runtime-assets.json");
const sidecarName = "local-runtime-gateway";
const force = process.argv.includes("--force");

const targetByPlatform = {
  darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
  linux: { arm64: "aarch64-unknown-linux-gnu", x64: "x86_64-unknown-linux-gnu" },
  win32: { arm64: "aarch64-pc-windows-msvc", x64: "x86_64-pc-windows-msvc" },
};

function banner(step, total, message) {
  console.log(`(${step}/${total}) ${message}`);
}

function runCommand(label, executable, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  try {
    execFileSync(executable, args, { stdio: "inherit", ...options });
  } catch (error) {
    const commandLine = [executable, ...args].join(" ");
    const details = [
      `${label} failed.`,
      `Executable: ${executable}`,
      `Working directory: ${cwd}`,
      `Command: ${commandLine}`,
    ];
    if (error instanceof Error && error.message) details.push(`Error: ${error.message}`);
    throw new Error(details.join("\n"));
  }
}

function hostTarget() {
  const target = targetByPlatform[process.platform]?.[process.arch];
  if (!target) throw new Error(`Unsupported build host: ${process.platform} ${process.arch}`);
  return target;
}

function resolveTarget() {
  const requested =
    process.env.LOCAL_RUNTIME_SIDECAR_TARGET ??
    process.env.TAURI_TARGET ??
    process.env.CARGO_BUILD_TARGET ??
    hostTarget();
  if (requested !== hostTarget()) {
    throw new Error(
      `Sidecars must be built natively: host is ${hostTarget()}, requested ${requested}.`,
    );
  }
  return requested;
}

function readPythonVersion(executable) {
  return execFileSync(
    executable,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: "utf8" },
  ).trim();
}

function resolvePython() {
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === "win32"
      ? ["python"]
      : ["python3.12", "python3"];
  for (const candidate of candidates) {
    try {
      if (readPythonVersion(candidate) === "3.12") return candidate;
    } catch {
      // Try the next explicit candidate.
    }
  }
  try {
    const uvPython = execFileSync(process.env.UV ?? "uv", ["python", "find", "3.12"], {
      encoding: "utf8",
    }).trim();
    if (uvPython && readPythonVersion(uvPython) === "3.12") return uvPython;
  } catch {
    // Fall through to the actionable requirement below.
  }
  throw new Error("Python 3.12 is required to build the pinned portable runtime. Set PYTHON.");
}

function assertUvAvailable() {
  try {
    execFileSync(process.env.UV ?? "uv", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("uv is required to export services/local-runtime-suite/python/uv.lock.");
  }
}

function sha256(pathname) {
  return crypto.createHash("sha256").update(readFileSync(pathname)).digest("hex");
}

function appVersion() {
  const packageVersion = JSON.parse(
    readFileSync(path.resolve(desktopDir, "package.json"), "utf8"),
  ).version;
  const tauriVersion = JSON.parse(
    readFileSync(path.resolve(tauriDir, "tauri.conf.json"), "utf8"),
  ).version;
  if (packageVersion !== tauriVersion) {
    throw new Error(`Desktop version mismatch: package=${packageVersion}, Tauri=${tauriVersion}.`);
  }
  return packageVersion;
}

function buildPortableRuntime(target, python) {
  banner(2, 4, "Building the verified, dependency-locked Python runtime...");
  const args = [
    "-m",
    "tools.build_portable_sidecar",
    "--project-root",
    pythonRoot,
    "--runtime-root",
    runtimeOutDir,
    "--asset-manifest",
    assetManifest,
    "--target",
    target,
  ];
  if (force) args.push("--force");
  runCommand("Portable runtime build", python, args, {
    cwd: pythonRoot,
    env: {
      ...process.env,
      LOCAL_RUNTIME_SIDECAR_TARGET: target,
      PYTHONNOUSERSITE: "1",
      PYTHONPATH: pythonRoot,
    },
  });
}

function buildRustLauncher(target) {
  banner(3, 4, "Building the release-mode Rust sidecar launcher...");
  runCommand(
    "Rust sidecar launcher build",
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      path.resolve(tauriDir, "Cargo.toml"),
      "--bin",
      sidecarName,
      "--features",
      "sidecar-launcher",
      "--target",
      target,
    ],
    { cwd: tauriDir, env: { ...process.env } },
  );

  const executableSuffix = process.platform === "win32" ? ".exe" : "";
  const builtPath = path.resolve(
    tauriDir,
    "target",
    target,
    "release",
    `${sidecarName}${executableSuffix}`,
  );
  if (!existsSync(builtPath)) {
    throw new Error(`Rust launcher was not produced at ${builtPath}.`);
  }
  mkdirSync(binariesDir, { recursive: true });
  const outputs = [
    path.resolve(binariesDir, `${sidecarName}${executableSuffix}`),
    path.resolve(binariesDir, `${sidecarName}-${target}${executableSuffix}`),
  ];
  for (const output of outputs) {
    rmSync(output, { force: true });
    cpSync(builtPath, output);
    if (process.platform !== "win32") chmodSync(output, 0o755);
  }
  return outputs[1];
}

function sealProvenance(target, launcherPath) {
  const provenancePath = path.resolve(runtimeOutDir, "build-provenance.json");
  if (!existsSync(provenancePath)) {
    throw new Error(`Portable runtime provenance is missing: ${provenancePath}`);
  }
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  const sealed = {
    ...provenance,
    app_version: appVersion(),
    launcher_target: target,
    launcher_sha256: sha256(launcherPath),
  };
  writeFileSync(provenancePath, `${JSON.stringify(sealed, null, 2)}\n`);
}

function main() {
  const target = resolveTarget();
  const python = resolvePython();
  banner(1, 4, `Preparing a native sidecar for ${target} with Python ${readPythonVersion(python)}.`);
  assertUvAvailable();
  buildPortableRuntime(target, python);
  const launcherPath = buildRustLauncher(target);
  sealProvenance(target, launcherPath);
  banner(4, 4, `Verified sidecar ready: ${launcherPath}`);
}

main();
