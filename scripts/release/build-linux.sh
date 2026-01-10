#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="${RELEASE_TAG:-v0.0.0}"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$REPO_ROOT/dist/release/$TAG}"
OUTPUT_DIR="$OUTPUT_ROOT/linux"
mkdir -p "$OUTPUT_DIR"

IMAGE_NAME="therapy-tauri-linux-builder:node20.19.0-rust1.84.0"
DOCKERFILE="$REPO_ROOT/scripts/release/linux-builder/Dockerfile"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for Linux builds. Install Docker or pass --skip-linux." >&2
  exit 1
fi

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Building Linux release image..."
  docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" "$REPO_ROOT/scripts/release/linux-builder"
fi

CACHE_DIR="$REPO_ROOT/.cache/release"
mkdir -p "$CACHE_DIR/npm" "$CACHE_DIR/cargo/registry" "$CACHE_DIR/cargo/git"

docker run --rm \
  -e RELEASE_TAG="$TAG" \
  -e RELEASE_VERSION="${RELEASE_VERSION:-}" \
  -e RELEASE_OUTPUT_DIR="$OUTPUT_ROOT" \
  -e NPM_CONFIG_CACHE=/cache/npm \
  -v "$REPO_ROOT:/workspace" \
  -v "$CACHE_DIR/npm:/cache/npm" \
  -v "$CACHE_DIR/cargo/registry:/root/.cargo/registry" \
  -v "$CACHE_DIR/cargo/git:/root/.cargo/git" \
  -w /workspace \
  "$IMAGE_NAME" \
  bash scripts/release/build-linux-inner.sh

