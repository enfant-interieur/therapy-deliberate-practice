import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = path.resolve(desktopDir, "..", "python");
const binariesDir = path.resolve(desktopDir, "src-tauri", "binaries");
const downloadDir = path.resolve(desktopDir, ".sidecar-downloads");
const venvDir = path.resolve(pythonRoot, ".venv-tauri");
const stampPath = path.resolve(venvDir, ".deps.stamp.json");
const specPath = path.resolve(pythonRoot, "pyinstaller.local_runtime_gateway.spec");

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
    execFileSync(executable, args, {
      stdio: "inherit",
      ...options,
    });
  } catch (error) {
    const commandLine = [executable, ...args].join(" ");
    const details = [
      `${label} failed.`,
      `Interpreter: ${executable}`,
      `Working directory: ${cwd}`,
      `Command: ${commandLine}`,
      `Retry: (cd ${cwd} && ${commandLine})`,
    ];
    if (error instanceof Error && error.message) {
      details.push(`Error: ${error.message}`);
    }
    throw new Error(details.join("\n"));
  }
}

function resolveHostTarget() {
  const platformTargets = targetByPlatform[process.platform];
  if (!platformTargets) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  const target = platformTargets[process.arch];
  if (!target) {
    throw new Error(`Unsupported architecture: ${process.arch}`);
  }
  return target;
}

function resolveTarget() {
  if (explicitTarget) {
    return explicitTarget;
  }
  return resolveHostTarget();
}

function readPythonVersion(executable) {
  const version = execFileSync(
    executable,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"],
    { encoding: "utf8" },
  ).trim();
  const [major, minor] = version.split(".").map((value) => Number(value));
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 3 || (major === 3 && minor < 10)) {
    throw new Error(`Python ${version} is too old.`);
  }
  return version;
}

function resolveSystemPython() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push(process.env.PYTHON);
  } else if (process.platform === "win32") {
    candidates.push("python");
  } else {
    candidates.push("python3.12", "python3.11", "python3.10", "python3");
  }
  for (const candidate of candidates) {
    try {
      const version = readPythonVersion(candidate);
      return { path: candidate, version };
    } catch (error) {
      continue;
    }
  }
  throw new Error(
    "Python 3.10+ is required to build the sidecar. Install Python (prefer 3.11–3.12) and ensure it is available in PATH or set PYTHON.",
  );
}

function readVenvPythonVersion() {
  const version = readPythonVersion(venvPython);
  return version;
}

function computeStamp(pyprojectHash, pythonVersion) {
  return JSON.stringify({ pyprojectHash, pythonVersion }, null, 2);
}

function loadStamp() {
  if (!existsSync(stampPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch (error) {
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
    runCommand(
      "Virtual environment creation",
      systemPython.path,
      ["-m", "venv", venvDir],
      { cwd: pythonRoot },
    );
  }
  if (!existsSync(venvPython)) {
    throw new Error(`Expected venv python at ${venvPython}, but it was not found.`);
  }
}

function syncDependencies() {
  banner(3, 5, "Syncing Python dependencies...");
  const pyprojectHash = hashPyproject();
  const pythonVersion = readVenvPythonVersion();
  const stamp = loadStamp();
  if (stamp?.pyprojectHash === pyprojectHash && stamp?.pythonVersion === pythonVersion) {
    console.log("Dependencies unchanged; skipping install.");
    return;
  }
  banner(3, 5, "Syncing Python dependencies...");
  runCommand("Pip install", venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: pythonRoot,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
    },
  });
  runCommand("Pip install", venvPython, ["-m", "pip", "install", "-e", "."], {
    cwd: pythonRoot,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
    },
  });
  runCommand("Pip install", venvPython, ["-m", "pip", "install", "pyinstaller"], {
    cwd: pythonRoot,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
    },
  });
  writeFileSync(stampPath, computeStamp(pyprojectHash, pythonVersion));
}

function buildSidecar(distPath) {
  banner(4, 5, "Building sidecar with PyInstaller...");
  rmSync(path.resolve(pythonRoot, "dist"), { recursive: true, force: true });
  rmSync(path.resolve(pythonRoot, "build"), { recursive: true, force: true });
  runCommand("PyInstaller build", venvPython, ["-m", "PyInstaller", "--clean", "--noconfirm", specPath], {
    cwd: pythonRoot,
    env: {
      ...process.env,
      PYTHONNOUSERSITE: "1",
      PYTHONPATH: pythonRoot,
      VIRTUAL_ENV: venvDir,
    },
  });
  if (!existsSync(distPath)) {
    throw new Error(`Expected sidecar binary at ${distPath}, but it was not produced.`);
  }
}

function validateArtifact(outputPath) {
  if (!existsSync(outputPath)) {
    throw new Error(`Sidecar not found at ${outputPath}.`);
  }
  if (process.platform !== "win32") {
    chmodSync(outputPath, 0o755);
  }
}

function resolveBuildPlan() {
  const target = resolveTarget();
  if (target === "universal-apple-darwin") {
    if (process.platform !== "darwin") {
      throw new Error("Universal sidecar builds are only supported on macOS.");
    }
    return {
      target,
      targets: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
      outputName: `${sidecarName}-universal-apple-darwin${exeSuffix}`,
      isUniversal: true,
    };
  }
  return {
    target,
    targets: [target],
    outputName: `${sidecarName}-${target}${exeSuffix}`,
    isUniversal: false,
  };
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
  if (process.platform !== "win32") {
    chmodSync(outputPath, 0o755);
  }
}

const forceFlag = process.argv.slice(2).includes("--force");

async function ensureSidecar(plan) {
  const outputPath = path.resolve(binariesDir, plan.outputName);
  const forceRebuild = process.env.FORCE_SIDECAR_REBUILD === "1" || forceFlag;

  const strategies = [
    {
      name: "ExistingArtifactStrategy",
      canHandle: () => existsSync(outputPath) && !forceRebuild,
      run: () => {
        banner(1, 3, "Using existing sidecar artifact...");
        validateArtifact(outputPath);
        return true;
      },
    },
    {
      name: "CIStrategy",
      canHandle: () =>
        Boolean(process.env.LOCAL_RUNTIME_SIDECAR_BASE_URL || process.env.LOCAL_RUNTIME_SIDECAR_URL),
      run: async () => {
        const baseUrl = process.env.LOCAL_RUNTIME_SIDECAR_BASE_URL;
        const explicitUrl = process.env.LOCAL_RUNTIME_SIDECAR_URL;
        banner(1, 3, "Downloading sidecar artifact...");
        mkdirSync(downloadDir, { recursive: true });
        if (plan.isUniversal) {
          if (!baseUrl) {
            throw new Error("LOCAL_RUNTIME_SIDECAR_BASE_URL is required to download universal sidecars.");
          }
          const downloaded = [];
          for (const target of plan.targets) {
            const filename = `${sidecarName}-${target}${exeSuffix}`;
            const url = `${baseUrl.replace(/\/$/, "")}/${filename}`;
            const destination = path.resolve(downloadDir, filename);
            await downloadFile(url, destination);
            downloaded.push(destination);
          }
          banner(2, 3, "Creating universal sidecar with lipo...");
          runCommand("Lipo merge", "lipo", ["-create", "-output", outputPath, ...downloaded]);
          validateArtifact(outputPath);
          return true;
        }
        const filename = `${sidecarName}-${plan.target}${exeSuffix}`;
        const url = explicitUrl ?? `${baseUrl?.replace(/\/$/, "")}/${filename}`;
        if (!url) {
          throw new Error("LOCAL_RUNTIME_SIDECAR_URL or LOCAL_RUNTIME_SIDECAR_BASE_URL must be set.");
        }
        await downloadFile(url, outputPath);
        validateArtifact(outputPath);
        return true;
      },
    },
    {
      name: "DevBuildStrategy",
      canHandle: () => true,
      run: () => {
        if (plan.isUniversal) {
          throw new Error(
            "Universal sidecar builds require CI artifacts. Set LOCAL_RUNTIME_SIDECAR_BASE_URL or build per-arch and run lipo.",
          );
        }
        const hostTarget = resolveHostTarget();
        if (plan.target !== hostTarget) {
          throw new Error(
            `Host target ${hostTarget} cannot build ${plan.target}. Set LOCAL_RUNTIME_SIDECAR_BASE_URL to download a prebuilt sidecar.`,
          );
        }
        const distPath = path.resolve(pythonRoot, "dist", `${sidecarName}${exeSuffix}`);
        banner(1, 5, `Preparing sidecar for ${plan.target}...`);
        mkdirSync(binariesDir, { recursive: true });
        banner(2, 5, "Bootstrapping venv...");
        ensureVenv();
        syncDependencies();
        buildSidecar(distPath);
        banner(5, 5, "Validating sidecar artifact...");
        chmodSync(distPath, process.platform === "win32" ? 0o644 : 0o755);
        mkdirSync(binariesDir, { recursive: true });
        rmSync(outputPath, { force: true });
        cpSync(distPath, outputPath);
        validateArtifact(outputPath);
        return true;
      },
    },
  ];

  for (const strategy of strategies) {
    if (strategy.canHandle()) {
      const handled = await strategy.run();
      if (handled) {
        console.log(`Sidecar ready (${strategy.name}): ${outputPath}`);
        return;
      }
    }
  }

  throw new Error("Unable to resolve sidecar artifact.");
}

async function main() {
  const plan = resolveBuildPlan();
  await ensureSidecar(plan);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
