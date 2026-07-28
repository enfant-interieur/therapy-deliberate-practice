import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.resolve(desktopDir, "src-tauri");
const pythonDir = path.resolve(desktopDir, "..", "python");
const repositoryDir = path.resolve(desktopDir, "..", "..", "..");

function readJson(pathname) {
  return JSON.parse(readFileSync(pathname, "utf8"));
}

function matchVersion(pathname, pattern, label) {
  const match = readFileSync(pathname, "utf8").match(pattern);
  if (!match) throw new Error(`Could not read ${label} version from ${pathname}.`);
  return match[1];
}

const packageVersion = readJson(path.resolve(desktopDir, "package.json")).version;
const tauriConfig = readJson(path.resolve(tauriDir, "tauri.conf.json"));
const linuxAppImageConfig = readJson(
  path.resolve(tauriDir, "tauri.linux-appimage.conf.json"),
);
const tauriVersion = tauriConfig.version;
const cargoVersion = matchVersion(
  path.resolve(tauriDir, "Cargo.toml"),
  /^\s*version\s*=\s*"([^"]+)"/m,
  "Cargo",
);
const cargoManifest = readFileSync(path.resolve(tauriDir, "Cargo.toml"), "utf8");
const sidecarBuildScript = readFileSync(
  path.resolve(desktopDir, "scripts", "build-sidecar.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");
const cargoLockVersion = matchVersion(
  path.resolve(tauriDir, "Cargo.lock"),
  /name = "local-runtime-desktop"\r?\nversion = "([^"]+)"/,
  "Cargo.lock",
);
const versions = new Set([packageVersion, tauriVersion, cargoVersion, cargoLockVersion]);
if (versions.size !== 1) {
  throw new Error(
    `Desktop versions disagree: package=${packageVersion}, Tauri=${tauriVersion}, Cargo=${cargoVersion}, Cargo.lock=${cargoLockVersion}.`,
  );
}

const windowsSidecarPackagingContract = [
  "autobins = false",
  'name = "local-runtime-desktop"',
  'name = "local-runtime-gateway"',
  'required-features = ["sidecar-launcher"]',
  "sidecar-launcher = []",
];
const missingSidecarManifestContract = windowsSidecarPackagingContract.filter(
  (snippet) => !cargoManifest.includes(snippet),
);
if (
  missingSidecarManifestContract.length > 0 ||
  !sidecarBuildScript.includes('"--features",\n      "sidecar-launcher"')
) {
  throw new Error(
    "The sidecar launcher must require its dedicated Cargo feature so Tauri does not package it twice in Windows MSI.",
  );
}

const ciWorkflow = readFileSync(
  path.resolve(repositoryDir, ".github", "workflows", "ci.yml"),
  "utf8",
);
const sidecarCiContract = [
  "cargo clippy --locked --all-targets --features sidecar-launcher -- -D warnings",
  "cargo check --locked --features sidecar-launcher",
  "cargo test --locked --features sidecar-launcher",
];
const missingSidecarCiContract = sidecarCiContract.filter(
  (command) => !ciWorkflow.includes(command),
);
if (missingSidecarCiContract.length > 0) {
  throw new Error(
    `Continuous integration must validate the feature-gated sidecar launcher: ${missingSidecarCiContract.join(", ")}`,
  );
}

const assets = readJson(path.resolve(pythonDir, "python-runtime-assets.json"));
const requiredTargets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];
if (JSON.stringify(Object.keys(assets.targets).sort()) !== JSON.stringify(requiredTargets.sort())) {
  throw new Error("Pinned Python runtime assets do not exactly cover the desktop build matrix.");
}
for (const [target, asset] of Object.entries(assets.targets)) {
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`Invalid Python runtime checksum for ${target}.`);
  }
  if (!asset.name.includes(assets.python_version) || !asset.name.includes(target)) {
    throw new Error(`Python runtime asset identity does not match ${target}.`);
  }
}

if (
  !Array.isArray(linuxAppImageConfig.bundle?.resources) ||
  linuxAppImageConfig.bundle.resources.length !== 0 ||
  linuxAppImageConfig.bundle?.linux?.appimage?.files?.[
    "/usr/share/local-runtime-python"
  ] !== "resources/local-runtime-python"
) {
  throw new Error(
    "The Linux AppImage override must keep the portable runtime out of linuxdeploy's usr/lib scan.",
  );
}

const minimumMacVersion = tauriConfig.bundle?.macOS?.minimumSystemVersion;
if (minimumMacVersion !== "14.0") {
  throw new Error(
    `Tauri must declare macOS 14.0 as the minimum version; found ${minimumMacVersion ?? "none"}.`,
  );
}

const uvLock = readFileSync(path.resolve(pythonDir, "uv.lock"), "utf8");
const requiredNativeWheels = [
  "torch-2.13.0-cp312-cp312-macosx_14_0_arm64.whl",
  "mlx-0.32.0-cp312-cp312-macosx_14_0_arm64.whl",
  "mlx_metal-0.32.0-py3-none-macosx_14_0_arm64.whl",
  "onnxruntime-1.23.2-cp312-cp312-macosx_13_0_x86_64.whl",
  "numba-0.66.0-cp312-cp312-macosx_12_0_arm64.whl",
  "llvmlite-0.48.0-cp312-cp312-macosx_12_0_arm64.whl",
];
for (const wheel of requiredNativeWheels) {
  if (!uvLock.includes(wheel)) {
    throw new Error(`The universal dependency lock is missing required native wheel ${wheel}.`);
  }
}
if (uvLock.includes("numba-0.53.1") || uvLock.includes("llvmlite-0.36.0")) {
  throw new Error("The dependency lock still contains obsolete Python-incompatible Numba wheels.");
}

const windowsPackagingContract = [
  '$projectRoot = Join-Path $env:GITHUB_WORKSPACE "services\\local-runtime-suite\\desktop"',
  "New-Item -ItemType Junction -Path $projectNodeModules -Target $workspaceNodeModules",
  "subst $drive $projectRoot",
  '$resourceRoot = "$drive\\src-tauri\\resources"',
  '"WINDOWS_TAURI_PROJECT=$drive\\"',
  "projectPath: ${{ env.WINDOWS_TAURI_PROJECT }}",
  "tauriScript: npm run tauri",
];
for (const workflowName of ["desktop-build.yml", "desktop-signed-build.yml"]) {
  const workflow = readFileSync(
    path.resolve(repositoryDir, ".github", "workflows", workflowName),
    "utf8",
  );
  const missing = windowsPackagingContract.filter((snippet) => !workflow.includes(snippet));
  if (missing.length > 0) {
    throw new Error(
      `${workflowName} is missing the short Windows packaging contract: ${missing.join(", ")}`,
    );
  }
  if (workflow.includes("subst $drive $env:GITHUB_WORKSPACE")) {
    throw new Error(
      `${workflowName} maps the short Windows drive too high in the repository to protect NSIS paths.`,
    );
  }
}

const expectedTag = process.argv[2] ?? process.env.RELEASE_TAG;
if (expectedTag && expectedTag !== `v${packageVersion}`) {
  throw new Error(`Release tag ${expectedTag} does not match desktop version v${packageVersion}.`);
}
console.log(`Desktop release configuration is consistent at v${packageVersion}.`);
