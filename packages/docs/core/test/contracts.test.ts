import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchemaAjv } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { defaultConventionsFile, docKinds } from '../src/kinds';

const here = path.dirname(fileURLToPath(import.meta.url));

const contract = async (file: string) =>
  jsonSchemaAjv('2020-12').compile(
    JSON.parse(await fs.readFile(path.join(here, '../contracts', file), 'utf8')),
  );

const source = {
  kind: 'event',
  files: ['sdk/event-schemas.json'],
  match: ['v{version}.{id}'],
  domain: 'payments',
  meta: { owner: { team: 'payments' } },
};

describe('the published conventions contract', () => {
  it('takes what init-conventions writes, with sources', async () => {
    const validate = await contract('autocatalog.conventions.schema.json');

    expect(validate({ ...defaultConventionsFile(), sources: [source] })).toBe(true);
  });

  it('refuses a source it does not know', async () => {
    const validate = await contract('autocatalog.conventions.schema.json');

    expect(validate({ sources: [{ ...source, nope: true }] })).toBe(false);
  });

  it('leaves document kinds working beside sources', () => {
    expect(docKinds({ sources: [source] }).map(({ id }) => id)).toContain('adr');
  });
});
