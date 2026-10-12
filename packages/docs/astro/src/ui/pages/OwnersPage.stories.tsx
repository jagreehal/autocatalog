/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { OwnersPage } from './OwnersPage';

const meta = {
  title: 'Pages/OwnersPage',
  component: OwnersPage,
  parameters: { layout: 'fullscreen' },
  args: {
    columns: [
      { kind: 'document', heading: 'Documents' },
      { kind: 'event', heading: 'Events' },
      { kind: 'service', heading: 'Services' },
    ],
    owners: [
      { name: 'billing-team', href: '/owners/billing-team/', counts: { document: 1 } },
      { name: 'Data Platform', href: '/owners/data-platform/', counts: { document: 3, event: 2 } },
      {
        name: 'payments',
        href: '/owners/payments/',
        counts: { document: 2, event: 4, service: 2 },
      },
      { name: 'Reliability', href: '/owners/reliability/', counts: { document: 5, service: 1 } },
    ],
  },
} satisfies Meta<typeof OwnersPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoOwners: Story = { args: { columns: [], owners: [] } };
