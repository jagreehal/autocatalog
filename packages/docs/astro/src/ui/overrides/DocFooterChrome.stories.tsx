/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DocFooterChrome } from './DocFooterChrome';

const meta = {
  title: 'Overrides/DocFooterChrome',
  component: DocFooterChrome,
  // On the site this renders outside Starlight's Markdown, unlike the preview.
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  args: {
    base: '/',
    siteTitle: 'Acme catalog',
    owner: 'Payments',
    ownerHref: '/owners/payments/',
    known: true,
    changed: '4 Mar 2026',
    source: 'https://github.com/acme/payments-service/blob/HEAD/docs/runbook.md',
    edit: 'https://github.com/acme/payments-service/edit/HEAD/docs/runbook.md',
    related: [{ id: 'billing/refunds', title: 'Refund policy', repo: 'billing', resolved: true }],
    linkedFrom: [
      { id: 'platform/oncall', title: 'On-call handbook', repo: 'platform', resolved: true },
    ],
    about: [
      {
        href: '/events/payment.completed/',
        title: 'payment.completed',
        label: 'event/payment.completed',
      },
    ],
    repository: 'payments-service',
    defined: [
      {
        kind: 'event',
        id: 'payment.completed',
        title: 'Payment completed',
        href: '/catalog#event-payment.completed',
      },
      {
        kind: 'service',
        id: 'payment-service',
        title: 'Payment service',
        href: '/catalog#service-payment-service',
      },
    ],
    children: (
      <footer className="mt-8 text-sm text-muted-foreground">
        Starlight&apos;s footer: edit link, pagination
      </footer>
    ),
  },
} satisfies Meta<typeof DocFooterChrome>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No owner declared and no git date: the row still says so rather than vanishing. */
export const NoOwnerNoDate: Story = {
  args: { owner: undefined, ownerHref: undefined, changed: null, source: null, edit: null },
};

/** An owner the catalog has no page for is written plainly, not linked. */
export const UnlinkedOwner: Story = { args: { ownerHref: undefined } };

/** The index page renders without an entry: only the site footer remains. */
export const SiteFooterOnly: Story = {
  args: {
    owner: undefined,
    ownerHref: undefined,
    known: false,
    related: [],
    linkedFrom: [],
    about: [],
    defined: [],
    repository: '',
    children: undefined,
  },
};
