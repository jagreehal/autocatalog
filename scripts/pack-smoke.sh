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

echo "==> a server site renders with one React beside the project's older one"
echo '{"output":"server"}' > autocatalog.site.json
npx autocatalog site "$TMP/repos" --out "$TMP/server"
PORT=4599 HOST=127.0.0.1 node "$TMP/server/server.mjs" > "$TMP/server.log" 2>&1 &
SERVER=$!
for _ in $(seq 30); do curl -sf -o /dev/null http://127.0.0.1:4599/ && break; sleep 1; done
PAGE=$(sed -n 's#.*href="\(/payments-service/[^"]*\)".*#\1#p' "$TMP/server/client/index.html" | head -1)
curl -sf -o /dev/null "http://127.0.0.1:4599${PAGE:-/}"
kill "$SERVER"
rm autocatalog.site.json
if grep -q 'rror' "$TMP/server.log"; then cat "$TMP/server.log" >&2; exit 1; fi

echo "==> autocatalog to-eventcatalog"
npx autocatalog to-eventcatalog "$TMP/eventcatalog" --root "$TMP/repos/payments-service/events"
test -f "$TMP/eventcatalog/domains/payments/index.mdx"

echo "==> autocatalog agents, reached through the front door"
npx autocatalog agents --help | grep -q 'ac agents snapshot'
mkdir -p "$TMP/agents-repo"
printf '%s' '{"mcpServers":{"linear":{"url":"https://mcp.linear.app/mcp"}}}' > "$TMP/agents-repo/.mcp.json"
npx autocatalog agents discover --from mcp "$TMP/agents-repo" --root "$TMP/agents-repo"
test -f "$TMP/agents-repo/mcp-servers/linear-app/autocatalog.json"

echo "==> autocatalog site beside Express 4, installed with pnpm"
# Astro's output gets the cookie Astro names, beside the one pnpm hoists for Express.
mkdir -p "$TMP/express/contracts"
cd "$TMP/express"
node - "$TMP/packs" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = process.argv[2];
const packs = Object.fromEntries(
  fs.readdirSync(dir).map((file) => {
    const tarball = path.join(dir, file);
    const manifest = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    return [JSON.parse(manifest).name, `file:${tarball}`];
  }),
);
fs.writeFileSync('package.json', JSON.stringify({
  name: 'orders-api',
  private: true,
  dependencies: { cookie: '0.7.2', express: '^4.21.0', 'orders-extension': 'file:./extension' },
  devDependencies: { autocatalog: packs.autocatalog },
}));
fs.writeFileSync('pnpm-workspace.yaml', JSON.stringify({ overrides: packs }));
fs.mkdirSync('extension');
fs.writeFileSync('extension/package.json', JSON.stringify({
  name: 'orders-extension',
  version: '1.0.0',
  type: 'module',
  peerDependencies: { express: '^4.21.0' },
  autocatalog: { site: './extend.js' },
}));
fs.writeFileSync('extension/extend.js', "export default { middleware: './middleware.js' };");
fs.writeFileSync('extension/middleware.js', [
  "import express from 'express';",
  "if (typeof express.application.del !== 'function') throw new Error('the extension was given another version of its peer');",
  'export const onRequest = (_, next) => next();',
].join('\n'));
fs.writeFileSync('contracts/openapi.json', JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1.0.0' },
  paths: { '/orders': { get: { responses: { 200: { description: 'ok' } } } } },
}));
NODE
pnpm install --silent --ignore-scripts
pnpm exec autocatalog site . --out dist
test -f dist/index.html || { echo "missing index.html" >&2; exit 1; }

echo "==> a server site's own code, and an extension it installs, get its Express 4 and cookie 0.7"
# Astro names cookie 2, and the MCP SDK Express 5.
mkdir site
echo '{"output":"server","extend":["./site/extend.mjs","orders-extension"]}' > autocatalog.site.json
echo "export default { middleware: ['./middleware.ts', './legacy.cjs'] };" > site/extend.mjs
cat > site/legacy.cjs <<'JS'
const express = require('express');

if (typeof express.application.del !== 'function') {
  throw new Error('CommonJS was given another version of its own dependency');
}

exports.onRequest = (_, next) => next();
JS
cat > site/middleware.ts <<'TS'
import * as cookie from 'cookie';
import express from 'express';

const own = typeof (express as any).application.del === 'function' && 'parse' in cookie;

if (!own) throw new Error('the site was given another version of its own dependency');

export const onRequest = (_: unknown, next: () => Promise<Response>) => next();
TS
pnpm exec autocatalog site . --out server
PORT=4598 HOST=127.0.0.1 node server/server.mjs > "$TMP/own.log" 2>&1 &
SERVER=$!
for _ in $(seq 30); do curl -sf -o /dev/null http://127.0.0.1:4598/ && break; sleep 1; done
curl -s -o /dev/null http://127.0.0.1:4598/not-a-page
kill "$SERVER"
grep -rq 'autocatalog-site:express' server/server || { echo "Express was bundled" >&2; exit 1; }
if grep -q 'Error:\|another version' "$TMP/own.log"; then cat "$TMP/own.log" >&2; exit 1; fi

echo "==> autocatalog-cli on its own leaves the site builder out, and says so"
mkdir -p "$TMP/cli"
cd "$TMP/cli"
node -e '
  const { overrides } = JSON.parse(require("fs").readFileSync("../express/pnpm-workspace.yaml", "utf8"));
  const fs = require("fs");
  fs.writeFileSync("pnpm-workspace.yaml", JSON.stringify({ overrides }));
  fs.writeFileSync("package.json", JSON.stringify({ name: "cli", private: true, devDependencies: { "autocatalog-cli": overrides["autocatalog-cli"] } }));
'
pnpm install --silent --ignore-scripts
if ls node_modules/.pnpm | grep -q '^astro@'; then echo "autocatalog-cli installed astro" >&2; exit 1; fi
pnpm exec ac validate --cwd "$ROOT/fixtures/event-starter"
(pnpm exec ac site . --out dist 2>&1 || true) | grep -q 'site builder is not installed'

echo "pack smoke passed"
