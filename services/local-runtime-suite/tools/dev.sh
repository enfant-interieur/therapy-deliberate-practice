#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_ROOT="$ROOT_DIR/services/local-runtime-suite/python"
cd "$PYTHON_ROOT"
python -m local_runtime.main
