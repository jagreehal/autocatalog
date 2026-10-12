import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { eventFrontmatter } from 'autocatalog-core';
import type { CatalogEvent } from '../src/catalog';
import {
  eventVersions,
  versionChanges,
  versionChangesHtml,
  versionLinks,
  versionPath,
} from '../src/event-versions';
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
  const render = (active: CatalogEvent, changesHtml?: string | null) =>
    renderToStaticMarkup(
      createElement(EventVersions, {
        versions: versionLinks(eventVersions(catalog, active), active, '/'),
        changesHtml,
      }),
    );

  it('links every version, marks the current one and the one being read', () => {
    const html = render(beta);

    expect(html).toContain('href="/events/payments/payment/payment.completed/"');
    expect(html).toContain('href="/events/payments/payment/payment.completed/v/V0/"');
    // Each row is its link, so a version's label and its marker are inside it.
    expect(html).toMatch(/>v1\.0\.0<span[^>]*>current</);
    expect(html).toMatch(/aria-current="page"[^>]*>(<[^>]*>)*v1\.0\.0-beta</);
    // Only a numeric version reads as "v…"; anything else is shown as written.
    expect(html).toMatch(/>V0</);
  });

  it('renders what changed since the version before, as the changelog prints it', async () => {
    const versions = eventVersions(catalog, beta);

    const html = render(beta, await versionChangesHtml(versions, beta));

    expect(html).toContain('data-changes=""');
    expect(html).toContain('V0 → 1.0.0-beta');
  });

  it('has no changes to render for the oldest version', async () => {
    const versions = eventVersions(catalog, first);

    expect(await versionChangesHtml(versions, first)).toBeNull();
    expect(render(first, null)).not.toContain('data-changes');
  });
});
