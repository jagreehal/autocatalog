/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChannelsPage } from './ChannelsPage';
import { channels } from './fixtures';

const meta = {
  title: 'Pages/ChannelsPage',
  component: ChannelsPage,
  parameters: { layout: 'fullscreen' },
  args: { channels },
} satisfies Meta<typeof ChannelsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { channels: [] } };

export const LongNames: Story = {
  args: {
    channels: [
      {
        id: 'orders.fulfilment.warehouse-allocation.retry.dead-letter.v2',
        href: '/channels/orders.fulfilment.warehouse-allocation.retry.dead-letter.v2/',
        system: 'Order fulfilment and warehouse allocation platform',
        bindings: [
          'WarehouseAllocationService',
          'FulfilmentOrchestrator',
          'InventoryReservationService',
          'CustomerNotificationService',
        ],
        source: 'observed',
      },
    ],
  },
};
