#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAURI_CONF="$REPO_ROOT/services/local-runtime-suite/desktop/src-tauri/tauri.conf.json"
TAURI_DIR="$REPO_ROOT/services/local-runtime-suite/desktop"
PROVISIONING_FILE="$TAURI_DIR/src-tauri/embedded.provisionprofile"

# shellcheck source=scripts/release/load-release-env.sh
source "$REPO_ROOT/scripts/release/load-release-env.sh"
load_release_env_files "$REPO_ROOT"

if [[ ! -f "$TAURI_CONF" ]]; then
  echo "tauri.conf.json not found at $TAURI_CONF" >&2
  exit 1
fi

SIGNING_IDENTITY="${APPSTORE_SIGNING_IDENTITY:-${APPLE_SIGNING_IDENTITY:-}}"
if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "APPSTORE_SIGNING_IDENTITY (or APPLE_SIGNING_IDENTITY) is required for App Store builds." >&2
  exit 1
fi

INSTALLER_IDENTITY="${APPSTORE_INSTALLER_IDENTITY:-${APPLE_INSTALLER_IDENTITY:-}}"
if [[ -z "$INSTALLER_IDENTITY" ]]; then
  echo "APPSTORE_INSTALLER_IDENTITY (or APPLE_INSTALLER_IDENTITY) is required to sign the App Store pkg." >&2
  exit 1
fi

PROFILE_TEMP_CREATED=0
if [[ -n "${APPSTORE_PROVISION_PROFILE_B64:-}" ]]; then
  echo "Writing App Store provisioning profile to embedded.provisionprofile..."
  echo "$APPSTORE_PROVISION_PROFILE_B64" | base64 -d > "$PROVISIONING_FILE"
  PROFILE_TEMP_CREATED=1
elif [[ ! -f "$PROVISIONING_FILE" ]]; then
  echo "No provisioning profile found. Provide APPSTORE_PROVISION_PROFILE_B64 or place embedded.provisionprofile in src-tauri/." >&2
  exit 1
fi

VERSION="${RELEASE_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8')); console.log(data.version);")"
fi

PRODUCT_NAME="$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8')); console.log(data.productName);")"
TAG="${RELEASE_TAG:-v$VERSION}"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$REPO_ROOT/dist/release/$TAG}"
OUTPUT_DIR="$OUTPUT_ROOT"
mkdir -p "$OUTPUT_DIR"

KEYCHAIN_NAME=""
KEYCHAIN_PASSWORD=""
TMP_KEYCHAIN=""

cleanup() {
  if [[ $PROFILE_TEMP_CREATED -eq 1 ]]; then
    rm -f "$PROVISIONING_FILE"
  fi
  if [[ -n "$TMP_KEYCHAIN" ]]; then
    security delete-keychain "$TMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

CERT_B64="${APPSTORE_CERTIFICATES_FILE_BASE64:-${MAC_CODESIGN_CERT_B64:-}}"
CERT_PASSWORD="${APPSTORE_CERTIFICATES_PASSWORD:-${MAC_CODESIGN_CERT_PASSWORD:-release}}"

if [[ -n "$CERT_B64" ]]; then
  echo "Importing App Store signing certificate into a temporary keychain..."
  KEYCHAIN_NAME="appstore-signing.keychain"
  KEYCHAIN_PASSWORD="$CERT_PASSWORD"
  TMP_KEYCHAIN="$(mktemp -u "$HOME/Library/Keychains/$KEYCHAIN_NAME")"

  CERT_PATH="$(mktemp /tmp/appstore-cert.XXXXXX.p12)"
  echo "$CERT_B64" | base64 -d > "$CERT_PATH"

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  security set-keychain-settings -lut 21600 "$TMP_KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  security import "$CERT_PATH" -k "$TMP_KEYCHAIN" -P "$KEYCHAIN_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
  security list-keychains -d user -s "$TMP_KEYCHAIN" $(security list-keychains -d user | sed 's/"//g')
  security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN"
  rm -f "$CERT_PATH"
fi

export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
export TAURI_CONFIG="$(
  TAURI_CONFIG="${TAURI_CONFIG:-}" APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" node <<'NODE'
const identity = process.env.APPLE_SIGNING_IDENTITY;
let config = {};
const raw = process.env.TAURI_CONFIG;
if (raw) {
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid JSON in TAURI_CONFIG:", err);
    process.exit(1);
  }
}
if (!config.bundle) config.bundle = {};
if (!config.bundle.macOS) config.bundle.macOS = {};
config.bundle.macOS.signingIdentity = identity;
process.stdout.write(JSON.stringify(config));
NODE
)"

cd "$REPO_ROOT"

if [[ -z "${RELEASE_SKIP_NPM_CI:-}" ]]; then
  npm ci
fi

npm run tauri:appstore -w services/local-runtime-suite/desktop -- --bundles app

APP_PATH="$TAURI_DIR/src-tauri/target/universal-apple-darwin/release/bundle/macos/${PRODUCT_NAME}.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found at $APP_PATH" >&2
  exit 1
fi

PKG_PATH="$OUTPUT_DIR/${PRODUCT_NAME}_${VERSION}_mac_app_store.pkg"
rm -f "$PKG_PATH"

echo "Creating signed App Store pkg..."
productbuild --component "$APP_PATH" /Applications --sign "$INSTALLER_IDENTITY" "$PKG_PATH"

echo "App Store package written to $PKG_PATH"
