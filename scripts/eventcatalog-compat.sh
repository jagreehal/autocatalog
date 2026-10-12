#!/usr/bin/env bash
# Keeps autocatalog and EventCatalog from drifting apart. Exports a real
# catalog into a fresh EventCatalog project at the given version, builds it
# with EventCatalog itself, reads the result back through that project's own
# SDK, and round-trips it through ac from-eventcatalog.
#
# Usage: scripts/eventcatalog-compat.sh [version]   (default: latest)
set -euo pipefail

VERSION="${1:-latest}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
AC="node $ROOT/packages/events/cli/dist/bin.js"

echo "==> scan the demo repository"
$AC scan "$ROOT/fixtures/demo-repo" --out "$TMP/events" --allow-code-execution >/dev/null

echo "==> fresh EventCatalog project, @eventcatalog/core@$VERSION"
mkdir -p "$TMP/ec"
cd "$TMP/ec"
cat > package.json <<JSON
{ "name": "compat", "private": true, "type": "module",
  "dependencies": { "@eventcatalog/core": "$VERSION" } }
JSON
cat > eventcatalog.config.js <<'JS'
export default {
  cId: 'autocatalog-compat',
  title: 'Compatibility',
  organizationName: 'Acme',
  homepageLink: 'https://example.com',
  outDir: 'dist',
  base: '/',
  trailingSlash: false,
};
JS
npm install --no-audit --no-fund --loglevel=error
INSTALLED="$(node -p "require('@eventcatalog/core/package.json').version")"
echo "    installed @eventcatalog/core $INSTALLED"

echo "==> export"
$AC to-eventcatalog "$TMP/ec" --root "$TMP/events"

echo "==> build with EventCatalog"
npx eventcatalog build > "$TMP/build.log" 2>&1 || { tail -40 "$TMP/build.log" >&2; exit 1; }
test -f dist/index.html
ls dist/docs/events/payment.completed/*/index.html >/dev/null
test -d dist/visualiser/domains/payments

echo "==> read back through the project's own SDK"
node --input-type=module -e "
const { default: utils } = await import('@eventcatalog/sdk');
const sdk = utils(process.cwd());
const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
const event = await sdk.getEvent('payment.completed');
if (!event) fail('payment.completed was not written');
if (!event.markdown.includes('Defined in')) fail('provenance line missing');
if (!event['x-autocatalog']) fail('x-autocatalog extension dropped');
const service = await sdk.getService('PaymentService');
if (!service?.sends?.some((p) => p.id === 'payment.completed')) fail('PaymentService does not send payment.completed');
const domain = await sdk.getDomain('payments');
if (!domain?.services?.some((p) => p.id === 'PaymentService')) fail('payments domain does not list PaymentService');
console.log('    events, services and domains read back');
"

echo "==> round trip through ac from-eventcatalog"
$AC from-eventcatalog "$TMP/ec" --out "$TMP/back" --quiet
node --input-type=module -e "
import fs from 'node:fs';
import path from 'node:path';
const load = (root) => Object.fromEntries(
  fs.globSync('**/autocatalog.json', { cwd: root })
    .filter((f) => !f.includes('versioned'))
    .map((f) => {
      const m = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
      const s = fs.readFileSync(path.join(root, path.dirname(f), 'schema.json'), 'utf8');
      return [m.id, { version: m.version, schema: JSON.stringify(JSON.parse(s)) }];
    }));
const before = load('$TMP/events');
const after = load('$TMP/back');
for (const [id, v] of Object.entries(before)) {
  if (!after[id]) { console.error('✗ ' + id + ' lost in the round trip'); process.exit(1); }
  if (after[id].version !== v.version || after[id].schema !== v.schema) {
    console.error('✗ ' + id + ' changed in the round trip'); process.exit(1);
  }
}
console.log('    ' + Object.keys(before).length + ' events survive export and import unchanged');
"

echo "==> history: an event with an earlier version, in a second project"
mkdir -p "$TMP/ec-history"
cp "$TMP/ec/package.json" "$TMP/ec/eventcatalog.config.js" "$TMP/ec-history/"
ln -s "$TMP/ec/node_modules" "$TMP/ec-history/node_modules"
cd "$TMP/ec-history"
$AC to-eventcatalog "$TMP/ec-history" --root "$ROOT/fixtures/event-starter/events"
npx eventcatalog build > "$TMP/build-history.log" 2>&1 || { tail -40 "$TMP/build-history.log" >&2; exit 1; }
test -f dist/docs/events/payment.completed/1.0.0/index.html
test -f dist/docs/events/payment.completed/0.9.0/index.html
echo "    current and historical versions both render"

echo "EventCatalog $INSTALLED compatible"
