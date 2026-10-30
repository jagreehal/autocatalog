import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { eventFrontmatter } from 'autocatalog-core';
import type { CatalogEvent } from '../src/catalog';
import { eventVersions, versionChanges, versionLinks, versionPath } from '../src/event-versions';
import { EventVersions } from '../src/ui/components/EventVersions';

// payment.completed with its versioned/ history: V1 and 1.0.0-beta behind the
// current 1.0.0, plus the same id from another repository that is not its history.
const version = (
  repository: string,
  value: string,
  amount: string,
  isVersioned = true,
): CatalogEvent => ({
  repository,
  event: {
    folder: {
      path: `/${repository}/events/payment/payment.completed${isVersioned ? `/versioned/${value}` : ''}`,
      defaultDomain: 'payment',
      isVersioned,
      parentEventPath: isVersioned ? `/${repository}/events/payment/payment.completed` : null,
    },
    frontmatter: {
      ...eventFrontmatter.parse({
        id: 'payment.completed',
        version: value,
        name: 'Payment Completed',
        summary: 'A payment was captured.',
      }),
      domain: 'payment',
    },
    body: '',
    schemaPath: 'schema.json',
    schema: { type: 'object', properties: { amount: { type: amount } } },
    examples: [],
  },
});

const current = version('payments', '1.0.0', 'number', false);

const beta = version('payments', '1.0.0-beta', 'string');

const first = version('payments', 'V0', 'string');

const elsewhere = version('legacy-billing', '0.5.0', 'integer');

const catalog = { events: [current], history: [first, elsewhere, beta] };

describe('an event lists its own versions, newest first', () => {
  it('orders semver-ishly and leaves another repository’s history out', () => {
    expect(eventVersions(catalog, beta).map(({ event }) => event.frontmatter.version)).toEqual([
      '1.0.0',
      '1.0.0-beta',
      'V0',
    ]);
  });

  it('keeps the current version at the event page and earlier ones under v/', () => {
    expect(versionPath(current)).toBe('events/payments/payment/payment.completed/');
    expect(versionPath(beta)).toBe('events/payments/payment/payment.completed/v/1.0.0-beta/');
  });
});

describe('each version says what changed since the one before it', () => {
  const versions = eventVersions(catalog, current);

  it('uses the changelog ac changelog prints', () => {
    const changes = versionChanges(versions, { ...current });

    expect(changes).toContain('1.0.0-beta → 1.0.0');
    expect(changes).toContain('changed type: string → number');
  });

  it('has nothing to compare for the oldest version', () => {
    expect(versionChanges(versions, first)).toBeNull();
  });
});

describe('EventVersions states', () => {
  const render = async (active: CatalogEvent) =>
    renderToStaticMarkup(
      createElement(EventVersions, {
        versions: await versionLinks(eventVersions(catalog, active), active, '/'),
      }),
    );

  it('links every version, marks the current one and the one being read', async () => {
    const html = await render(beta);

    expect(html).toContain('href="/events/payments/payment/payment.completed/"');
    expect(html).toContain('href="/events/payments/payment/payment.completed/v/V0/"');
    // Each row is its link, so a version's label and its marker are inside it.
    expect(html).toMatch(/>v1\.0\.0<span[^>]*>current</);
    expect(html).toMatch(/aria-current="page"[^>]*>(<[^>]*>)*v1\.0\.0-beta</);
    // Only a numeric version reads as "v…"; anything else is shown as written.
    expect(html).toMatch(/>V0</);
  });

  it('carries what changed since the version before for every version, as the changelog prints it', async () => {
    const links = await versionLinks(eventVersions(catalog, first), first, '/');

    // Newest first: the current version against the beta, the beta against V0, V0 has nothing before it.
    expect(links.map(({ changesHtml }) => changesHtml !== null)).toEqual([true, true, false]);
    expect(links[0]!.changesHtml).toContain('1.0.0-beta → 1.0.0');
    expect(links[1]!.changesHtml).toContain('V0 → 1.0.0-beta');
  });

  it("renders each version's changes, whichever version is being read", async () => {
    const html = await render(first);

    expect(html.match(/data-changes=""/g)).toHaveLength(2);
    expect(html).toContain('V0 → 1.0.0-beta');
  });
});
