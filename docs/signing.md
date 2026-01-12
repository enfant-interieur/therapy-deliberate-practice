# Signing & Notarization Setup (Local Builds)

This document explains how to provision the secrets required by the **local** release scripts in `scripts/release/`. **Never commit private keys or certificates to the repo.** Provide them as environment variables on the machine performing the build.

## Quick start

1. Copy `.env.release.example` to `.env.release`.
2. Fill in the variables relevant to your platform (macOS, Windows, notarization, etc.).
3. Optionally create `.env.release.local` for machine-specific overrides (also gitignored).
4. Run `npm run release` (or `npm run release:dmg`); the scripts automatically source both files.

Only `.env.release.example` is committed. The real `.env.release*` files stay on your workstation so your Apple IDs, certificates, and passwords never enter git history.

## macOS (codesign + notarization + stapling)

| Env | Description |
| --- | --- |
| `APPSTORE_CERTIFICATES_FILE_BASE64` | Base64-encoded `.p12` containing a **Developer ID Application** (or Apple Distribution) certificate. Create via `base64 -i DeveloperID_Application.p12`. (`MAC_CODESIGN_CERT_B64` still works for legacy setups.) |
| `APPSTORE_CERTIFICATES_PASSWORD` | Password used when exporting the `.p12`. (`MAC_CODESIGN_CERT_PASSWORD` still works for legacy setups.) |
| `APPLE_SIGNING_IDENTITY` | Signing identity name, e.g. `Developer ID Application: Therapy Inc (TEAMID1234)`. Used by `codesign`/Tauri. |
| `APPLE_INSTALLER_IDENTITY` (optional) | Installer identity for signing `.pkg` files, e.g. `Developer ID Installer: Therapy Inc (TEAMID1234)`. |
| `APPLE_TEAM_ID` | 10-character Team ID used for notarization. |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID email + app-specific password (use when **not** using API keys). |
| `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | API key flow. Base64 encode the `.p8` key (`base64 -i AuthKey_ABC123XYZ.p8`). The build script writes it to a temp file and exports `APPLE_API_KEY_PATH`. |

The notarization helper (`scripts/release/notarize-dmg.sh`) automatically picks whichever credential set is available, submits the DMG, waits for approval, and staples the ticket. If notarization is not desired (e.g., internal builds), omit the secrets and the step is skipped.

> `APPLE_SIGNING_IDENTITY` is merged into Tauri’s config via `TAURI_CONFIG` at build time, so you never need to place your personal identity into `src-tauri/tauri.conf.json`.

## Windows (Authenticode)

| Env | Description |
| --- | --- |
| `WINDOWS_CODESIGN_CERT_B64` | Base64-encoded `.pfx` containing the Authenticode certificate + private key. |
| `WINDOWS_CODESIGN_CERT_PASSWORD` | PFX password. |
| `WINDOWS_CODESIGN_SUBJECT` | Subject string passed to `signtool /n`, e.g. `Therapy Inc`. |

The Windows build script imports the certificate into the current user store and signs every `.exe` and `.msi` produced by Tauri. Keep these secrets in `.env.release` on the Windows host (the script loads both `.env.release` and `.env.release.local`). If you use Azure Key Vault, a hardware token, or another HSM, replace the import/sign step with your provider’s CLI while keeping the filenames identical.

## Linux Packages

By default the `.deb`, `.rpm`, and `.AppImage` artifacts remain unsigned. For production repos you should consider:

1. **Debian packages** – import an armored GPG key into your local keyring, install `dpkg-sig`, and run `dpkg-sig -k "$DEB_KEY_ID" --sign builder <path>.deb`.
2. **RPM packages** – use `rpm --addsign *.rpm` with a locally stored GPG key. Publish the public key with your repo metadata.
3. **AppImage** – optional `appimagetool --sign` with an OpenPGP key.

## Secret Storage Tips

* Store certs and passwords in your OS keychain or a local secret manager (1Password CLI, Keychain Access, Windows Credential Manager).
* Use short-lived export files and avoid exporting keys to disk unless necessary.
* Rotate signing credentials regularly and track key IDs in your internal security inventory.
