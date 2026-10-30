/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventVersionPage } from './EventVersionPage';
import { examples, schema, versions } from './fixtures';

const meta = {
  title: 'Pages/EventVersionPage',
  component: EventVersionPage,
  parameters: { layout: 'fullscreen' },
  args: {
    version: '1.0.0',
    current: { href: '/events/payments/payments/payment.completed/', version: '2.0.0' },
    schema,
    schemaHref: '/events/payments/payments/payment.completed/v/1.0.0/schema.json',
    examples,
    versions: versions.map((entry) => ({ ...entry, active: entry.label === 'v1.0.0' })),
  },
} satisfies Meta<typeof EventVersionPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No current version to point back to, and no examples. */
export const Orphaned: Story = { args: { current: undefined, examples: [] } };
