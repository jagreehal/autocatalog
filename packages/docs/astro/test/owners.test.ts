import type { CatalogRelationship, CatalogResource, ResourceGraph } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { buildOwners, byKind, ownerContact, ownerFor, resourceHref } from '../src/owners';

function resource(
  kind: CatalogResource['ref']['kind'],
  id: string,
  team?: string,
  extra: Partial<CatalogResource> = {},
): CatalogResource {
  // SAFETY: owners.ts reads only ref, title, url, owner and attributes; the
  // kind-specific attribute shapes are irrelevant to grouping.
  return {
    ref: { kind, id },
    title: id,
    tags: [],
    provenance: { default: 'declared', fields: {} },
    needsReview: false,
    attributes: {},
    owner: team === undefined ? undefined : { team },
    ...extra,
  } as CatalogResource;
}

const defines = (repository: string, kind: string, id: string): CatalogRelationship => ({
  type: 'defines',
  from: { kind: 'repository', id: repository },
  to: { kind, id },
  provenance: 'inferred',
  needsReview: false,
});

const graph = (
  resources: CatalogResource[],
  relationships: CatalogRelationship[] = [],
): ResourceGraph => ({
  spec: 'autocatalog/graph-v1',
  resources,
  relationships,
});

describe('buildOwners', () => {
  it('treats spellings that differ by case, whitespace or a leading @ as one owner', () => {
    const owners = buildOwners(
      graph([
        resource('document', 'docs/runbook', ' Payments '),
        resource('event', 'payment.captured', 'payments'),
        resource('agent', 'refund-agent', '@Payments'),
      ]),
    );

    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ slug: 'payments', name: '@Payments' });
    expect(byKind(owners[0]!).map(({ heading, resources }) => [heading, resources.length])).toEqual(
      [
        ['Documents', 1],
        ['Events', 1],
        ['Agents', 1],
      ],
    );
  });

  it('suffixes a slug two distinct owners share, the same way every build', () => {
    const owners = buildOwners(
      graph([
        resource('document', 'a', 'Data Platform'),
        resource('document', 'b', 'data-platform'),
      ]),
    );

    expect(Object.fromEntries(owners.map(({ name, slug }) => [name, slug]))).toEqual({
      'Data Platform': 'data-platform',
      'data-platform': 'data-platform-2',
    });
  });

  it('lists agent co-owners and never invents an owner for a service', () => {
    const owners = buildOwners(
      graph([
        resource('agent', 'refund-agent', 'Payments', { attributes: { owners: ['Risk'] } }),
        resource('service', 'PaymentService'),
      ]),
    );

    expect(owners.map(({ name }) => name)).toEqual(['Payments', 'Risk']);
    expect(owners.flatMap(({ resources }) => resources.map(({ ref }) => ref.kind))).toEqual([
      'agent',
      'agent',
    ]);
  });

  it('records which repositories define what an owner owns', () => {
    const [owner] = buildOwners(
      graph(
        [resource('agent', 'refund-agent', 'Payments')],
        [defines('payments-service', 'agent', 'refund-agent')],
      ),
    );

    expect(owner?.repositories).toEqual(['payments-service']);
  });

  it('finds the owner page for any spelling of the name', () => {
    const owners = buildOwners(graph([resource('document', 'a', 'Payments')]));

    expect(ownerFor(owners, 'PAYMENTS ')?.slug).toBe('payments');
    expect(ownerFor(owners, 'Risk')).toBeUndefined();
  });

  it('shows the name the owner declares, and is still found by its id', () => {
    const owners = buildOwners(
      graph([
        resource('event', 'a', undefined, {
          owner: { team: 'ordering', name: 'Ordering Platform' },
        }),
        resource('event', 'b', undefined, {
          owner: { team: 'ordering', name: 'Ordering Platform' },
        }),
      ]),
    );

    expect(owners[0]).toMatchObject({ slug: 'ordering', name: 'Ordering Platform' });
    expect(ownerFor(owners, 'ordering')?.slug).toBe('ordering');
  });

  it('keeps the id when repositories sharing the owner name it differently', () => {
    const [owner] = buildOwners(
      graph(
        [
          resource('event', 'a', undefined, { owner: { team: 'ordering', name: 'Ordering' } }),
          resource('event', 'b', undefined, { owner: { team: 'ordering', name: 'Fraud team' } }),
        ],
        [defines('orders', 'event', 'a'), defines('intruder', 'event', 'b')],
      ),
    );

    expect(owner?.name).toBe('ordering');
  });
});

describe('ownerContact', () => {
  const owner = (team: string, contact?: string) =>
    buildOwners(graph([resource('event', 'e', undefined, { owner: { team, contact } })]))[0]!;

  it('prefers the contact a manifest declares', () => {
    expect(ownerContact(owner('Payments', 'https://chat.example/payments'), false)).toBe(
      'https://chat.example/payments',
    );
  });

  it('never links a declared contact a browser would run', () => {
    expect(ownerContact(owner('Payments', 'javascript:alert(1)'), false)).toBeUndefined();
    expect(ownerContact(owner('Payments', 'data:text/html,x'), false)).toBeUndefined();
  });

  it('drops the contact when repositories sharing an owner disagree on it', () => {
    const [shared] = buildOwners(
      graph([
        resource('event', 'a', undefined, {
          owner: { team: 'Payments', contact: 'https://a.example' },
        }),
        resource('event', 'b', undefined, {
          owner: { team: 'Payments', contact: 'https://b.example' },
        }),
      ]),
    );

    expect(shared?.contact).toBeUndefined();
  });

  it('drops the contact when another repository sharing the owner declares none', () => {
    const [shared] = buildOwners(
      graph(
        [
          resource('event', 'a', undefined, {
            owner: { team: 'Payments', contact: 'https://claimed.example' },
          }),
          resource('document', 'b', 'Payments'),
        ],
        [defines('intruder', 'event', 'a'), defines('payments-service', 'document', 'b')],
      ),
    );

    expect(shared?.contact).toBeUndefined();
  });

  it('keeps a contact every repository the owner spans declares', () => {
    const [owner] = buildOwners(
      graph(
        [
          resource('event', 'a', undefined, {
            owner: { team: 'Payments', contact: 'https://chat.example/payments' },
          }),
          resource('event', 'b', 'Payments'),
        ],
        [defines('payments-service', 'event', 'a'), defines('payments-service', 'event', 'b')],
      ),
    );

    expect(owner?.contact).toBe('https://chat.example/payments');
  });

  it('derives a link only from an owner that already is one', () => {
    expect(ownerContact(owner('payments@example.com'), false)).toBe('mailto:payments@example.com');
    expect(ownerContact(owner('https://wiki.example/payments'), false)).toBe(
      'https://wiki.example/payments',
    );
    expect(ownerContact(owner('Payments'), true)).toBeUndefined();
  });

  it('reads a team handle as a GitHub team only when the repository is on GitHub', () => {
    expect(ownerContact(owner('@acme/payments'), true)).toBe(
      'https://github.com/orgs/acme/teams/payments',
    );
    expect(ownerContact(owner('@acme/payments'), false)).toBeUndefined();
  });
});

describe('resourceHref', () => {
  it('links documents and events to their pages and everything else into the catalog', () => {
    expect(resourceHref(resource('document', 'docs/runbook', 'P', { url: '/docs/runbook' }))).toBe(
      '/docs/runbook',
    );
    expect(
      resourceHref(
        resource('event', 'payment.captured', 'P', {
          ref: { kind: 'event', namespace: 'svc/payments', id: 'payment.captured' },
        }),
      ),
    ).toBe('/events/svc/payments/payment.captured/');
    expect(resourceHref(resource('agent', 'refund-agent', 'P'))).toBe(
      '/catalog#resource-agent%3Arefund-agent',
    );
  });
});
