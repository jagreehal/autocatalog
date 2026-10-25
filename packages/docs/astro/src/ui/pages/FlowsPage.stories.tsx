/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowsPage } from './FlowsPage';

const meta = {
  title: 'Pages/FlowsPage',
  component: FlowsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    flows: [
      {
        title: 'Order to dispatch',
        summary: 'From checkout to a parcel leaving the warehouse.',
        repository: 'acme-platform',
        steps: 7,
        href: '/flows/acme-platform/order-to-dispatch/',
      },
    ],
  },
} satisfies Meta<typeof FlowsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoFlows: Story = { args: { flows: [] } };
