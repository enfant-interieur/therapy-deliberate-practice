#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAURI_CONF="$REPO_ROOT/services/local-runtime-suite/desktop/src-tauri/tauri.conf.json"

if [[ ! -f "$TAURI_CONF" ]]; then
  echo "tauri.conf.json not found at $TAURI_CONF" >&2
  exit 1
fi

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
OUTPUT_DIR="$OUTPUT_ROOT/macos"
mkdir -p "$OUTPUT_DIR"

KEYCHAIN_NAME=""
KEYCHAIN_PASSWORD=""
TMP_KEYCHAIN=""
API_KEY_PATH=""

cleanup() {
  if [[ -n "$API_KEY_PATH" && -f "$API_KEY_PATH" ]]; then
    rm -f "$API_KEY_PATH"
  fi
  if [[ -n "$TMP_KEYCHAIN" ]]; then
    security delete-keychain "$TMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -n "${MAC_CODESIGN_CERT_B64:-}" ]]; then
  echo "Importing macOS signing certificate into a temporary keychain..."
  KEYCHAIN_NAME="release-signing.keychain"
  KEYCHAIN_PASSWORD="${MAC_CODESIGN_CERT_PASSWORD:-release}"
  TMP_KEYCHAIN="$(mktemp -u "$HOME/Library/Keychains/$KEYCHAIN_NAME")"

  CERT_PATH="$(mktemp /tmp/macos-cert.XXXXXX.p12)"
  echo "$MAC_CODESIGN_CERT_B64" | base64 -d > "$CERT_PATH"

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  security set-keychain-settings -lut 21600 "$TMP_KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  security import "$CERT_PATH" -k "$TMP_KEYCHAIN" -P "$KEYCHAIN_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
  security list-keychains -d user -s "$TMP_KEYCHAIN" $(security list-keychains -d user | sed 's/"//g')
  security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  rm -f "$CERT_PATH"
fi

if [[ -n "${APPLE_API_KEY_B64:-}" ]]; then
  API_KEY_PATH="$(mktemp /tmp/AuthKey.XXXXXX.p8)"
  echo "$APPLE_API_KEY_B64" | base64 -d > "$API_KEY_PATH"
  export APPLE_API_KEY_PATH="$API_KEY_PATH"
fi

cd "$REPO_ROOT"

if [[ -z "${RELEASE_SKIP_NPM_CI:-}" ]]; then
  npm ci
fi

npm run tauri:build -w services/local-runtime-suite/desktop -- --bundles app

APP_PATH="$REPO_ROOT/services/local-runtime-suite/desktop/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found at $APP_PATH" >&2
  exit 1
fi

ZIP_PATH="$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.zip"
DMG_PATH="$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.dmg"
PKG_PATH="$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_${ARCH}.pkg"

rm -f "$ZIP_PATH" "$DMG_PATH" "$PKG_PATH"

ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

STAGING_DIR="$OUTPUT_DIR/dmg-staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$STAGING_DIR" -fs HFS+ -format UDZO -imagekey zlib-level=9 "$DMG_PATH" >/dev/null

if [[ -n "${APPLE_INSTALLER_IDENTITY:-}" ]]; then
  echo "Creating signed pkg with identity $APPLE_INSTALLER_IDENTITY..."
  productbuild --component "$APP_PATH" /Applications --sign "$APPLE_INSTALLER_IDENTITY" "$PKG_PATH"
fi

if [[ -n "${APPLE_TEAM_ID:-}" ]]; then
  if [[ -n "${APPLE_API_KEY_PATH:-}" || -n "${APPLE_ID:-}" ]]; then
    echo "Notarizing DMG..."
    "$REPO_ROOT/scripts/release/notarize-dmg.sh" "$DMG_PATH"
  fi
fi

echo "macOS artifacts written to $OUTPUT_DIR"
