# Desktop release process

Therapy Deliberate Practice separates validation, signing, and publication. A build is not a release, and no workflow publishes because a branch or tag was pushed.

## Supported workflows

The repository supports exactly three desktop release workflows:

1. `desktop-build` builds and tests unsigned packages from an exact source commit.
2. `desktop-signed-build` builds signed packages from an existing exact version tag after an authorized operator enters `SIGN`.
3. `desktop-release-draft` verifies a successful signed build and creates a draft GitHub Release after an authorized operator enters `PUBLISH`.

The authoritative workflow definitions are:

- `.github/workflows/desktop-build.yml`
- `.github/workflows/desktop-signed-build.yml`
- `.github/workflows/release.yml`

The repository has no supported local release orchestrator, Mac App Store flow, iOS flow, automatic tag release, or automatic publication workflow.

## 1. Validate an exact commit

Run `desktop-build` manually with the full 40-character commit SHA in `source_ref`. This workflow is unsigned and receives no signing credentials. It builds each platform on its native runner:

- macOS on Apple silicon;
- macOS on Intel;
- Windows x64;
- Linux x64.

Every target must produce the packages expected for that platform, an artifact manifest, runtime provenance, installed-package gateway and desktop-shell smoke receipts, and the required native model evidence. Its checksummed artifacts are validation artifacts only and must not be presented as release-ready downloads.

Do not start a duplicate build for the same commit while a healthy run is active.

## 2. Prepare a signed build

Signing is allowed only after all of these conditions hold:

- the exact commit passed normal continuous integration and `desktop-build`;
- the desktop version is identical in the package manifest, Cargo manifest, Cargo lockfile, and Tauri configuration;
- an immutable `v<version>` tag points to that exact commit;
- the `desktop-signing` GitHub environment has independently verified reviewers, no self-review or administrator bypass, version-tag restrictions, and the required secrets described in [signing.md](signing.md);
- an authorized operator explicitly approves signing.

Run `desktop-signed-build` from the exact version tag and enter `SIGN`. The workflow fails closed when the selected ref is not a version tag, when the tag and checked-out commit differ, when signing material is absent, or when signature, notarization, package, provenance, installed-runtime, or native-model verification fails.

Signed builds do not create a GitHub Release.

## 3. Create a draft release

Publication remains a separate authorized action. After a successful signed build:

1. Inspect all four target artifact manifests and build attestations.
2. Confirm that the successful signed-build run belongs to this repository, the version tag, and the exact tagged commit.
3. Run `desktop-release-draft` with the existing tag and signed-build run identifier.
4. Enter `PUBLISH` only when creating the draft has been explicitly authorized.

The workflow rechecks the version tag, exact commit, workflow identity, complete artifact set, checksums, signatures, notarization, provenance, installed-package smokes, model evidence, and attestations before creating a draft GitHub Release.

A draft is not published automatically. A human must inspect the draft and separately publish it.

## Package expectations

The verified release set contains:

- macOS Apple-silicon DMG;
- macOS Intel DMG;
- Windows x64 NSIS installer and MSI;
- Linux x64 AppImage, Debian package, and RPM.

The artifact manifest binds each package to its exact source commit, portable runtime, launcher identity or documented Linux transformation boundary, installed gateway smoke, installed desktop-shell smoke, native model receipt, and signing status.

## Website downloads

The Local Suite help page reads assets from the latest published GitHub Release for `enfant-interieur/therapy-deliberate-practice`. It never treats workflow artifacts as public downloads. Until a verified release is separately published, the page reports that no verified desktop release is available.

The web application and Cloudflare deployment are independent of desktop release publication. Pushing application source must not create tags, sign packages, or publish desktop installers.

## Stopping conditions

Stop the release path and repair the evidence boundary if any of these conditions occurs:

- a workflow resolves a different commit from the requested source or tag;
- a target package, manifest, receipt, checksum, or attestation is missing;
- an installed package or native model smoke fails;
- a signing or notarization check fails;
- a protected environment is absent or its controls are unverified;
- an action would sign, tag, create a release, or publish without explicit authorization.

See [signing.md](signing.md) for the protected-environment contract and `services/local-runtime-suite/desktop/README.md` for package-level validation details.
