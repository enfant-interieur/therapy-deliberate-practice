# Cross-Platform Desktop Release System (Local-First)

This repository ships a **local-first** release system that produces **signed** installers for macOS, Windows, and Linux **from your machine**. GitHub Actions workflows remain in the repo for reference only and are **not used** by this process.

## Architecture Decision

We build natively per OS to avoid fragile cross-compilation and GUI dependencies, orchestrated from your machine:

```
                    npm run release
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ Local Orchestrator (scripts/release/run-release.mjs)             │
│                                                                  │
│  ┌───────────────┐   ┌─────────────────────┐   ┌──────────────┐   │
│  │ macOS build   │   │ Linux (Docker)      │   │ Windows host │   │
│  │ local machine │   │ local container     │   │ SSH/VM/PC    │   │
│  │ .app/.dmg     │   │ deb/rpm/AppImage    │   │ NSIS/MSI     │   │
│  └───────────────┘   └─────────────────────┘   └──────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
                 dist/release/<tag>/...
```

**Why this approach**

* **Reliability:** Native packaging per OS avoids brittle cross-compilation and GUI dependencies.
* **Security:** Signing keys stay on your hardware or local VM; no third-party CI exposure.
* **Reproducibility:** Deterministic toolchains are pinned in the Docker image (Linux) and enforced via `rustup` + `fnm` on Windows.
* **Flexibility:** Windows can be a local VM (Parallels/VMware), a physical PC, or a LAN builder.

## Monorepo-Friendly Build Design

### Deterministic toolchains

* **macOS:** uses your local Xcode + Rust toolchain; recommended to pin `rustup` to `1.84.0`.
* **Linux:** Docker image pins **Node 20.19.0** and **Rust 1.84.0**. See `scripts/release/linux-builder/Dockerfile`.
* **Windows:** build script installs **Rust 1.84.0** and uses `fnm` (if present) to pin **Node 20.19.0**.

### Caching strategy

* Linux: `~/.cache/release` is mounted into Docker to cache `npm` and `cargo` artifacts.
* Windows: uses your local `%USERPROFILE%\.cargo` and npm caches.
* macOS: uses your local `~/.cargo` and npm caches.

### Artifact naming / versioning

Artifacts are normalized to:

* macOS: `Local Runtime Suite_<version>_<arch>.zip`, `.dmg`, optional `.pkg`
* Windows: `Local Runtime Suite_<version>_x64.msi`, `Local Runtime Suite_<version>_x64_setup.exe`
* Linux: `Local Runtime Suite_<version>_<arch>.AppImage`, `.deb`, `.rpm`

All artifacts are placed under `dist/release/<tag>/`.

### Reproducible builds

* Clean working tree is enforced by default.
* `npm ci` is used by every build script (set `RELEASE_SKIP_NPM_CI=1` to skip).

### Secret handling

Secrets are injected via environment variables only (never committed). Copy `.env.release.example` to `.env.release`, fill in your signing credentials, and keep the file outside of git. Every release script (macOS, Linux host/container, Windows, and the Node orchestrator) automatically sources `.env.release` (and `.env.release.local` if present) before running. See `docs/signing.md` for exact formats. macOS certs are imported into a temporary keychain and removed after the build.

### Local secret file

1. `cp .env.release.example .env.release`
2. Fill in the variables for macOS, Windows, and notarization credentials.
3. (Optional) Create `.env.release.local` for machine-specific overrides that should never leave your computer.

Both files are `.gitignore`d; only the `.example` lives in git. The release scripts source them with `set -a`, so every variable becomes available to Node, Rust, and shell steps without polluting your global shell profile.

During macOS builds `APPLE_SIGNING_IDENTITY` from the env file is merged into Tauri’s config via `TAURI_CONFIG`, keeping `src-tauri/tauri.conf.json` free of personal Apple IDs.

## Local Command

```
npm run release
```

This command:

1. Reads `services/local-runtime-suite/desktop/src-tauri/tauri.conf.json` for the version.
2. Creates a local git tag `v<version>` (skip with `--skip-tag`).
3. Builds **macOS** locally.
4. Builds **Linux** inside Docker.
5. Builds **Windows** via SSH to your Windows host.

### Flags

| Flag | Purpose |
| --- | --- |
| `--tag vX.Y.Z` | Force a different tag than `v<tauri version>`. |
| `--skip-tag` | Do not create a git tag. |
| `--push-tag` | Push the tag to origin (optional; no Actions are triggered). |
| `--skip-macos` | Skip macOS build. |
| `--skip-linux` | Skip Linux build. |
| `--skip-windows` | Skip Windows build. |
| `--windows-host` | Override `RELEASE_WINDOWS_HOST`. |
| `--windows-user` | Override `RELEASE_WINDOWS_USER`. |
| `--windows-repo` | Override `RELEASE_WINDOWS_REPO_DIR` (use `C:/path`). |
| `--allow-dirty` | Allow dirty git status (not recommended). |
| `--dry-run` | Print commands without executing them. |

### Required Windows env

Set these in your shell before running `npm run release`:

```
export RELEASE_WINDOWS_HOST=windows-builder.local
export RELEASE_WINDOWS_USER=builder
export RELEASE_WINDOWS_REPO_DIR="C:/repos/therapy-deliberate-practice"
```

(Tip: storing these in `.env.release` keeps them out of your shell profile while still letting `npm run release` and the Windows builder consume them.)

The Windows host must have:

* Git + SSH server enabled (OpenSSH is fine)
* Node 20.19.0 (or `fnm` installed so the script can pin it)
* Rust via `rustup`
* Windows SDK (for `signtool.exe`) if signing

## DMG Strategy (Headless + Reliable)

Tauri’s default DMG pipeline depends on Finder automation and can be brittle on headless systems. The local pipeline replaces it with deterministic `hdiutil` calls:

1. Build only the `.app` via `tauri build --bundles app`.
2. Stage `.app` + `/Applications` symlink into a temp directory.
3. Use `hdiutil create -fs HFS+ -format UDZO` to emit the DMG.
4. Optionally notarize and staple via `scripts/release/notarize-dmg.sh`.

No GUI session is required; the output is deterministic and safe for local or headless macOS hosts.

## Release Artifacts Directory

```
dist/release/<tag>/
  macos/
  linux/
  windows/
```

## Troubleshooting

* **macOS DMG fails** – ensure `hdiutil` exists and the `.app` is in `src-tauri/target/release/bundle/macos`.
* **Notarization errors** – verify `APPLE_TEAM_ID` and either API key or Apple ID credentials.
* **Windows signing issues** – confirm the Windows SDK is installed and `WINDOWS_CODESIGN_SUBJECT` matches the cert subject.
* **Linux build fails in Docker** – ensure Docker has enough disk and `libwebkit2gtk-4.1-dev` is installed (in the image).

## Legacy GitHub Actions

The GitHub Actions workflows are retained in `.github/workflows/` for reference or future CI use. The local-first release process **does not** invoke GitHub Actions.
