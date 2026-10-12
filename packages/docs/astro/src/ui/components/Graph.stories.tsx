/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowStrip } from './FlowStrip';
import { Graph } from './Graph';

const strip = (
  <FlowStrip
    label="Message flow"
    from={[{ label: 'PaymentService', kind: 'service' }]}
    inbound="publishes"
    centre={{ label: 'Payment completed', kind: 'event', detail: 'v1.0.0' }}
    outbound="subscribed by"
    to={[{ label: 'LedgerService', kind: 'service' }]}
  />
);

const meta = {
  title: 'Components/Graph',
  component: Graph,
  args: {
    id: 'payment-completed',
    label: 'Message flow',
    height: '20rem',
    fallback: strip,
    visualiser: {
      graph: {
        nodes: [
          { id: 'from-0', type: 'service', label: 'PaymentService', metadata: {} },
          {
            id: 'centre',
            type: 'event',
            label: 'Payment completed',
            metadata: { version: '1.0.0' },
          },
          { id: 'to-0', type: 'service', label: 'LedgerService', metadata: {} },
        ],
        edges: [
          { id: 'e1', source: 'from-0', target: 'centre', type: 'publishes', label: 'publishes' },
          {
            id: 'e2',
            source: 'centre',
            target: 'to-0',
            type: 'subscribes',
            label: 'subscribed by',
          },
        ],
        options: { legend: true, search: false },
      },
      hrefs: { centre: '/events/payment.completed' },
    },
  },
} satisfies Meta<typeof Graph>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With nothing to draw, only the static picture shows. */
export const FallbackOnly: Story = { args: { visualiser: undefined } };

/** A new event that names no producer or consumer: the picture says how to declare them. */
export const NothingToDraw: Story = {
  args: {
    visualiser: undefined,
    fallback: (
      <FlowStrip
        label="Message flow"
        from={[]}
        inbound="publishes"
        centre={{ label: 'Payment completed', kind: 'event', detail: 'v1.0.0' }}
        outbound="subscribed by"
        to={[]}
      />
    ),
  },
};
