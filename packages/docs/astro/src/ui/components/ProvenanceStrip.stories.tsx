/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProvenanceStrip } from './ProvenanceStrip';

const meta = {
  title: 'Components/ProvenanceStrip',
  component: ProvenanceStrip,
} satisfies Meta<typeof ProvenanceStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};
