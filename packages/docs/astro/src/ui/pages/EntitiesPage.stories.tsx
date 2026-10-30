/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EntitiesPage } from './EntitiesPage';

const meta = {
  title: 'Pages/EntitiesPage',
  component: EntitiesPage,
  parameters: { layout: 'fullscreen' },
  args: {
    diagram: 'erDiagram\n  refund }o--|| payment : "payment"',
    entities: [
      {
        name: 'Payment',
        summary: 'Money a customer pays for one order.',
        repository: 'payments-service',
        domains: ['payments'],
        aggregateRoot: true,
        properties: 4,
        href: '/entities/payments-service/payment/',
      },
      {
        name: 'Refund',
        repository: 'payments-service',
        domains: ['payments'],
        aggregateRoot: false,
        properties: 3,
        href: '/entities/payments-service/refund/',
      },
    ],
  },
} satisfies Meta<typeof EntitiesPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoEntities: Story = { args: { diagram: null, entities: [] } };
