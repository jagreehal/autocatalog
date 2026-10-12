/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Item } from '#ui/components/ui/item.tsx';
import { TransportFacts } from './TransportFacts';

const meta = {
  title: 'Components/TransportFacts',
  component: TransportFacts,
  // As an event page draws it: the last row of its details.
  decorators: [
    (Story) => (
      <div className="not-content max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="m-0 flex flex-col">
              <Item size="xs">
                <dt className="w-32 text-muted-foreground">Version</dt>
                <dd className="m-0 min-w-0 flex-1">2.0.0</dd>
              </Item>
              <Story />
            </dl>
          </CardContent>
        </Card>
      </div>
    ),
  ],
  args: {
    transport: [
      { address: 'payments.completed', protocols: ['kafka'], deliveryMode: 'at-least-once' },
    ],
  },
} satisfies Meta<typeof TransportFacts>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MultipleChannels: Story = {
  args: {
    transport: [
      { address: 'payments.completed', protocols: ['kafka'] },
      { address: 'payments/completed', protocols: ['mqtt', 'amqp'], deliveryMode: 'exactly-once' },
    ],
  },
};

/** Nothing declared, nothing drawn: the details stop at the row before. */
export const None: Story = { args: { transport: [] } };
