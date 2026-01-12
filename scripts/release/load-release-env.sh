#!/usr/bin/env bash

# Utility shared by release scripts to source `.env.release` and
# `.env.release.local` without forcing each caller to repeat the logic.
# Usage:
#   source "$REPO_ROOT/scripts/release/load-release-env.sh"
#   load_release_env_files "$REPO_ROOT"

load_release_env_files() {
  local repo_root="$1"
  shift || true

  local env_files=("$repo_root/.env.release" "$repo_root/.env.release.local")
  local loaded_any=0

  for env_file in "${env_files[@]}"; do
    if [[ -f "$env_file" ]]; then
      loaded_any=1
      local rel="${env_file/#$repo_root\//}"
      echo "Loading release environment: ${rel:-$env_file}"
      set -a
      # shellcheck disable=SC1090
      source "$env_file"
      set +a
    fi
  done

  if [[ $loaded_any -eq 0 && -z "${RELEASE_ENV_WARNED:-}" ]]; then
    echo "No .env.release files found. Copy .env.release.example to .env.release to inject local release secrets." >&2
    export RELEASE_ENV_WARNED=1
  fi
}
