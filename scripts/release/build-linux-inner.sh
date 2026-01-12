#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/release/load-release-env.sh
source "$REPO_ROOT/scripts/release/load-release-env.sh"
load_release_env_files "$REPO_ROOT"
TAURI_CONF="$REPO_ROOT/services/local-runtime-suite/desktop/src-tauri/tauri.conf.json"

VERSION="${RELEASE_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8')); console.log(data.version);")"
fi

PRODUCT_NAME="$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8')); console.log(data.productName);")"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  arm64) ARCH="arm64" ;;
  aarch64) ARCH="arm64" ;;
  *) ARCH="${ARCH}" ;;
esac

TAG="${RELEASE_TAG:-v$VERSION}"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$REPO_ROOT/dist/release/$TAG}"
OUTPUT_DIR="$OUTPUT_ROOT/linux"
mkdir -p "$OUTPUT_DIR"

cd "$REPO_ROOT"

if [[ -z "${RELEASE_SKIP_NPM_CI:-}" ]]; then
  npm ci
fi

npm run tauri:build -w services/local-runtime-suite/desktop -- --bundles deb,rpm,appimage

BUNDLE_DIR="$REPO_ROOT/services/local-runtime-suite/desktop/src-tauri/target/release/bundle"
APPIMAGE_SOURCE=$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name "*.AppImage" -print -quit)
DEB_SOURCE=$(find "$BUNDLE_DIR/deb" -maxdepth 1 -name "*.deb" -print -quit)
RPM_SOURCE=$(find "$BUNDLE_DIR/rpm" -maxdepth 1 -name "*.rpm" -print -quit)

if [[ -n "$APPIMAGE_SOURCE" ]]; then
  cp "$APPIMAGE_SOURCE" "$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.AppImage"
fi

if [[ -n "$DEB_SOURCE" ]]; then
  cp "$DEB_SOURCE" "$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.deb"
fi

if [[ -n "$RPM_SOURCE" ]]; then
  cp "$RPM_SOURCE" "$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.rpm"
fi

echo "Linux artifacts written to $OUTPUT_DIR"
