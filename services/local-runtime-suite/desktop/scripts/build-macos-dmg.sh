#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <application.app> <output.dmg>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS DMG creation must run on macOS." >&2
  exit 1
fi

app_path="$1"
output_path="$2"

if [[ ! -d "$app_path/Contents/MacOS" || ! -f "$app_path/Contents/Info.plist" ]]; then
  echo "The application bundle is incomplete: $app_path" >&2
  exit 1
fi
if [[ "$output_path" != *.dmg ]]; then
  echo "The output path must end in .dmg: $output_path" >&2
  exit 1
fi
if [[ -e "$output_path" ]]; then
  echo "Refusing to overwrite an existing disk image: $output_path" >&2
  exit 1
fi

output_directory="$(dirname "$output_path")"
mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd -P)"
output_path="$output_directory/$(basename "$output_path")"

staging_directory="$(mktemp -d "${TMPDIR:-/tmp}/local-runtime-dmg.XXXXXX")"
dmg_complete=false
cleanup() {
  if [[ -d "$staging_directory" && "$(basename "$staging_directory")" == local-runtime-dmg.* ]]; then
    rm -rf -- "$staging_directory"
  fi
  if [[ "$dmg_complete" != true && -f "$output_path" ]]; then
    rm -f -- "$output_path"
  fi
}
trap cleanup EXIT

ditto "$app_path" "$staging_directory/$(basename "$app_path")"
ln -s /Applications "$staging_directory/Applications"

hdiutil create \
  -srcfolder "$staging_directory" \
  -volname "Local Runtime Suite" \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$output_path"
hdiutil verify "$output_path"
dmg_complete=true

echo "Created and verified $output_path"
