import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocsManifest, DocsManifestError } from '../src/manifest';
import { checkDocs } from '../src/check';
import { docToMarkdown, readDocs, resolveDocsLayout } from '../src/read-docs';
import {
  declaredFrontmatterFields,
  DEFAULT_FRONTMATTER_SCHEMA,
  resolveFrontmatterContract,
} from '../src/frontmatter';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const doc = (title: string, extra = ''): string =>
  `---\ntitle: ${title}\nowner: Payments\n${extra}---\n\nBody text.\n`;

describe('readDocs', () => {
  it('addresses a doc by its path, across sibling repos', async () => {
    await write('payments-service/docs/runbook.md', doc('Runbook'));
    await write('payments-service/docs/ops/replay.md', doc('Replay'));
    await write('reporter/docs/daily.md', doc('Daily'));

    expect(readDocs(root).map((d) => d.id)).toEqual([
      'payments-service/ops/replay',
      'payments-service/runbook',
      'reporter/daily',
    ]);
  });

  it('reads a single repository publishing its own docs/', async () => {
    await write('docs/runbook.md', doc('Runbook'));

    // The same call works in a standalone repo's CI without being reconfigured.
    const found = readDocs(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(`${path.basename(root)}/runbook`);
    expect(readDocs(root, { repo: 'payments-service' })[0]!.id).toBe('payments-service/runbook');
  });

  it('parses frontmatter with a YAML parser, not a regex', async () => {
    // A title containing a colon is where hand-rolled readers quietly break.
    await write('a/docs/x.md', '---\ntitle: "Incident: 02:40 replay"\nowner: Ops\n---\n\nBody.\n');
    expect(readDocs(root)[0]!.data.title).toBe('Incident: 02:40 replay');
  });
});

describe('resolveDocsLayout', () => {
  it('derives the same ids the reader does, so other readers cannot drift', async () => {
    await write('payments-service/docs/ops/replay.md', doc('Replay'));

    const layout = resolveDocsLayout(root);
    // An Astro content collection globs the pattern itself and only asks for
    // the id, so both sides must come from here.
    expect(layout.pattern).toBe('payments-service/docs/**/*.{md,mdx}');
    expect(layout.idFor('payments-service/docs/ops/replay.md')).toBe(readDocs(root)[0]!.id);
    expect(layout.repoFor('payments-service/docs/ops/replay.md')).toBe('payments-service');
  });

  it('names the root for a single repository publishing its own docs/', async () => {
    await write('docs/runbook.md', doc('Runbook'));

    const layout = resolveDocsLayout(root, { repo: 'payments-service' });
    expect(layout.pattern).toBe('docs/**/*.{md,mdx}');
    expect(layout.idFor('docs/runbook.md')).toBe('payments-service/runbook');
    expect(layout.idFor('docs/overview.mdx')).toBe('payments-service/overview');
  });

  it('finds the docs of packages inside a monorepo, named for their folder', async () => {
    await write('platform/package.json', '{}');
    await write('platform/docs/workspace.md', doc('Workspace'));
    await write('platform/services/orders/package.json', '{}');
    await write('platform/services/orders/docs/runbook.md', doc('Runbook'));
    await write('payments-service/docs/runbook.md', doc('Runbook'));
    // Test data is never a repository, wherever it sits.
    await write('platform/services/orders/test/fixtures/docs/stray.md', doc('Stray'));

    expect(readDocs(root).map(({ id, repo }) => [id, repo])).toEqual([
      ['payments-service/runbook', 'payments-service'],
      ['platform/workspace', 'platform'],
      ['orders/runbook', 'orders'],
    ]);
  });
});

describe('a root given an identity of its own', () => {
  it('keeps out a package publishing under that identity, as the catalog does', async () => {
    await write('package.json', '{}');
    await write('docs/workspace.md', doc('Workspace'));
    await write('services/orders/package.json', '{}');
    await write('services/orders/docs/index.md', doc('Orders'));

    const layout = resolveDocsLayout(root, { repo: 'platform', repository: 'orders' });

    expect(layout.roots.map(({ name }) => name)).toEqual(['platform']);
    expect(layout.pattern).toBe('docs/**/*.{md,mdx}');
  });
});

describe('docToMarkdown', () => {
  it('round-trips frontmatter that a hand-built writer would break', async () => {
    await write('a/docs/x.md', '---\ntitle: "Incident: 02:40 replay"\nowner: Ops\n---\n\nBody.\n');
    const original = readDocs(root)[0]!;

    await write('b/docs/x.md', docToMarkdown(original.data, original.body));
    const republished = readDocs(root).find((entry) => entry.repo === 'b')!;

    expect(republished.data).toEqual(original.data);
    expect(republished.body.trim()).toBe(original.body.trim());
  });
});

describe('the frontmatter contract', () => {
  // A company's own contract: the default plus a required field of its own.
  const companySchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['title', 'owner', 'tier'],
    properties: {
      title: { type: 'string' },
      owner: { type: 'string' },
      tier: { enum: ['critical', 'standard'] },
    },
    additionalProperties: true,
  };

  it('falls back to the built-in contract, so day one needs no setup', () => {
    expect(resolveFrontmatterContract(root)).toEqual({
      schema: DEFAULT_FRONTMATTER_SCHEMA,
      file: null,
    });
  });

  it('finds the committed contract without being told where it is', async () => {
    await write('contracts/docs-frontmatter.json', JSON.stringify(companySchema));

    const contract = resolveFrontmatterContract(root);
    expect(contract.file).toBe(path.join(root, 'contracts/docs-frontmatter.json'));
    expect(contract.schema).toEqual(companySchema);
  });

  it('finds the contract an enrolled repository publishes, the handbook pattern', async () => {
    await write('handbook/contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('payments-service/docs/runbook.md', doc('Runbook'));

    const contract = resolveFrontmatterContract(root);
    expect(contract.file).toBe(path.join(root, 'handbook/contracts/docs-frontmatter.json'));
    expect(contract.schema).toEqual(companySchema);
  });

  it("never follows an enrolled repository's symlink out of it", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

    try {
      await fs.writeFile(path.join(outside, 'secret.json'), JSON.stringify(companySchema));
      await fs.mkdir(path.join(root, 'linked/contracts'), { recursive: true });
      await fs.symlink(
        path.join(outside, 'secret.json'),
        path.join(root, 'linked/contracts/docs-frontmatter.json'),
      );
      await fs.mkdir(path.join(root, 'escaped'));
      await fs.symlink(outside, path.join(root, 'escaped/contracts'));
      await fs.rename(
        path.join(outside, 'secret.json'),
        path.join(outside, 'docs-frontmatter.json'),
      );

      expect(resolveFrontmatterContract(root)).toEqual({
        schema: DEFAULT_FRONTMATTER_SCHEMA,
        file: null,
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("prefers the root's own contract to an enrolled repository's", async () => {
    await write('contracts/docs-frontmatter.json', JSON.stringify(DEFAULT_FRONTMATTER_SCHEMA));
    await write('handbook/contracts/docs-frontmatter.json', JSON.stringify(companySchema));

    expect(resolveFrontmatterContract(root).file).toBe(
      path.join(root, 'contracts/docs-frontmatter.json'),
    );
  });

  it('accepts the copies `ac docs sync-schema` keeps in other repositories', async () => {
    await write('handbook/contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('payments/contracts/docs-frontmatter.json', JSON.stringify(companySchema));

    expect(resolveFrontmatterContract(root).schema).toEqual(companySchema);
  });

  it('refuses to choose between two different contracts, and names both', async () => {
    await write('handbook/contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('payments/contracts/docs-frontmatter.json', JSON.stringify({ type: 'object' }));

    expect(() => resolveFrontmatterContract(root)).toThrow(
      /handbook\/contracts\/docs-frontmatter\.json.*payments\/contracts\/docs-frontmatter\.json.*--docs-schema/s,
    );
    // Told which, it does not have to choose.
    expect(
      resolveFrontmatterContract(root, path.join(root, 'handbook/contracts/docs-frontmatter.json'))
        .schema,
    ).toEqual(companySchema);
  });

  it("does not look inside one repository's subdirectories for a contract", async () => {
    await write('docs/readme.md', doc('Readme'));
    await write('vendor/contracts/docs-frontmatter.json', JSON.stringify(companySchema));

    expect(resolveFrontmatterContract(root).file).toBeNull();
  });

  it('lets an explicit path win over the conventional one', async () => {
    await write('contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('other.json', JSON.stringify(DEFAULT_FRONTMATTER_SCHEMA));

    expect(resolveFrontmatterContract(root, path.join(root, 'other.json')).schema).toEqual(
      DEFAULT_FRONTMATTER_SCHEMA,
    );
  });

  it('enforces the company contract, flag-free, on every document', async () => {
    await write('contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('a/docs/ok.md', doc('Fine', 'tier: critical\n'));
    await write('a/docs/bad.md', doc('No tier here'));

    const result = checkDocs(root);
    expect(result.contractFile).toContain('docs-frontmatter.json');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('bad.md');
    expect(result.failures[0]).toContain('tier');
  });

  it('rejects a value outside the company vocabulary', async () => {
    await write('contracts/docs-frontmatter.json', JSON.stringify(companySchema));
    await write('a/docs/ok.md', doc('Wrong tier', 'tier: gold\n'));

    expect(checkDocs(root).failures.join('\n')).toMatch(/tier/);
  });

  it('names the fields a site has to keep, so a company field survives to the page', () => {
    // A collection drops anything it was not told about; this is how the site
    // learns what `tier` is without a second registration.
    expect(declaredFrontmatterFields(companySchema)).toEqual(['title', 'owner', 'tier']);
    expect(declaredFrontmatterFields({})).toEqual([]);
  });

  it('catches a related id that is not a cross-repository id at all', async () => {
    await write('a/docs/one.md', doc('One', 'related:\n  - ./two.md\n'));

    // The default contract requires `<repo>/<path>`; a relative path here is
    // the mistake the whole rule exists to prevent.
    expect(checkDocs(root).failures.join('\n')).toContain('related');
  });
});

describe('buildDocsManifest', () => {
  it('derives backlinks so a target need not know who points at it', async () => {
    await write(
      'acme-handbook/docs/incident-policy.md',
      doc('Policy', 'related:\n  - payments-service/runbook\n'),
    );
    await write('payments-service/docs/runbook.md', doc('Runbook'));

    const manifest = buildDocsManifest(root, { includeDates: false });
    expect(manifest['payments-service/runbook']!.linkedFrom).toEqual([
      'acme-handbook/incident-policy',
    ]);
    expect(manifest['acme-handbook/incident-policy']!.linkedFrom).toEqual([]);
    expect(manifest['payments-service/runbook']!.title).toBe('Runbook');
  });

  it('refuses to publish an index describing an invalid doc', async () => {
    await write('a/docs/ok.md', doc('Fine'));
    await write('a/docs/bad.md', '---\ntitle: No owner here\n---\n\nBody.\n');

    // A partial index would make "do my links resolve" quietly unreliable.
    expect(() => buildDocsManifest(root, { includeDates: false })).toThrow(DocsManifestError);
  });
});

describe('checkDocs', () => {
  it('passes a well-formed set', async () => {
    await write('a/docs/one.md', doc('One', 'related:\n  - a/two\n'));
    await write('a/docs/two.md', doc('Two'));

    const result = checkDocs(root);
    expect(result.failures).toEqual([]);
    expect(result.docs).toBe(2);
    expect(result.repos).toBe(1);
  });

  it('reports missing required frontmatter', async () => {
    await write('a/docs/bad.md', '---\ntitle: Only a title\n---\n\nBody.\n');
    expect(checkDocs(root).failures.join('\n')).toContain('owner');
  });

  it('rejects a relative link into a sibling repo', async () => {
    await write('a/docs/one.md', `${doc('One')}\nSee [the runbook](../../b/docs/runbook.md).\n`);
    expect(checkDocs(root).failures.join('\n')).toContain('links into another repo by path');
  });

  it('ignores the wrong form when a doc is teaching it', async () => {
    await write(
      'a/docs/one.md',
      `${doc('One')}\nDo not do this:\n\n\`\`\`md\n[bad](../../b/docs/x.md)\n\`\`\`\n`,
    );
    expect(checkDocs(root).failures).toEqual([]);
  });

  it('catches a dangling link within this checkout', async () => {
    await write('a/docs/one.md', doc('One', 'related:\n  - a/nope\n'));
    expect(checkDocs(root).failures.join('\n')).toContain("related 'a/nope' does not resolve");
  });

  it('leaves cross-repo links unchecked until an index exists', async () => {
    await write('a/docs/one.md', doc('One', 'related:\n  - elsewhere/thing\n'));

    const result = checkDocs(root);
    // Failing here would block the first publisher from ever linking out.
    expect(result.failures).toEqual([]);
    expect(result.checkedCrossRepoLinks).toBe(false);
  });

  it('catches deleting a doc that others still link to', async () => {
    await write('a/docs/one.md', doc('One'));
    await write(
      'contracts/docs-manifest.json',
      JSON.stringify({
        'a/one': { owner: 'Payments', title: 'One', updated: null, linkedFrom: [] },
        'a/gone': { owner: 'Payments', title: 'Gone', updated: null, linkedFrom: ['a/one'] },
      }),
    );

    expect(checkDocs(root).failures.join('\n')).toContain('a/gone no longer exists');
  });
});
