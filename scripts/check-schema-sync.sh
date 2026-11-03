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

# The input shape, because Python is the side that writes manifests: a field
# with a default is optional there, and unknown keys are ignored on both sides.
node --input-type=module -e "
import { eventFrontmatter } from '$ROOT/packages/events/core/dist/index.js';
import fs from 'node:fs';
const schema = eventFrontmatter.toJSONSchema({ io: 'input' });
fs.writeFileSync('$TS_SCHEMA', JSON.stringify(schema, null, 2) + '\n');
"

echo "→ Generating Python IR JSON Schema..."

PYTHONPATH="$ROOT/python/autocatalog-py/src" python3 -c "
import json
from autocatalog_py.ir import EventFrontmatter
schema = EventFrontmatter.model_json_schema(by_alias=True, mode='validation')
with open('$PY_SCHEMA', 'w') as f:
    json.dump(schema, f, indent=2)
    f.write('\n')
"

echo "→ Comparing..."

node --input-type=module -e "
import fs from 'node:fs';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Dropped because each says the same thing in its own way:
// - title and description are prose
// - Pydantic spells an optional field as anyOf with null and default null, and
//   writes manifests with exclude_none, so a null never reaches a reader
// - Pydantic shares models through \$ref where Zod inlines them
// - Zod adds a string propertyNames to a record, and the safe integer limit
function normalize(node, defs) {
  if (Array.isArray(node)) return node.map((item) => normalize(item, defs));
  if (typeof node !== 'object' || node === null) return node;

  if (node.\$ref) {
    const { \$ref, ...rest } = node;

    return normalize({ ...defs[\$ref.split('/').at(-1)], ...rest }, defs);
  }

  const variants = node.anyOf?.filter((variant) => variant.type !== 'null');

  if (variants?.length === 1) {
    const { anyOf, default: fallback, ...rest } = node;

    return normalize({ ...variants[0], ...rest, ...(fallback === null ? {} : { default: fallback }) }, defs);
  }

  const out = {};

  for (const key of Object.keys(node).sort()) {
    if (['\$schema', '\$defs', 'title', 'description', 'propertyNames'].includes(key)) continue;
    if (key === 'maximum' && node[key] === Number.MAX_SAFE_INTEGER) continue;

    // Inside properties a key is a field name, which may well be title or default.
    out[key] = key === 'properties'
      ? Object.fromEntries(
          Object.keys(node[key]).sort().map((name) => [name, normalize(node[key][name], defs)]),
        )
      : key === 'required' ? [...node[key]].sort()
      : normalize(node[key], defs);
  }

  return out;
}

/** The paths where two schemas differ, so a failure says what to fix. */
function differences(ts, py, at = '') {
  if (JSON.stringify(ts) === JSON.stringify(py)) return [];

  const objects = [ts, py].every((v) => typeof v === 'object' && v !== null && !Array.isArray(v));

  if (!objects) return [at + ': TS ' + JSON.stringify(ts) + ' / Python ' + JSON.stringify(py)];

  return [...new Set([...Object.keys(ts), ...Object.keys(py)])]
    .sort()
    .flatMap((key) => differences(ts[key], py[key], at + '/' + key));
}

const [ts, py] = ['$TS_SCHEMA', '$PY_SCHEMA'].map((file) => {
  const schema = read(file);

  return normalize(schema, schema.\$defs ?? {});
});

const found = differences(ts, py);

if (found.length > 0) {
  console.error('✗ IR schemas diverged:');

  for (const line of found) console.error('  ' + line);

  process.exit(1);
}
"

echo "✓ TS ↔ Python IR schemas match"
