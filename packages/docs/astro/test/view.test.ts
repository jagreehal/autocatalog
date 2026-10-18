import type { DocsManifest } from 'autocatalog-docs-core';
import { describe, expect, it, vi } from 'vitest';
import { renderLlmsTxt } from '../src/llms';
import {
  catalogAnchor,
  catalogHref,
  day,
  docHref,
  groupByRepo,
  groupByTag,
  listItems,
  toLinks,
} from '../src/view';

const manifest: DocsManifest = {
  'acme-handbook/incident-policy': {
    owner: 'Reliability',
    title: 'Incident policy',
    updated: '2026-03-04T09:00:00Z',
    source: null,
    edit: null,
    linkedFrom: [],
    kind: null,
    status: null,
    date: null,
  },
  'payments-service/runbook': {
    owner: 'Payments',
    title: 'Runbook',
    updated: null,
    source: null,
    edit: null,
    linkedFrom: ['acme-handbook/incident-policy'],
    kind: null,
    status: null,
    date: null,
  },
};

const entries = [
  { id: 'payments-service/runbook', data: { title: 'Runbook', owner: 'Payments', tags: ['ops'] } },
  {
    id: 'acme-handbook/incident-policy',
    data: { title: 'Incident policy', owner: 'Reliability', tags: ['ops', 'policy'] },
  },
];

describe('listItems', () => {
  it('carries the git date from the index, not from frontmatter', () => {
    const items = listItems(entries, manifest);
    expect(items.map((item) => item.id)).toEqual([
      'acme-handbook/incident-policy',
      'payments-service/runbook',
    ]);
    expect(items[0]!.updated).toBe('2026-03-04T09:00:00Z');
    expect(items[1]!.updated).toBeNull();
  });

  it('survives a document the index does not know about', () => {
    // A build reading a checkout the manifest predates must still render.
    const items = listItems([{ id: 'new/thing', data: { title: 'New', owner: 'Ops' } }], manifest);
    expect(items[0]).toMatchObject({ repo: 'new', updated: null, tags: [] });
  });
});

describe('grouping', () => {
  it('groups by repository in name order', () => {
    expect(groupByRepo(listItems(entries, manifest)).map(([repo]) => repo)).toEqual([
      'acme-handbook',
      'payments-service',
    ]);
  });

  it('lists a document under every tag it declares, and untagged ones nowhere', () => {
    const items = listItems(
      [...entries, { id: 'a/b', data: { title: 'B', owner: 'X' } }],
      manifest,
    );

    expect(groupByTag(items).map(([tag, docs]) => [tag, docs.length])).toEqual([
      ['ops', 2],
      ['policy', 1],
    ]);
  });
});

describe('day', () => {
  it('formats an ISO date once, for every surface', () => {
    expect(day('2026-03-04T09:00:00Z')).toBe('4 Mar 2026');
  });

  it('keeps a date-only value on its own day in a timezone behind UTC', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');

    try {
      expect(day('2026-10-18')).toBe('18 Oct 2026');
      expect(day('2026-03-04T09:00:00Z')).toBe('4 Mar 2026');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('renders nothing rather than a guess when git could not say', () => {
    // A stale date on a runbook is worse than none: it reads as a promise.
    expect(day(null)).toBeNull();
    expect(day(undefined)).toBeNull();
    expect(day('not a date')).toBeNull();
  });
});

describe('toLinks', () => {
  it('resolves an edge to the target title', () => {
    expect(toLinks(['payments-service/runbook'], manifest)).toEqual([
      {
        id: 'payments-service/runbook',
        title: 'Runbook',
        repo: 'payments-service',
        resolved: true,
      },
    ]);
  });

  it('marks an edge whose target is not published, instead of hiding it', () => {
    const [link] = toLinks(['elsewhere/thing'], manifest);
    expect(link).toMatchObject({ title: 'elsewhere/thing', resolved: false });
  });
});

describe('docHref', () => {
  it('is root-relative when the site is served from the root', () => {
    expect(docHref('payments-service/runbook')).toBe('/payments-service/runbook');
  });

  it('keeps the configured base, so a site under a path still navigates', () => {
    vi.stubEnv('BASE_URL', '/docs/');
    expect(docHref('payments-service/runbook')).toBe('/docs/payments-service/runbook');
    vi.unstubAllEnvs();
  });
});

describe('Catalog links', () => {
  const ref = { kind: 'agent', namespace: 'support', id: 'refund agent', version: '2' };

  it('uses collision-safe graph identity for an inventory anchor', () => {
    expect(catalogAnchor(ref)).toBe('resource-agent%3Asupport%2Frefund%2520agent%402');
  });

  it('keeps the deployment base when linking into the inventory', () => {
    vi.stubEnv('BASE_URL', '/engineering/');
    expect(catalogHref(ref)).toBe(
      '/engineering/catalog#resource-agent%3Asupport%2Frefund%2520agent%402',
    );
    vi.unstubAllEnvs();
  });
});

describe('renderLlmsTxt', () => {
  it('emits the format: H1, blockquote, H2 per repository', () => {
    const text = renderLlmsTxt({
      title: 'Acme docs',
      description: 'Everything under docs/.',
      base: 'https://docs.acme.test',
      items: listItems(entries, manifest),
    });

    expect(text).toContain('# Acme docs\n');
    expect(text).toContain('> Everything under docs/.');
    expect(text).toContain('## acme-handbook');
    // Links point at the markdown twins: that is the half agents actually fetch.
    expect(text).toContain(
      '- [Incident policy](https://docs.acme.test/acme-handbook/incident-policy.md): owned by Reliability',
    );
  });

  it('emits relative links when the site has no configured origin', () => {
    const text = renderLlmsTxt({
      title: 'Docs',
      description: 'x',
      base: '',
      items: listItems(entries, manifest),
    });

    expect(text).toContain('(/payments-service/runbook.md)');
  });
});
