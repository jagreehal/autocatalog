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

/**
 * A repository with a runtime snapshot: the edge that ran is weighted by volume,
 * a declared consumer never seen is dashed, and a consumer nobody declared is
 * marked. Replay moves markers over the edges that ran.
 */
export const WithRuntimeEvidence: Story = {
  args: {
    visualiser: {
      graph: {
        nodes: [
          { id: 'from-0', type: 'service', label: 'PaymentService', metadata: {} },
          { id: 'centre', type: 'event', label: 'Payment completed', metadata: {} },
          { id: 'to-0', type: 'service', label: 'LedgerService', metadata: {} },
          { id: 'to-1', type: 'service', label: 'AuditService', metadata: {} },
          { id: 'to-2', type: 'service', label: 'FraudService', metadata: {} },
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
          {
            id: 'e3',
            source: 'centre',
            target: 'to-1',
            type: 'subscribes',
            label: 'subscribed by',
          },
          {
            id: 'e4',
            source: 'centre',
            target: 'to-2',
            type: 'subscribes',
            label: 'subscribed by',
          },
        ],
        options: { legend: true, search: false },
      },
      hrefs: {},
      evidence: {
        e1: {
          state: 'observed',
          count: 1200,
          event: 'paymentcompleted',
          producer: 'PaymentService',
        },
        e2: { state: 'observed', count: 1200, event: 'paymentcompleted' },
        e3: { state: 'unseen', count: 0, event: 'paymentcompleted' },
        e4: { state: 'undocumented', count: 40, event: 'paymentcompleted' },
      },
    },
  },
};

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
