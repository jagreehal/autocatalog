/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { docs } from './fixtures';
import { HomePage } from './HomePage';
import type { HomePageProps } from './HomePage';
import storefront from './home-storefront.fixture.json';

const meta = {
  title: 'Pages/HomePage',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
  args: {
    stats: [
      { label: 'events', value: 12, href: '/catalog/?kind=event' },
      { label: 'services', value: 5, href: '/catalog/?kind=service' },
      { label: 'relationships', value: 31 },
    ],
    explore: [
      {
        title: 'Knowledge graph',
        text: 'Every resource and relationship, with where each fact was read from.',
        href: '/catalog/',
        icon: 'catalog',
      },
      {
        title: 'Architecture',
        text: 'Domains, services and events drawn as a map by EventCatalog.',
        href: '/architecture/',
        icon: 'architecture',
        kind: 'channel',
      },
      {
        title: 'Services',
        text: 'What each service publishes and consumes, inferred from the events.',
        href: '/catalog/?kind=service',
        icon: 'service',
        kind: 'service',
      },
      {
        title: 'Fields',
        text: 'Every field across every event, and who a change to it would reach.',
        href: '/fields/',
        icon: 'fields',
        kind: 'event',
      },
      {
        title: 'Owners',
        text: 'The teams the catalog names, and everything each one owns.',
        href: '/owners/',
        icon: 'owners',
        kind: 'owner',
      },
      {
        title: 'For agents',
        text: 'llms.txt, a Markdown twin of every document, and the graph as JSON.',
        href: '/llms.txt',
        icon: 'braces',
        kind: 'agent',
      },
    ],
    repos: [
      { name: 'billing', label: 'Billing', description: 'How invoices go out.', docs: [docs[1]!] },
      { name: 'orders', label: 'orders', docs: [docs[0]!] },
    ],
    tags: [
      ['oncall', [docs[0]!]],
      ['runbook', docs],
    ],
    provenance: {
      resources: { extracted: 12, declared: 30, inferred: 3 },
      relationships: { extracted: 20, declared: 9, inferred: 2 },
    },
    attention: {
      needsReview: 2,
      needsReviewHref: '/catalog/?review=1',
      failures: [],
      orphanProducers: 0,
      orphanConsumers: 3,
      unowned: 4,
      ownersHref: '/owners/',
      catalogHref: '/catalog/',
    },
    recent: [
      {
        kind: 'Event',
        icon: 'event',
        title: 'Order placed',
        href: '/events/orders/order-placed/',
        repository: 'orders',
        updated: '2026-11-20T10:00:00Z',
      },
      {
        kind: 'Document',
        icon: 'doc',
        title: 'Refund runbook',
        href: '/billing/refund-runbook/',
        repository: 'billing',
        updated: '2026-11-18T09:00:00Z',
      },
    ],
  },
} satisfies Meta<typeof HomePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No document carries a tag, so the "By tag" section is absent. */
export const NoTags: Story = { args: { tags: [] } };

/** A build of only the knowledge graph: no Markdown yet, and the docs section says how to add some. */
export const Empty: Story = {
  args: {
    stats: [{ label: 'relationships', value: 0 }],
    explore: [meta.args.explore[0]!, meta.args.explore[5]!],
    repos: [],
    tags: [],
  },
};

// The storefront example's own home page data, as its build gives it.
const built: unknown = storefront;

export const Storefront: Story = {
  args: {
    // SAFETY: the fixture is the props the storefront build passed this page,
    // copied from its HTML; JSON widens their literal unions, which is all that differs.
    ...(built as Partial<HomePageProps>),
    repos: [],
    tags: [],
  },
};
