/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpecificationsPage } from './SpecificationsPage';

const meta = {
  title: 'Pages/SpecificationsPage',
  component: SpecificationsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    specifications: [
      {
        title: 'Carrier booking',
        format: 'WSDL',
        repository: 'shipping',
        file: 'contracts/carrier.wsdl',
        href: '/specs/shipping/carrier/',
      },
      {
        title: 'Orders events',
        format: 'AsyncAPI',
        repository: 'orders',
        file: 'contracts/asyncapi.yaml',
        href: '/specs/orders/asyncapi/',
      },
    ],
  },
} satisfies Meta<typeof SpecificationsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSpecifications: Story = { args: { specifications: [] } };
