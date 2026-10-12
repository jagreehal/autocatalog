/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResourceLinks } from './ResourceLinks';

const meta = {
  title: 'Components/ResourceLinks',
  component: ResourceLinks,
  args: {
    id: 'documents',
    heading: 'Documents',
    links: [
      { href: '/orders/runbook', title: 'Orders runbook', label: 'orders' },
      { href: '/billing/refunds', title: 'Refund policy', label: 'billing' },
    ],
  },
} satisfies Meta<typeof ResourceLinks>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Documents that say they describe this event or service, by repository. */
export const Default: Story = {};

/** What a document says it is about, each named by its key. */
export const About: Story = {
  args: {
    id: 'about',
    heading: 'About',
    links: [
      {
        href: '/catalog/#resource-event',
        title: 'Payment captured',
        label: 'event/payments/payment.captured',
      },
      { href: '/catalog/#resource-service', title: 'Ledger service', label: 'service/ledger' },
    ],
  },
};

/** With nothing to link, the card is not drawn. */
export const Empty: Story = { args: { links: [] } };
