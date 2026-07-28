# Desktop signing controls

Desktop signing happens only inside the manual `desktop-signed-build` GitHub Actions workflow. The repository does not support local signing scripts, workstation release environment files, Mac App Store credentials, or automatic signing on a branch or tag push.

## Protected environment

Repository administrators must configure a GitHub environment named `desktop-signing` before the signed workflow is used. The environment must:

- require independent approval;
- prevent self-review;
- prevent administrator bypass where the GitHub plan permits it;
- restrict deployments to version tags;
- expose signing secrets only to jobs that pass those controls.

The workflow file can name this environment but cannot prove that its repository settings are correct. Treat signed-release readiness as blocked until an administrator has inspected and recorded those settings outside the public repository.

## Required secrets

Configure these secrets only in the `desktop-signing` environment.

### macOS

| Secret                       | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `MACOS_CERTIFICATE`          | Base64-encoded Developer ID Application certificate in PKCS #12 format. |
| `MACOS_CERTIFICATE_PASSWORD` | Password for the PKCS #12 certificate.                                  |
| `APPLE_SIGNING_IDENTITY`     | Exact Developer ID Application identity used by Tauri and `codesign`.   |
| `APPLE_ID`                   | Apple Developer account used by `notarytool`.                           |
| `APPLE_PASSWORD`             | App-specific password used by `notarytool`.                             |
| `APPLE_TEAM_ID`              | Apple Developer team identifier.                                        |

The workflow imports the certificate through the pinned `apple-actions/import-codesign-certs` action, signs the application and DMG, submits the DMG to Apple notarization, staples the ticket, and verifies the installed package. Missing or invalid material fails the job.

### Windows

| Secret                         | Purpose                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| `WINDOWS_CERTIFICATE`          | Base64-encoded Authenticode certificate and private key in PFX format. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the PFX certificate.                                      |

The workflow imports the certificate into the ephemeral runner, signs the sidecars, desktop executable, NSIS installer, and MSI, and verifies Authenticode after installation. Missing or invalid material fails the job.

### Linux

Linux AppImage, Debian, and RPM packages are currently unsigned. Their artifact manifest and build attestations must state that status explicitly. Do not describe them as cryptographically signed packages.

## Draft-release environment

The separate `desktop-release` GitHub environment controls `desktop-release-draft`. It must use the same independent-review, no-self-review, no-bypass, and version-tag restrictions. That workflow does not receive signing secrets. It accepts only a successful `desktop-signed-build` run for the exact tag and commit, verifies all packages and attestations, and creates a draft only after explicit `PUBLISH` confirmation.

## Secret handling

- Never commit certificates, keys, passwords, tokens, or filled environment files.
- Never print secret values in logs or documentation.
- Keep signing material out of unsigned validation workflows.
- Rotate a credential immediately if exposure is suspected.
- Do not copy protected environment secrets to a developer workstation as part of this release process.

The current repository has no supported Mac App Store or iOS release path. Adding one is a separate product and security decision that requires its own design, implementation, review, and explicit authorization.
