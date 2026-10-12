import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backstageHttpClient,
  datadogHttpClient,
  getCatalogJson,
  importBackstageYaml,
  resolveResourceOwnership,
  syncBackstageOwnership,
  syncDatadogOwnership,
} from '../src/ownership-sources';
import { architectureResource, architectureService, emptyResourceGraph } from '../src/architecture';
import { parseCodeowners } from '../src/codeowners';
import type { JsonValue } from '../src/json';

describe('ownership sources', () => {
  it('imports Backstage services and owners while retaining explicit ownership and CODEOWNERS fallback', () => {
    const imported = importBackstageYaml(
      `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: billing
spec:
  type: service
  owner: group:default/ledger-team
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: reconciliation
spec:
  type: service
  owner: group:default/finance
`,
      'catalog-info.yaml',
    );

    const graph = emptyResourceGraph();
    graph.resources.push(
      {
        ...architectureService('billing'),
        owner: { team: 'local-team' },
        provenance: { default: 'declared', fields: { owner: 'declared' } },
      },
      architectureService('reconciliation'),
      {
        ...architectureResource({
          kind: 'collection',
          namespace: 'curve/finance',
          id: 'statements',
        }),
        source: { file: 'models/statement.ts' },
      },
    );

    const result = resolveResourceOwnership(graph, {
      claims: imported.claims,
      codeowners: parseCodeowners('/models/** @curve/ledger'),
      teamAliases: { 'group:default/finance': 'finance-team' },
    });

    expect(
      result.graph.resources.find((resource) => resource.ref.id === 'billing')?.owner?.team,
    ).toBe('local-team');
    expect(
      result.graph.resources.find((resource) => resource.ref.id === 'reconciliation')?.owner?.team,
    ).toBe('finance-team');
    expect(
      result.graph.resources.find((resource) => resource.ref.id === 'statements')?.owner?.team,
    ).toBe('curve/ledger');
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        resource: { kind: 'service', id: 'billing' },
        selected: 'local-team',
        alternatives: ['group:default/ledger-team'],
      }),
    );
    expect(imported.graph.resources).toContainEqual(
      expect.objectContaining({
        ref: { kind: 'service', id: 'reconciliation' },
        provenance: { default: 'extracted', fields: {} },
      }),
    );
  });
  it('syncs paginated catalog APIs and prefers Backstage processed ownedBy relations', async () => {
    const cursors: Array<string | undefined> = [];

    const backstage = await syncBackstageOwnership(
      {
        getEntities: async (cursor): Promise<JsonValue> => {
          cursors.push(cursor);

          return cursor
            ? { items: [], pageInfo: {} }
            : {
                items: [
                  {
                    kind: 'Component',
                    metadata: { name: 'billing' },
                    spec: { type: 'service', owner: 'stale-owner' },
                    relations: [{ type: 'ownedBy', targetRef: 'group:default/ledger' }],
                  },
                ],
                pageInfo: { nextCursor: 'next-page' },
              };
        },
      },
      'https://backstage.example/api/catalog',
    );

    expect(cursors).toEqual([undefined, 'next-page']);
    expect(backstage.claims[0]?.team).toBe('group:default/ledger');
    const pages: number[] = [];

    const datadog = await syncDatadogOwnership(
      {
        getDefinitions: async (page) => {
          pages.push(page);

          return {
            data:
              page === 0
                ? [{ attributes: { schema: { 'dd-service': 'billing', team: 'ledger-team' } } }]
                : [],
          };
        },
      },
      'https://api.datadoghq.eu',
      1,
    );

    expect(pages).toEqual([0, 1]);
    expect(datadog.claims).toEqual([
      {
        resource: { kind: 'service', id: 'billing' },
        team: 'ledger-team',
        source: 'datadog',
        location: 'https://api.datadoghq.eu',
      },
    ]);
    await expect(
      syncBackstageOwnership(
        { getEntities: async () => ({ items: [], pageInfo: { nextCursor: 'loop' } }) },
        'catalog',
      ),
    ).rejects.toThrow('Repeated Backstage cursor');
  });

  describe('owner normalization', () => {
    const declared = (team: string) => {
      const graph = emptyResourceGraph();

      graph.resources.push({
        ...architectureResource({ kind: 'collection', namespace: 'main', id: 'statements' }),
        owner: { team },
        provenance: { default: 'declared', fields: {} },
        source: { file: 'models/statement.ts' },
      });

      return graph;
    };

    it('does not report an explicit owner as conflicting with its own alias', () => {
      const result = resolveResourceOwnership(declared('group:default/ledger'), {
        claims: [
          {
            resource: { kind: 'collection', namespace: 'main', id: 'statements' },
            team: 'ledger',
            source: 'backstage',
            location: 'catalog-info.yaml',
          },
        ],
        teamAliases: { 'group:default/ledger': 'ledger' },
      });

      expect(result.conflicts).toEqual([]);
      expect(result.graph.resources[0]?.owner).toEqual({ team: 'group:default/ledger' });
    });

    it('does not report @team as conflicting with the same CODEOWNERS team', () => {
      const result = resolveResourceOwnership(declared('@ledger'), {
        claims: [],
        codeowners: parseCodeowners('/models/** @ledger'),
      });

      expect(result.conflicts).toEqual([]);
    });

    it('reads aliases as data: a team named after an Object property is itself', () => {
      for (const team of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        const result = resolveResourceOwnership(declared('local'), {
          claims: [],
          codeowners: parseCodeowners(`/models/** ${team}`),
          teamAliases: JSON.parse('{"__proto__": "aliased", "ledger": "finance"}'),
        });

        expect(result.conflicts).toEqual([
          {
            resource: { kind: 'collection', namespace: 'main', id: 'statements' },
            selected: 'local',
            alternatives: [team === '__proto__' ? 'aliased' : team],
          },
        ]);
      }
    });
  });

  describe('catalog requests', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('refuses to send credentials over plain http to a remote host', async () => {
      const fetch = vi.fn();

      vi.stubGlobal('fetch', fetch);

      await expect(
        backstageHttpClient('http://backstage.example.com/api/catalog', 'secret').getEntities(),
      ).rejects.toThrow(
        'Refusing to send credentials over http: to backstage.example.com; use https',
      );
      await expect(
        datadogHttpClient('http://api.datadoghq.com', 'key', 'app').getDefinitions(0),
      ).rejects.toThrow('Refusing to send credentials over http: to api.datadoghq.com; use https');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('allows plain http to loopback, and without credentials', async () => {
      const fetch = vi.fn(async () => Response.json({ ok: true }));

      vi.stubGlobal('fetch', fetch);

      for (const url of ['http://localhost:7007/x', 'http://127.0.0.1/x', 'http://[::1]/x'])
        await expect(getCatalogJson(new URL(url), { Authorization: 'Bearer t' })).resolves.toEqual({
          ok: true,
        });

      await expect(getCatalogJson(new URL('http://catalog.example.com/x'))).resolves.toEqual({
        ok: true,
      });
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('stops reading a response larger than the limit', async () => {
      const chunk = new Uint8Array(1024 * 1024).fill(32);
      let sent = 0;

      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent++;

          if (sent > 64) controller.close();
          else controller.enqueue(chunk);
        },
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body)),
      );

      await expect(getCatalogJson(new URL('https://catalog.example.com/x'))).rejects.toThrow(
        'Catalog response from https://catalog.example.com/x is larger than 16777216 bytes',
      );
      expect(sent).toBeLessThan(20);
    });
  });
});
