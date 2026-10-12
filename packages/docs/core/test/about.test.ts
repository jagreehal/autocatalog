import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CatalogResource } from 'autocatalog-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDescribesRelationships, resolveAbout } from '../src/about';
import { checkDocs } from '../src/check';
import type { Doc } from '../src/read-docs';

const event = (repository: string): CatalogResource => ({
  ref: {
    kind: 'event',
    namespace: `${repository}/payments`,
    id: 'payment.captured',
    version: '1.0.0',
  },
  title: 'Payment captured',
  tags: [],
  provenance: { default: 'extracted', fields: {} },
  needsReview: false,
  attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
});

const agent: CatalogResource = {
  ref: { kind: 'agent', id: 'support-triage' },
  title: 'Support triage',
  tags: [],
  provenance: { default: 'declared', fields: {} },
  needsReview: false,
  attributes: {},
};

describe('resolveAbout', () => {
  it('names an event as event/<domain>/<id>, the form agents consume it by', () => {
    expect(resolveAbout('event/payments/payment.captured', [event('a'), agent])).toEqual({
      ref: event('a').ref,
    });
    expect(resolveAbout('agent/support-triage', [event('a'), agent])).toEqual({ ref: agent.ref });
  });

  it('suggests the near miss for a reference that does not resolve', () => {
    expect(resolveAbout('agent/suport-triage', [agent])).toEqual({
      failure:
        "about 'agent/suport-triage' does not resolve — did you mean 'agent/support-triage'?",
    });
  });

  it("prefers the document's own repository, and refuses to guess between two others", () => {
    const resources = [event('a'), event('b')];

    expect(resolveAbout('event/payments/payment.captured', resources, 'b')).toEqual({
      ref: event('b').ref,
    });
    expect(resolveAbout('event/payments/payment.captured', resources, 'c')).toHaveProperty(
      'failure',
      expect.stringContaining('names 2 resources'),
    );
  });
});

describe('createDescribesRelationships', () => {
  it('draws a declared describes edge, and reports what does not resolve', () => {
    const docs: Doc[] = [
      {
        id: 'a/runbook',
        repo: 'a',
        file: 'a/docs/runbook.md',
        data: { title: 'Runbook', owner: 'Ops', about: ['agent/support-triage', 'service/nope'] },
        body: '',
      },
    ];

    const { relationships, failures } = createDescribesRelationships(docs, [agent]);

    expect(relationships).toEqual([
      {
        type: 'describes',
        from: { kind: 'document', namespace: 'a', id: 'runbook' },
        to: agent.ref,
        provenance: 'declared',
        needsReview: false,
        source: { file: 'a/docs/runbook.md', repo: 'a' },
      },
    ]);
    expect(failures).toEqual(["a/docs/runbook.md: about 'service/nope' does not resolve"]);
  });
});

describe('checkDocs about:', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-about-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function runbook(about: string): Promise<void> {
    await fs.mkdir(path.join(root, 'a/docs'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'a/docs/runbook.md'),
      `---\ntitle: Runbook\nowner: Ops\nabout:\n  - ${about}\n---\n\nBody.\n`,
    );
  }

  it('fails an unknown target with the near miss', async () => {
    await runbook('event/payments/payment.capture');

    expect(checkDocs(root, { resources: [event('a')] }).failures).toEqual([
      "a/docs/runbook.md: about 'event/payments/payment.capture' does not resolve — did you mean 'event/payments/payment.captured'?",
    ]);
  });

  it('leaves a kind this checkout defines none of to the composed site', async () => {
    // Another repository's agent: failing here would block documenting it.
    await runbook('agent/billing-bot');

    expect(checkDocs(root, { resources: [event('a')] }).failures).toEqual([]);
  });

  it('rejects a reference that is not kind/id', async () => {
    await runbook('payment.captured');

    expect(checkDocs(root).failures.join('\n')).toContain('about.0');
  });
});
