#!/usr/bin/env node
// Writes the JSON Schemas a company follows to publish into the catalog without
// using our code. They are generated, so they cannot disagree with it:
// `--check` fails when a committed file is out of date.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_BY_KIND } from '../packages/agents/core/dist/index.js';
import {
  docsConventionsSchema,
  repositoryMetaSchema,
  siteConfigSchema,
} from '../packages/docs/core/dist/index.js';
import { eventFrontmatter } from '../packages/events/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// What a person writes, so a field with a default is optional. Refinements have
// no JSON Schema form; the catalog still applies them when it reads the file.
const jsonSchema = (schema) => schema.toJSONSchema({ io: 'input', unrepresentable: 'any' });

// A manifest may leave `id` out: its folder or file name gives it.
const agentContract = (schema) => {
  const contract = jsonSchema(schema);

  return { ...contract, required: contract.required.filter((field) => field !== 'id') };
};

const contracts = {
  'packages/events/core/contracts/event-manifest.schema.json': jsonSchema(eventFrontmatter),
  'packages/docs/core/contracts/autocatalog.conventions.schema.json':
    jsonSchema(docsConventionsSchema),
  'packages/docs/core/contracts/docs-meta.schema.json': jsonSchema(repositoryMetaSchema),
  'packages/docs/core/contracts/autocatalog.site.schema.json': jsonSchema(siteConfigSchema),
  ...Object.fromEntries(
    Object.entries(SCHEMA_BY_KIND).map(([kind, schema]) => [
      `packages/agents/core/contracts/${kind}.schema.json`,
      agentContract(schema),
    ]),
  ),
};

const check = process.argv.includes('--check');

const stale = [];

for (const [file, schema] of Object.entries(contracts)) {
  const target = path.join(root, file);
  const content = `${JSON.stringify(schema, null, 2)}\n`;

  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) stale.push(file);
    continue;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

if (stale.length > 0) {
  console.error(`Out of date, run pnpm contracts:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}

console.log(`${Object.keys(contracts).length} contracts ${check ? 'match the code' : 'written'}`);
