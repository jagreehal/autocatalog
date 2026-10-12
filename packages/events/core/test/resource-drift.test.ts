import { describe, expect, it } from 'vitest';
import { architectureResource, architectureService, emptyResourceGraph } from '../src/architecture';
import { asDriftFinding, driftResources, validateResourceDocuments } from '../src/resource-drift';
import { compatibilityBreaks, summariseDrift } from '../src/drift';
import type { ResourceGraph } from '../src/resource-graph';
import type { JsonObject } from '../src/json';

describe('resource contract drift', () => {
  it('names readers affected by a collection field removal while retaining unknown reader usage', () => {
    const baseline = emptyResourceGraph();
    const ref = { kind: 'collection', namespace: 'curve/finance', id: 'statements' } as const;
    baseline.resources.push(
      architectureResource(ref, {
        schema: {
          type: 'object',
          properties: { amount: { type: 'number' }, currency: { type: 'string' } },
        },
      }),
      architectureService('reconciliation'),
      architectureService('reporting'),
      architectureService('legacy'),
    );

    for (const [service, fields] of [
      ['reconciliation', ['amount']],
      ['reporting', ['currency']],
      ['legacy', []],
    ] as const)
      baseline.relationships.push({
        type: 'reads',
        from: { kind: 'service', id: service },
        to: ref,
        provenance: 'declared',
        needsReview: false,
        attributes: fields.length ? { fields: [...fields] } : undefined,
      });

    const current = {
      ...baseline,
      resources: baseline.resources.map((resource) =>
        resource.ref.kind === 'collection'
          ? architectureResource(ref, {
              schema: { type: 'object', properties: { currency: { type: 'string' } } },
            })
          : resource,
      ),
    };

    expect(driftResources(baseline, current)).toContainEqual(
      expect.objectContaining({
        resource: ref,
        code: 'field_removed',
        severity: 'breaking',
        affectedServices: ['legacy', 'reconciliation'],
      }),
    );
  });
  it('flags invalid complete documents without reporting sensitive values or treating projections as documents', () => {
    const graph = emptyResourceGraph();
    const ref = { kind: 'collection', namespace: 'curve/finance', id: 'statements' } as const;
    graph.resources.push(
      architectureResource(ref, {
        schema: {
          type: 'object',
          properties: { amount: { type: 'number' }, accountId: { type: 'string' } },
          required: ['amount', 'accountId'],
        },
      }),
    );

    const report = validateResourceDocuments(graph, [
      {
        resource: ref,
        kind: 'document',
        value: { amount: 'wrong', accountId: 'secret-account-id' },
      },
      { resource: ref, kind: 'projection', value: { amount: 42 } },
      { resource: ref, kind: 'document', value: { amount: 42, accountId: 'valid-account' } },
    ]);

    expect(report).toMatchObject({
      checked: 2,
      skipped: 1,
      findings: [
        expect.objectContaining({
          code: 'document_schema_mismatch',
          path: '/amount',
          severity: 'suspicious',
        }),
      ],
    });
    expect(JSON.stringify(report)).not.toContain('secret-account-id');
  });
  it('reports a command outcome change to its senders and enforces handler cardinality', () => {
    const ref = {
      kind: 'command',
      namespace: 'ledger',
      id: 'GenerateStatement',
      version: '1.0.0',
    } as const;

    const baseline = emptyResourceGraph();
    baseline.resources.push(
      architectureResource(ref, {
        schema: { type: 'object' },
        outcome: { type: 'result' },
        outcomeSchema: {
          type: 'object',
          properties: { statementId: { type: 'string' } },
          required: ['statementId'],
        },
      }),
      architectureService('billing'),
      architectureService('worker'),
    );
    baseline.relationships.push(
      {
        type: 'sends',
        from: { kind: 'service', id: 'billing' },
        to: ref,
        provenance: 'declared',
        needsReview: false,
      },
      {
        type: 'handles',
        from: { kind: 'service', id: 'worker' },
        to: ref,
        provenance: 'declared',
        needsReview: false,
      },
    );

    const current = {
      ...baseline,
      resources: baseline.resources.map((resource) =>
        resource.ref.kind === 'command'
          ? architectureResource(ref, {
              schema: { type: 'object' },
              outcome: { type: 'completion' },
              outcomeSchema: null,
            })
          : resource,
      ),
    };

    expect(driftResources(baseline, current)).toContainEqual(
      expect.objectContaining({
        code: 'command_outcome_changed',
        severity: 'breaking',
        affectedServices: ['billing'],
      }),
    );
    expect(
      driftResources(baseline, {
        ...current,
        relationships: current.relationships.filter((edge) => edge.type !== 'handles'),
      }),
    ).toContainEqual(
      expect.objectContaining({ code: 'command_missing_handler', severity: 'breaking' }),
    );
  });
  it('compares the latest numeric registry version regardless of graph ordering', () => {
    const before = emptyResourceGraph();
    const after = emptyResourceGraph();

    for (const [graph, latest] of [
      [before, 10],
      [after, 11],
    ] as const) {
      graph.resources.push({
        ref: { kind: 'event', namespace: 'registry', id: 'statement', version: String(latest) },
        title: 'Statement',
        tags: [],
        provenance: { default: 'extracted', fields: {} },
        needsReview: false,
        attributes: {
          domain: 'registry',
          status: 'active',
          schema: 'schema.json',
          examples: 0,
          payloadSchema: {
            type: 'object',
            properties: latest === 10 ? { amount: { type: 'number' } } : {},
          },
        },
      });
      graph.resources.push({
        ref: { kind: 'event', namespace: 'registry', id: 'statement', version: '9' },
        title: 'Statement',
        tags: [],
        provenance: { default: 'extracted', fields: {} },
        needsReview: false,
        attributes: {
          domain: 'registry',
          status: 'active',
          schema: 'schema.json',
          examples: 0,
          payloadSchema: { type: 'object', properties: { amount: { type: 'number' } } },
        },
      });
    }

    expect(driftResources(before, after)).toContainEqual(
      expect.objectContaining({
        code: 'field_removed',
        severity: 'breaking',
        resource: { kind: 'event', namespace: 'registry', id: 'statement', version: '11' },
      }),
    );
  });

  it('reads service names as data: a reader named after an Object property is a reader', () => {
    const ref = { kind: 'collection', namespace: 'main', id: 'statements' } as const;

    const graph = (properties: JsonObject): ResourceGraph => ({
      ...emptyResourceGraph(),
      resources: [
        architectureResource(ref, { schema: { type: 'object', properties } }),
        architectureService('constructor'),
        architectureService('__proto__'),
        architectureService('reporting'),
      ],
      relationships: ['constructor', '__proto__', 'reporting'].map((service) => ({
        type: 'reads',
        from: { kind: 'service', id: service },
        to: ref,
        provenance: 'declared',
        needsReview: false,
        attributes: { fields: service === 'reporting' ? ['currency'] : ['amount'] },
      })),
    });

    const findings = driftResources(
      graph({ amount: { type: 'number' }, currency: { type: 'string' } }),
      graph({ currency: { type: 'string' } }),
    );

    expect(findings.map((finding) => [finding.code, finding.affectedServices])).toEqual([
      ['field_removed', ['__proto__', 'constructor']],
    ]);
  });

  describe('version acknowledgement and compatibility', () => {
    const commandGraph = (version: string, schema: JsonObject): ResourceGraph => ({
      ...emptyResourceGraph(),
      resources: [
        architectureResource(
          { kind: 'command', namespace: 'billing', id: 'generate', version },
          { schema, outcome: { type: 'completion' }, outcomeSchema: null },
        ),
        architectureService('worker'),
      ],
      relationships: [
        {
          type: 'handles',
          from: { kind: 'service', id: 'worker' },
          to: { kind: 'command', namespace: 'billing', id: 'generate', version },
          provenance: 'declared',
          needsReview: false,
        },
      ],
    });

    const v1 = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    const dropped = { type: 'object', properties: { b: { type: 'number' } } };

    it('acknowledges a breaking change shipped with a major bump, as event drift does', () => {
      const findings = driftResources(commandGraph('1.0.0', v1), commandGraph('2.0.0', dropped));
      const removed = findings.find((finding) => finding.code === 'field_removed');

      expect(removed).toMatchObject({
        severity: 'breaking',
        acknowledged: true,
        advice: 'Acknowledged by the major bump 1.0.0 → 2.0.0: notify worker before it ships',
        affectedServices: ['worker'],
      });
      expect(summariseDrift(findings.map(asDriftFinding))).toMatchObject({
        breaking: 1,
        acknowledged: 1,
        hasBreaking: false,
      });
    });

    it('does not acknowledge a minor bump', () => {
      const findings = driftResources(commandGraph('1.0.0', v1), commandGraph('1.1.0', dropped));
      const removed = findings.find((finding) => finding.code === 'field_removed');

      expect(removed?.acknowledged).toBeUndefined();
      expect(removed?.advice).toBe(
        'Next: keep `a` (mark it deprecated) until consumers move off it, or bump to 2.0.0 (1.1.0 is not a major bump) to mark it intentional and notify worker',
      );
      expect(summariseDrift(findings.map(asDriftFinding)).hasBreaking).toBe(true);
    });

    const collectionGraph = (schema?: JsonObject): ResourceGraph => {
      const ref = { kind: 'collection', namespace: 'main/finance', id: 'statements' } as const;

      return {
        ...emptyResourceGraph(),
        resources: [
          ...(schema ? [architectureResource(ref, { schema })] : []),
          architectureService('reporting'),
        ],
        relationships: schema
          ? [
              {
                type: 'reads',
                from: { kind: 'service', id: 'reporting' },
                to: ref,
                provenance: 'extracted',
                needsReview: false,
              },
            ]
          : [],
      };
    };

    const base = {
      type: 'object',
      properties: { amount: { type: 'number' }, currency: { type: 'string' } },
      required: ['amount'],
    };

    it('carries the compatibility modes each resource change violates', () => {
      const byCode = (after?: JsonObject) =>
        Object.fromEntries(
          driftResources(collectionGraph(base), collectionGraph(after)).map((finding) => [
            finding.code,
            finding.compatibility,
          ]),
        );

      expect(byCode()).toEqual({ resource_removed: ['backward', 'forward'] });
      expect(
        byCode({ ...base, properties: { currency: { type: 'string' } }, required: [] }),
      ).toEqual({ field_removed: ['forward'] });
      expect(byCode({ ...base, required: ['amount', 'currency'] })).toEqual({
        required_added: ['backward'],
      });
      expect(
        byCode({ ...base, properties: { ...base.properties, amount: { type: 'string' } } }),
      ).toEqual({ type_changed: ['backward', 'forward'] });
    });

    it('gates resource findings by the chosen compatibility strategy', () => {
      const gate = (after: JsonObject, mode: 'backward' | 'forward' | 'full') =>
        compatibilityBreaks(
          summariseDrift(
            driftResources(collectionGraph(base), collectionGraph(after)).map(asDriftFinding),
          ),
          mode,
        ).map((finding) => finding.kind);

      const requiredAdded = { ...base, required: ['amount', 'currency'] };

      expect(gate(requiredAdded, 'forward')).toEqual([]);
      expect(gate(requiredAdded, 'backward')).toEqual(['required_added']);
      expect(gate(requiredAdded, 'full')).toEqual(['required_added']);
      expect(
        compatibilityBreaks(
          summariseDrift(
            driftResources(collectionGraph(base), collectionGraph()).map(asDriftFinding),
          ),
          'forward',
        ).map((finding) => finding.kind),
      ).toEqual(['resource_removed']);
    });
  });
});

describe('access to another team’s datastore', () => {
  const invoices = { kind: 'table', namespace: 'billing', id: 'invoices' } as const;

  function owned<T extends { owner?: { team: string } }>(resource: T, team?: string): T {
    return team ? { ...resource, owner: { team } } : resource;
  }

  function graph(
    teams: { service?: string; table?: string },
    access: Array<{ type: 'reads' | 'writes' | 'defines'; reviewed?: boolean }> = [],
  ): ResourceGraph {
    const g = emptyResourceGraph();
    g.resources.push(
      owned(architectureResource(invoices), teams.table),
      owned(architectureService('checkout-api'), teams.service),
    );

    for (const edge of access)
      g.relationships.push({
        type: edge.type,
        from: { kind: 'service', id: 'checkout-api' },
        to: invoices,
        provenance: edge.reviewed ? 'declared' : 'observed',
        needsReview: !edge.reviewed,
        ...(edge.reviewed && { attributes: { reviewed: true } }),
      });

    return g;
  }

  const crossOwner = (findings: ReturnType<typeof driftResources>) =>
    findings.filter((finding) => finding.code === 'cross_owner_access');

  it('fails the change that gives a service direct access to a table another team owns', () => {
    const teams = { service: 'Checkout', table: 'Billing' };

    expect(crossOwner(driftResources(graph(teams), graph(teams, [{ type: 'reads' }])))).toEqual([
      {
        resource: invoices,
        code: 'cross_owner_access',
        severity: 'breaking',
        message: 'checkout-api (Checkout) reads table billing/invoices, which Billing owns',
        affectedServices: ['checkout-api'],
        compatibility: [],
        advice:
          'Ask Billing for an API or an event instead. If this is a deliberate exception, such as a migration, review the edge with ac resources promote.',
      },
    ]);
  });

  it('reports a write the same way as a read', () => {
    const teams = { service: 'Checkout', table: 'Billing' };

    expect(
      crossOwner(driftResources(graph(teams), graph(teams, [{ type: 'writes' }]))).map(
        (finding) => finding.message,
      ),
    ).toEqual(['checkout-api (Checkout) writes table billing/invoices, which Billing owns']);
  });

  it('counts only reads and writes as access', () => {
    const teams = { service: 'Checkout', table: 'Billing' };

    expect(crossOwner(driftResources(graph(teams), graph(teams, [{ type: 'defines' }])))).toEqual(
      [],
    );
  });

  it('leaves access that was already there before this change to the baseline', () => {
    const teams = { service: 'Checkout', table: 'Billing' };
    const both = graph(teams, [{ type: 'reads' }]);

    expect(crossOwner(driftResources(both, both))).toEqual([]);
  });

  it('says nothing when the team owns both, or when either owner is unknown', () => {
    for (const teams of [
      { service: 'Billing', table: 'Billing' },
      { service: 'Checkout' },
      { table: 'Billing' },
    ])
      expect(crossOwner(driftResources(graph(teams), graph(teams, [{ type: 'reads' }])))).toEqual(
        [],
      );
  });

  it('keeps a reviewed exception visible without failing the build', () => {
    const teams = { service: 'Checkout', table: 'Billing' };

    expect(
      crossOwner(
        driftResources(graph(teams), graph(teams, [{ type: 'reads', reviewed: true }])),
      ).map((finding) => finding.severity),
    ).toEqual(['suspicious']);
  });
});
