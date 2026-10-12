import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTOCATALOG_GRAPH_SPEC, type ResourceGraph } from 'autocatalog-core';
import { buildDocsCatalog } from '../src/catalog';
import { serviceFacts, servicePageProps } from '../src/page-models';
import { ServicePage, type ServicePageProps } from '../src/ui/pages/ServicePage';

const service = (attributes: {
  domains: string[];
  repository?: string;
  system?: { id: string; name?: string };
}): ResourceGraph => ({
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources: [
    {
      ref: { kind: 'service', id: 'Order Service' },
      title: 'Order Service',
      summary: 'Takes orders.',
      // EventCatalog's team id, and the name its team page gives.
      owner: { team: 'orders', name: 'Orders' },
      tags: [],
      provenance: { default: 'declared', fields: {} },
      needsReview: false,
      attributes,
    },
  ],
  relationships: [],
});

describe('serviceFacts', () => {
  it('is what the service says about itself, imported from EventCatalog or Backstage', () => {
    expect(
      serviceFacts(
        service({
          domains: [],
          repository: 'https://github.com/acme/orders',
          system: { id: 'ordering', name: 'Ordering System' },
        }),
        'Order Service',
      ),
    ).toEqual({
      summary: 'Takes orders.',
      owner: { team: 'Orders', href: '/owners/orders/' },
      repository: 'https://github.com/acme/orders',
      system: 'Ordering System',
    });
    // A system without a name is known by its id.
    expect(
      serviceFacts(service({ domains: [], system: { id: 'ordering' } }), 'Order Service').system,
    ).toBe('ordering');
  });

  it('offers no repository that is not a web address, and nothing for a service it does not know', () => {
    const graph = service({ domains: [], repository: 'javascript:alert(1)' });

    expect(serviceFacts(graph, 'Order Service')).not.toHaveProperty('repository');
    expect(serviceFacts(graph, 'Billing')).toEqual({});
  });
});

describe('ServicePage', () => {
  const page: ServicePageProps = {
    flow: {
      from: [],
      inbound: 'consumed by',
      centre: { label: 'Order Service', kind: 'service' },
      outbound: 'produces',
      to: [],
    },
    sections: [],
    documents: [],
  };

  it('says who owns the service, linked to their page', () => {
    const html = renderToStaticMarkup(
      createElement(ServicePage, { ...page, owner: { team: 'Orders', href: '/owners/orders/' } }),
    );

    expect(html).toContain('Owned by <a');
    expect(html).toContain('href="/owners/orders/"');
  });

  it('says nothing of an owner it was not told', () => {
    expect(renderToStaticMarkup(createElement(ServicePage, page))).not.toContain('Owned by');
  });

  it('says which system the service is part of', () => {
    expect(
      renderToStaticMarkup(createElement(ServicePage, { ...page, system: 'Ordering System' })),
    ).toContain('Part of Ordering System.');
  });
});

describe('servicePageProps', () => {
  it('names the owner the service’s own record gives, beside what its events say', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-service-page-'));

    try {
      const event = path.join(root, 'shop/events/orders/Placed');
      await fs.mkdir(event, { recursive: true });
      await fs.writeFile(
        path.join(event, 'autocatalog.json'),
        JSON.stringify({
          spec: 'autocatalog/v2',
          id: 'order.placed',
          version: '1.0.0',
          name: 'Order placed',
          summary: 'An order was placed.',
          domain: 'orders',
          producers: ['Order Service'],
          schema: 'schema.json',
        }),
      );
      await fs.writeFile(path.join(event, 'schema.json'), '{"type":"object"}');
      await fs.mkdir(path.join(root, 'shop/.autocatalog'));
      await fs.writeFile(
        path.join(root, 'shop/.autocatalog/resources.json'),
        JSON.stringify(service({ domains: ['orders'], system: { id: 'ordering' } })),
      );

      const catalog = await buildDocsCatalog(root, { includeDates: false });

      expect(catalog.failures).toEqual([]);
      const props = servicePageProps(catalog, { name: 'Order Service' }, '/');

      expect(props.owner).toMatchObject({ team: 'Orders' });
      expect(props.system).toBe('ordering');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
