# Signing & Notarization Setup

This document explains how to provision the secrets required by `.github/workflows/desktop-cross-release.yml`. **Never commit private keys or certificates to the repo.** Store everything as GitHub Actions secrets or in your runner’s secure keychain.

## macOS (codesign + notarization + stapling)

| Secret / Env | Description |
| --- | --- |
| `MAC_CODESIGN_CERT_B64` | Base64-encoded `.p12` containing a **Developer ID Application** (or Apple Distribution) certificate. Create via `base64 -i DeveloperID_Application.p12`. |
| `MAC_CODESIGN_CERT_PASSWORD` | Password used when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | San name, e.g. `Developer ID Application: Therapy Inc (TEAMID1234)`. Used by `codesign`. |
| `APPLE_INSTALLER_IDENTITY` (optional) | Installer identity for signing `.pkg` files, e.g. `Developer ID Installer: Therapy Inc (TEAMID1234)`. |
| `APPLE_TEAM_ID` | 10-character Team ID used for notarization. Required for both API key and Apple ID flows. |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID email + app-specific password (create via https://appleid.apple.com). Use these if you do **not** want to manage API keys. |
| `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Alternative notarization flow. Base64 encode the `.p8` key (`base64 -i AuthKey_ABC123XYZ.p8`). The workflow writes it to a temp file referenced by `APPLE_API_KEY_PATH`. Only one of (API key) or (Apple ID) is required. |

The notarization helper (`scripts/release/notarize-dmg.sh`) automatically picks whichever credential set is available, submits the DMG, waits for approval, and staples the ticket. If notarization is not desired (e.g., internal builds), omit the secrets and the step is skipped.

## Windows (Authenticode)

| Secret / Env | Description |
| --- | --- |
| `WINDOWS_CODESIGN_CERT_B64` | Base64-encoded `.pfx` containing the Authenticode certificate + private key. |
| `WINDOWS_CODESIGN_CERT_PASSWORD` | PFX password. |
| `WINDOWS_CODESIGN_SUBJECT` | Subject string passed to `signtool /n`, e.g. `Therapy Inc`. |

The workflow imports the certificate into the runner’s per-user certificate store and signs every `.exe` and `.msi` produced by Tauri, timestamping via DigiCert’s TSA. If you use Azure Key Vault or another HSM, replace the import/sign steps with your provider’s CLI while keeping the filenames identical.

## Linux Packages

By default the `.deb`, `.rpm`, and `.AppImage` artifacts remain unsigned. For production repos you should consider:

1. **Debian packages** – import an armored GPG key into GitHub secrets (e.g., `DEB_SIGNING_KEY` and `DEB_SIGNING_PASSPHRASE`), install `dpkg-sig`, and add a step after the Linux build to run `dpkg-sig -k "$DEB_KEY_ID" --sign builder <path>.deb`.
2. **RPM packages** – store the RPM GPG key and use `rpm --addsign *.rpm`. Configure your repository metadata to publish the public key.
3. **AppImage** – optional `appimagetool --sign` invocation with an OpenPGP key.

Document the chosen key IDs in your internal security inventory and rotate them regularly.

## Secret Storage Tips

* Use organization-level secrets scoped to this repo whenever possible.
* For self-hosted macOS runners, keep the keychain unlocked only for the workflow duration. The `apple-actions/import-codesign-certs` step stores certs in a temporary keychain that is deleted at the end.
* Restrict access to release workflows via branch protection and role-based permissions.
* Consider migrating to GitHub OIDC + short-lived cloud credentials for fetching signing material (Azure Key Vault, Hashicorp Vault, etc.) if regulatory compliance requires it.
