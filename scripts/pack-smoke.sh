#!/usr/bin/env bash
# The published shape, tested. Pack what `npx autocatalog` installs, install it
# with npm into an empty project, and run the front door offline. The workspace
# links packages together; a user's install does not, and this is the check
# that notices the difference.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PACKAGES=(
  packages/events/autocatalog
  packages/events/cli
  packages/events/core
  packages/events/adapter-zod
  packages/docs/core
  packages/docs/astro
  packages/agents/core
)

echo "==> build and pack"
cd "$ROOT"
pnpm -s build
for pkg in "${PACKAGES[@]}"; do
  pnpm --filter "./$pkg" pack --pack-destination "$TMP/packs" >/dev/null
done

echo "==> install into an empty project with npm"
mkdir -p "$TMP/user"
cd "$TMP/user"
npm init -y >/dev/null
# A project that already has an older React, hoisted to the top of a flat
# node_modules: the site must still render with its own.
npm install --no-audit --no-fund --loglevel=error react@18.3.1 react-dom@18.3.1
npm install --no-audit --no-fund --loglevel=error "$TMP"/packs/*.tgz

echo "==> autocatalog validate"
npx autocatalog validate --cwd "$ROOT/fixtures/event-starter"

echo "==> autocatalog site, from the docs demo's repositories"
cp -R "$ROOT/examples/docs-demo/repos" "$TMP/repos"
npx autocatalog site "$TMP/repos" --out "$TMP/site" --site https://docs.acme.example
for page in index.html events/payments-service/payments/payment.captured/index.html \
  events/payments-service/payments/payment.captured/schema.json llms.txt; do
  test -f "$TMP/site/$page" || { echo "missing $page" >&2; exit 1; }
done

echo "==> autocatalog to-eventcatalog"
npx autocatalog to-eventcatalog "$TMP/eventcatalog" --root "$TMP/repos/payments-service/events"
test -f "$TMP/eventcatalog/domains/payments/index.mdx"

echo "pack smoke passed"
