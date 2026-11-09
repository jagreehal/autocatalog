/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { flowVisualiser } from '../pages/fixtures';
import Visualiser from './Visualiser';

const meta = {
  title: 'Components/Visualiser',
  component: Visualiser,
  // It fills its parent's height, which Graph sets on the site.
  decorators: [
    (Story) => (
      <div className="not-content h-96">
        <Story />
      </div>
    ),
  ],
  args: {
    id: 'payment-completed',
    label: 'Message flow',
    graph: flowVisualiser.graph,
    hrefs: flowVisualiser.hrefs,
  },
} satisfies Meta<typeof Visualiser>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A design's map: the consumer the catalog does not have yet is drawn as proposed. */
export const Proposed: Story = { args: { proposed: ['to-0'] } };

/** Runtime evidence adds the replay toggle and the edge key above the map. */
export const WithEvidence: Story = {
  args: {
    evidence: {
      e1: { state: 'observed', count: 1200, event: 'paymentcompleted' },
      e2: { state: 'unseen', count: 0, event: 'paymentcompleted' },
    },
  },
};
