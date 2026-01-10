#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <path-to-dmg>" >&2
  exit 1
fi

DMG_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG not found: $DMG_PATH" >&2
  exit 1
fi

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "APPLE_TEAM_ID must be set to notarize artifacts." >&2
  exit 1
fi

NOTARY_ARGS=()
if [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  NOTARY_ARGS+=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  NOTARY_ARGS+=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD")
else
  echo "Missing Apple notarization credentials. Provide API key (APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER) or Apple ID (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD)." >&2
  exit 1
fi

echo "Submitting $DMG_PATH for notarization (team: $APPLE_TEAM_ID)..."
xcrun notarytool submit "$DMG_PATH" --wait "${NOTARY_ARGS[@]}"

echo "Stapling notarization ticket onto $DMG_PATH..."
xcrun stapler staple "$DMG_PATH"

echo "Notarization + stapling complete."
