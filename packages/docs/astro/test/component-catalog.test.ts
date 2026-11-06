import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTOCATALOG_GRAPH_SPEC, type ResourceGraph } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { buildComponents } from '../src/components';
import { renderLlmsTxt } from '../src/llms';
import { componentRows } from '../src/page-models';
import { componentTwin } from '../src/twins';

const examples = fileURLToPath(new URL('../../../../examples/components', import.meta.url));

const graph = (...repositories: Array<[string, string?]>): ResourceGraph => ({
  spec: AUTOCATALOG_GRAPH_SPEC,
  relationships: [],
  resources: repositories.map(([repository, url]) => ({
    ref: { kind: 'component', namespace: repository, id: 'transfer-banner' },
    title: 'Banner',
    tags: [],
    provenance: { default: 'extracted', fields: {} },
    needsReview: false,
    attributes: {
      viewer: { name: 'Gallery', ...(url && { url }) },
      props: [],
      stories: [{ id: 'transfer-banner--short', name: 'Short', link: '#short' }],
    },
  })),
});

describe('buildComponents', () => {
  it("links each story to the team's viewer", () => {
    const [row] = buildComponents(graph(['payments', 'https://ui.acme.dev/payments/']), '/docs/');

    expect(row).toMatchObject({
      href: '/docs/components/payments/transfer-banner/',
      viewer: 'Gallery',
    });
    expect(row!.stories[0]!.href).toBe('https://ui.acme.dev/payments/#short');
  });

  it('has no link without a deployed viewer', () => {
    expect(buildComponents(graph(['payments']), '/')[0]!.stories[0]!.href).toBeUndefined();
  });

  it('names the other repositories with a component of this name', () => {
    const rows = buildComponents(graph(['payments'], ['ledger']), '/');

    expect(rows.map(({ repository, alsoIn }) => [repository, alsoIn])).toEqual([
      ['ledger', ['payments']],
      ['payments', ['ledger']],
    ]);
  });

  it.each([
    ['a namespace with a slash', 'a/b', 'card'],
    ['no namespace', undefined, 'card'],
    ['a namespace that climbs', '..', 'card'],
    ['an id with a slash', 'payments', 'a/b'],
    ['an id that would take its Markdown twin path', 'payments', 'card.md'],
  ])('leaves out %s, which has no page', (_, namespace, id) => {
    const joined = graph(['payments']);

    joined.resources[0]!.ref = { kind: 'component', ...(namespace && { namespace }), id };

    expect(buildComponents(joined, '/')).toEqual([]);
  });

  it('keeps an id in any language', () => {
    const joined = graph(['payments']);

    joined.resources[0]!.ref = { kind: 'component', namespace: 'payments', id: 'größe' };

    expect(buildComponents(joined, '/').map(({ id }) => id)).toEqual(['größe']);
  });

  it('leaves out a component from a joined graph whose viewer would run code', () => {
    const joined = graph(['payments']);

    joined.resources[0]!.attributes = {
      viewer: { name: 'Bad', url: 'javascript:alert(1)' },
      props: [],
      stories: [],
    };

    expect(buildComponents(joined, '/')).toEqual([]);
  });
});

describe('the component examples', () => {
  const rows = async () => componentRows(await buildDocsCatalog(path.resolve(examples)), '/');

  it('lists every team, with its owner from a file, from CODEOWNERS or from nobody', async () => {
    const components = await rows();

    expect(
      components.map(({ repository, name, owner }) => [repository, name, owner?.team]),
    ).toEqual([
      ['design-system', 'Button', 'Design Systems'],
      ['checkout', 'ErrorBanner', 'acme/checkout'],
      ['design-system', 'ErrorBanner', 'Design Systems'],
      ['checkout', 'PayButton', 'acme/checkout'],
      ['gallery', 'ReceiptCard', 'Mobile'],
      ['reports', 'ReportTable', undefined],
    ]);
  });

  it('keeps the components of a repository whose documents are all invalid', async () => {
    const catalog = await buildDocsCatalog(path.resolve(examples));

    expect(catalog.failures).toContainEqual(
      expect.objectContaining({ repository: 'reports', source: 'docs' }),
    );
    expect(
      catalog.graph.resources.some(
        ({ ref }) => ref.kind === 'component' && ref.namespace === 'reports',
      ),
    ).toBe(true);
  });

  it('gives agents the import, props and stories', async () => {
    const banner = (await rows()).find(({ id }) => id === 'checkout-errorbanner')!;

    const twin = componentTwin(
      banner,
      'https://acme.dev/components/checkout/checkout-errorbanner/',
    );

    expect(twin).toContain('owner: acme/checkout');
    expect(twin).toContain('also in design-system');
    expect(twin).toContain('- `message` (`string`) required: What went wrong');
    expect(twin).toContain('`onRetry`');
    expect(twin).toContain('### Declined');
    expect(twin).toContain('?path=/story/checkout-errorbanner--declined');
  });

  it('lists each component in llms.txt on one line', async () => {
    const text = renderLlmsTxt({
      title: 'Acme',
      description: 'The catalog.',
      base: 'https://acme.dev',
      items: [],
      components: await rows(),
    });

    expect(text).toContain(
      '- [Button](https://acme.dev/components/design-system/design-system-button.md): The one button every product uses; in design-system; owned by Design Systems',
    );
  });
});
