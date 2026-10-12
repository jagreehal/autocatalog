#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log() {
  printf "\n==> %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd pnpm
require_cmd node
require_cmd python3

log "Build workspace packages"
cd "$ROOT"
pnpm -s build

log "Published catalog: validate"
node "$ROOT/packages/events/cli/dist/bin.js" validate --cwd "$ROOT/fixtures/event-starter"

log "Zod flow: ac from-zod + validate"
ZOD_PROJECT="$TMP_DIR/zod-project"
mkdir -p "$ZOD_PROJECT/node_modules"
ln -s "$ROOT/packages/events/adapter-zod" "$ZOD_PROJECT/node_modules/autocatalog-adapter-zod"
(
  cd "$ZOD_PROJECT"
  node "$ROOT/packages/events/cli/dist/bin.js" from-zod \
    "$ROOT/packages/events/adapter-zod/test/fixtures/compact-export.ts" \
    --out "$ZOD_PROJECT/events"
)
node "$ROOT/packages/events/cli/dist/bin.js" validate --cwd "$ZOD_PROJECT"

log "Python flow: autocatalog-py extract + validate"
PY_PROJECT="$TMP_DIR/py-project"
mkdir -p "$PY_PROJECT/events"
python3 -m venv "$TMP_DIR/venv"
source "$TMP_DIR/venv/bin/activate"
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -e "$ROOT/python/autocatalog-py"
PYTHONPATH="$ROOT/python/autocatalog-py/tests/fixtures" \
  autocatalog-py extract --module sample_decorated --out "$PY_PROJECT/events"
deactivate
node "$ROOT/packages/events/cli/dist/bin.js" validate --cwd "$PY_PROJECT"

log "E2E smoke passed"
