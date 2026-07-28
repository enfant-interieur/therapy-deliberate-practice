# Local Runtime Desktop

The Local Runtime Desktop app starts and stops one managed local gateway, guides the learner through model selection and loading, and provides the local URL and pairing key required by Therapy Settings.

## What the desktop app manages

- gateway startup, readiness, shutdown, and recovery;
- exact product health checks so an unrelated process on the port is never treated as the gateway;
- platform-compatible speech and language model selection;
- model downloads, loading progress, failure details, timeout/recheck behavior, and retry;
- pairing-key reveal, copy, and confirmed rotation;
- port and model-default configuration, plus visible configuration, data, and cache locations;
- metadata-only logs and doctor checks; there is no content-logging toggle;
- safe recovery after a crashed or stale child process.

The English and French control centre supports persisted locale selection, long translated text, widths down to 360 pixels, keyboard focus management, visible status text, and reduced-motion preferences. Stopping the desktop app's wait or closing the interface does not cancel a model load that is already running in the gateway; reopen the status view and recheck the existing job instead of starting a duplicate.

## Development

Install dependencies from the repository root with `npm ci`, or from this directory with `npm install`.

Run the frontend without Tauri:

```bash
npm run dev
```

Run the native application with a freshly built sidecar:

```bash
npm run tauri:dev
```

Run focused checks:

```bash
npm run lint
npm test
npm run build
```

Rust checks run from `src-tauri`:

```bash
cargo fmt --check
cargo check --locked --features sidecar-launcher
cargo test --locked --features sidecar-launcher
```

## Build a native package

The sidecar must be built on the same native target as the Tauri package:

```bash
npm run sidecar:build
npm run tauri:build
```

`sidecar:build` requires Python 3.12, `uv`, Rust, and the target's native build tools. It downloads the exact Python runtime declared in `../python/python-runtime-assets.json` and verifies its SHA-256 checksum.

The manual `desktop-build` GitHub Actions workflow is the supported unsigned, build-only path. It:

- builds Apple-silicon macOS, Intel macOS, Windows x64, and Linux x64 separately;
- creates a portable sidecar on each native runner;
- creates Tauri packages without publishing;
- installs or extracts a package and starts its packaged gateway;
- verifies health, pairing-key authorization, catalog access, and clean shutdown;
- removes generated Python bytecode from the portable runtime so Windows installer paths remain bounded;
- writes checksummed artifact and provenance manifests, including a fail-closed Linux receipt that
  binds the pre-bundle launcher to the AppImage launcher after `linuxdeploy` changes its runtime path;
- runs the complete advertised bounded native matrix from the packaged payload: Qwen Transformers, Faster Whisper, Qwen MLX, and Parakeet MLX on Apple silicon; Faster Whisper on Intel macOS; and Qwen Transformers plus Faster Whisper on Windows and Linux;
- uploads checksummed build artifacts and evidence.

It never receives signing credentials. Its `source_ref` input may therefore be used to test a branch, commit, or tag without exposing protected release secrets. Its artifacts are test artifacts, not release-ready packages.

The separate manual `desktop-signed-build` workflow accepts only the exact version tag selected as the workflow execution ref and requires `SIGN` confirmation. It is designed to use a `desktop-signing` environment, but naming an environment in workflow YAML does not protect it. Repository administrators must create that environment, require independent reviewers, prevent self-review and bypass as appropriate, restrict it to version tags, and place signing secrets only in that environment. Until those repository settings and secrets are independently verified, signed-release readiness is blocked and this workflow must not be run. Once configured, it signs and notarizes both Mac packages, signs the Windows sidecar, desktop executable, and installers, verifies those signatures after installation, and requires the same complete advertised native backend matrix from the signed packaged payloads.

The Apple-silicon and Intel packages require macOS 14 or later. Tauri declares this minimum in package metadata. The portable-runtime builder also forces the macOS 14 wheel platform and rejects any installed wheel tagged for a newer macOS release.

## Release boundary

Building is separate from publication.

The `desktop-release-draft` workflow requires:

- an existing version tag whose current source commit matches the desktop version and signed build;
- a successful `desktop-signed-build` run for the same tag and source commit;
- all four target artifact manifests;
- valid package checksums, cryptographic build attestations, and packaged-gateway smoke receipts;
- pinned native inference evidence for every backend advertised by each packaged target;
- signed and notarized macOS packages;
- signed Windows packages;
- explicit `PUBLISH` confirmation;
- a `desktop-release` environment with independently verified required-reviewer, no-bypass, and version-tag deployment protections.

The source repository cannot establish those GitHub environment settings by itself. Until an administrator configures and verifies them, draft-release readiness is blocked. Once configured, the workflow creates a draft GitHub Release; a human must inspect and publish that draft separately.

No workflow publishes on a push or tag event. The repository currently has no supported macOS App Store or iOS build path. The local sidecar architecture depends on a desktop process and is not presented as mobile-compatible.

## Version changes

Keep the version identical in:

- `package.json`;
- `src-tauri/Cargo.toml`;
- `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`.

Verify the release metadata:

```bash
node scripts/verify-release-config.mjs
```

Do not reuse an existing release tag for different source.
