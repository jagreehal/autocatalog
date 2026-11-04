import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchemaAjv } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { mcpServerDraft } from './mcp-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const contract = async (kind: string) =>
  jsonSchemaAjv('2020-12').compile(
    JSON.parse(await fs.readFile(path.join(here, `../contracts/${kind}.schema.json`), 'utf8')),
  );

describe('the published entity contracts', () => {
  it('takes a manifest that leaves its id to the folder', async () => {
    const validate = await contract('mcp-server');

    expect(validate({ name: 'GitHub', owner: 'platform', transport: 'http' })).toBe(true);
  });

  it('takes the manifest discovery drafts', async () => {
    const validate = await contract('mcp-server');

    const draft = mcpServerDraft({
      id: 'github',
      name: 'github',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp',
      origin: 'unknown',
      sources: [{ file: '.mcp.json', line: 1, symbol: 'github' }],
    });

    expect(validate(JSON.parse(JSON.stringify(draft)))).toBe(true);
  });

  it('refuses a manifest with no owner', async () => {
    const validate = await contract('mcp-server');

    expect(validate({ name: 'GitHub', transport: 'http' })).toBe(false);
  });
});
