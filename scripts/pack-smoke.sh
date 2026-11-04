#!/usr/bin/env bash
# The published shape, tested. Pack what `npx autocatalog` installs, install it
# with npm into an empty project, and run the front door offline. The workspace
# links packages together; a user's install does not, and this is the check
# that notices the difference.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"

# Every package a release publishes. A package left out resolves from npm, which
# does not have the version a release pull request has just bumped it to.
PACKAGES=$(pnpm -s -r ls --depth -1 --json | node -e '
  const packages = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log(packages.filter((pkg) => !pkg.private).map((pkg) => pkg.path).join("\n"));
')

echo "==> build and pack"
pnpm -s build
for pkg in $PACKAGES; do
  (cd "$pkg" && pnpm pack --pack-destination "$TMP/packs" >/dev/null)
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

echo "==> autocatalog agents, reached through the front door"
npx autocatalog agents --help | grep -q 'ac agents snapshot'
mkdir -p "$TMP/agents-repo"
printf '%s' '{"mcpServers":{"linear":{"url":"https://mcp.linear.app/mcp"}}}' > "$TMP/agents-repo/.mcp.json"
npx autocatalog agents discover --from mcp "$TMP/agents-repo" --root "$TMP/agents-repo"
test -f "$TMP/agents-repo/mcp-servers/linear-app/autocatalog.json"

echo "pack smoke passed"
