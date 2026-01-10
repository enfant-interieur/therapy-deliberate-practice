# Cross-Platform Desktop Release System

This repository now ships a single, reproducible release pipeline that produces signed installers for macOS, Windows, and Linux. The workflow is defined in `.github/workflows/desktop-cross-release.yml` and can be triggered either by pushing a `v*` tag or by running `npm run release` locally.

## Architecture Decision

We build natively on each OS to avoid fragile cross-compilation and GUI dependencies:

```
                tag / workflow_dispatch
                          │
                          ▼
┌──────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────┐
│ prepare (GH) │ ⇒ │ Linux runner   │ ⇒ │ Windows runner │ ⇒ │ self-hosted│
│ metadata +   │   │ (Ubuntu 24.04) │   │ (Windows 2022) │   │ macOS ARM) │
│ changelog    │   │ deb/rpm/AppImg │   │ NSIS + MSI     │   │ .app/.dmg  │
└──────────────┘   └────────────────┘   └────────────────┘   └────────────┘
                          │                    │                    │
                          └──────── sbom (GH) ─┴──────────────┬──────┘
                                                             ▼
                                                      publish release
```

* macOS builds run on the existing self-hosted Mac so we can safely access code-signing keys and Apple notarization tools.
* Linux and Windows builds run on GitHub-hosted runners with deterministic toolchains (Node 20.19.0, Rust 1.84.0, Python 3.11).
* Every job reuses the same scripts and configs via environment variables and shared commands, keeping it monorepo-friendly.

## Deterministic Toolchains & Caching

* **Node** – installed via `actions/setup-node@v4` with npm caching pinned to `package-lock.json`.
* **Rust** – provisioned via `dtolnay/rust-toolchain@stable` locked to 1.84.0 to guarantee `rustc --print host-tuple` availability. `Swatinem/rust-cache@v2` caches `target/` per runner/OS.
* **Python** – `actions/setup-python@v5` (3.11) installs the sidecar’s dependencies through the local editable module.
* **Sidecar** – built exactly once per job using `npm run sidecar:build -w services/local-runtime-suite/desktop`. The Python runtime is vendored inside `src-tauri/local-runtime-python`, so the sidecar discovery issue is resolved for both local and CI environments.
* **Artifacts** – normalized naming: `Local Runtime Suite_<version>_<arch>.<ext>`. Each platform job copies only final installers into temporary staging directories before uploading them via `actions/upload-artifact@v4`.

## Workflow Breakdown

| Job | Responsibilities |
| --- | --- |
| `prepare` | Checks out the requested ref, reads the version from `tauri.conf.json`, determines the effective tag, and generates a changelog range. Outputs are re-used by downstream jobs. |
| `build-linux` | Installs GTK/WebKit dependencies, restores Node/Rust caches, builds `deb`, `rpm`, and `AppImage` bundles via `npx tauri build --bundles deb,rpm,appimage`, and uploads them. |
| `build-windows` | Installs WiX if needed, builds NSIS + MSI installers, optionally imports/signs with Authenticode certs, and uploads them. |
| `build-macos` | Runs on the self-hosted ARM Mac, imports the Apple signing certificate, builds the `.app`, creates a deterministic `hdiutil` DMG (fully headless), optionally notarizes/staples it using `scripts/release/notarize-dmg.sh`, optionally signs a `.pkg`, and uploads `.app.tar.gz`, `.zip`, `.dmg`, and `.pkg` (if available). |
| `sbom` | Generates CycloneDX SBOMs for both npm and Rust dependencies (via `@cyclonedx/cyclonedx-npm` and `cargo-cyclonedx`). |
| `publish` | Downloads every artifact (including SBOMs) and publishes a GitHub Release using the changelog generated in `prepare`. |

## Local Command (`npm run release`)

1. Ensure `gh` CLI is authenticated (`gh auth login`) and you are on the commit you want to release.
2. Run `npm run release`. The script:
   * Reads `services/local-runtime-suite/desktop/src-tauri/tauri.conf.json` to determine the version (or pass `--tag vX.Y.Z` to override).
   * Verifies the working tree is clean.
   * Creates and pushes the annotated git tag.
   * Dispatches the `desktop-cross-release.yml` workflow with that tag.
3. Track the workflow via `gh run watch` or the Actions tab.

Flags:

| Flag | Purpose |
| --- | --- |
| `--tag vX.Y.Z` | Force a different tag than `v<tauri version>`. |
| `--dry-run` | Print the git/gh commands without executing them. |
| `--skip-gh` | Create + push the tag but do not start the workflow (useful when CI should auto-trigger on push). |

## Artifact Naming / Versioning

* macOS: `Local Runtime Suite_<version>_<arch>.{zip,dmg,pkg}`
* Windows: `<product>-<version>-setup.{msi,exe}` as emitted by Tauri (signed post-build).
* Linux: `.AppImage`, `.deb`, `.rpm` emitted by Tauri’s bundler.
* SBOMs: `sbom/npm.cdx.json`, `sbom/rust.cdx.json`

All artifacts are attached to the GitHub Release for the associated tag.

## Secure Secret Handling

* macOS certs are imported through `apple-actions/import-codesign-certs`; the P12 is base64-encoded and stored as `MAC_CODESIGN_CERT_B64`.
* Apple notarization credentials support both API key flow (`APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`) and Apple ID flow (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). The helper script selects whichever set is available.
* Windows uses `WINDOWS_CODESIGN_CERT_B64` / `WINDOWS_CODESIGN_CERT_PASSWORD` to import a PFX into the runner’s user certificate store and signs via `signtool` using `WINDOWS_CODESIGN_SUBJECT`.
* Linux packages are unsigned by default, but GPG-based signing hooks (e.g., `dpkg-sig`, `rpm --addsign`) can be added later; guidance is documented in `docs/signing.md`.

Secrets are always injected via environment variables, never committed.

## Troubleshooting Guide

* **DMG creation fails** – ensure the self-hosted Mac has `hdiutil` (standard on macOS) and that the `Local Runtime Suite.app` exists under `src-tauri/target/release/bundle/macos`. The step logs the staging directory; inspect it on the runner if needed.
* **Notarization errors** – verify the provided Apple credentials. The helper script requires `APPLE_TEAM_ID` plus either the API key trio or Apple ID + app-specific password. Check `xcrun notarytool history --apple-id ...` for more details.
* **Windows signing issues** – confirm `WINDOWS_CODESIGN_SUBJECT` matches the certificate’s subject exactly and that the cert is timestamp-capable. Run `Get-ChildItem Cert:\CurrentUser\My` on the runner for debugging.
* **WiX missing** – `choco install wixtoolset` runs automatically, but if WiX already exists with a different path, expose it via `WIX` environment variable or update the step.
* **Linux GTK / WebKit errors** – the workflow installs all required packages for Ubuntu 24.04; if you change the base image, ensure `libwebkit2gtk-4.1-dev` and friends remain available.
* **SBOM generation** – if `cargo install cargo-cyclonedx` fails due to cached binaries, clear the `~/.cargo` cache on the runner or pin a specific version through `CARGO_INSTALL_ROOT`.

## Why This Fixes the DMG Issues

The previous CI runs called Tauri’s `bundle_dmg.sh`, which expects a GUI session and AppleScript automation to lay out Finder backgrounds. The new process:

1. Builds only the signed `.app` via `tauri build --bundles app`.
2. Copies the `.app` plus the `/Applications` symlink into a staging directory.
3. Uses `hdiutil create -fs HFS+ -format UDZO` to produce the DMG—fully headless and safe on self-hosted or GitHub-hosted runners.
4. Notarizes and staples using `xcrun notarytool` with whichever credential flow is configured.

No GUI automation, no Finder dependencies, and deterministic filenames make the DMG creation stable in CI.

## Next Steps / Maintenance

* Update `services/local-runtime-suite/desktop/src-tauri/tauri.conf.json` whenever you bump the product version; the release command reads it automatically.
* Keep `MAC_CODESIGN_CERT_B64`, `WINDOWS_CODESIGN_CERT_B64`, and Apple credentials up to date.
* If you need Linux package signing, follow the recommendations in `docs/signing.md` (add GPG keys + signing steps).
* To include additional workspaces in the release build, augment the `Install npm dependencies` step with extra `npm ci --workspace ...` invocations—caching already handles multiple lockfiles.
