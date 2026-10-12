#!/usr/bin/env bash
set -euo pipefail
# CI check: diffs JSON Schema output from TypeScript (Zod) and Python (Pydantic) IR schemas.
# Fails non-zero if they diverge.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TS_SCHEMA="$TMP/ir-ts.json"
PY_SCHEMA="$TMP/ir-py.json"

echo "→ Generating TS IR JSON Schema..."

# Use the existing autocatalog-core to generate JSON Schema from the Zod schema
node --input-type=module -e "
import { eventFrontmatter } from '$ROOT/packages/core/dist/index.js';
import fs from 'node:fs';
const schema = eventFrontmatter.toJSONSchema();
fs.writeFileSync('$TS_SCHEMA', JSON.stringify(schema, null, 2) + '\n');
"

echo "→ Generating Python IR JSON Schema..."

PYTHONPATH="$ROOT/python/autocatalog-py/src" python3 -c "
import json
from autocatalog_py.ir import EventFrontmatter
schema = EventFrontmatter.model_json_schema()
with open('$PY_SCHEMA', 'w') as f:
    json.dump(schema, f, indent=2)
    f.write('\n')
"

echo "→ Comparing..."

# Strip non-semantic differences before comparing:
# - \$schema, \$defs keys (different JSON Schema drafts)
# - title, description fields from Pydantic
# - property ordering differences
node --input-type=module -e "
import fs from 'node:fs';

function normalize(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(normalize);
  const out = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    if (k === '\$schema' || k === '\$defs') continue;
    if (k === 'title' || k === 'description') continue;
    out[k] = normalize(obj[k]);
  }
  return out;
}

const ts = normalize(JSON.parse(fs.readFileSync('$TS_SCHEMA', 'utf8')));
const py = normalize(JSON.parse(fs.readFileSync('$PY_SCHEMA', 'utf8')));
const tsStr = JSON.stringify(ts, null, 2);
const pyStr = JSON.stringify(py, null, 2);

if (tsStr === pyStr) {
  console.log('✓ IR schemas are in sync');
} else {
  fs.writeFileSync('$TS_SCHEMA', tsStr + '\n');
  fs.writeFileSync('$PY_SCHEMA', pyStr + '\n');
  console.error('✗ IR schemas diverged — compare:');
  console.error('  TS: $TS_SCHEMA');
  console.error('  PY: $PY_SCHEMA');
  process.exit(1);
}
"

echo "✓ TS ↔ Python IR schemas match"
