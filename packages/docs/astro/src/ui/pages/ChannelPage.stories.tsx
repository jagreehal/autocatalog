/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChannelPage } from './ChannelPage';
import { designChannel, observedChannel } from './fixtures';

const meta = {
  title: 'Pages/ChannelPage',
  component: ChannelPage,
  parameters: { layout: 'fullscreen' },
  args: { channel: observedChannel },
} satisfies Meta<typeof ChannelPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Observed: Story = {};

/** Drawn in a design and not running yet: nothing is bound to it. */
export const FromDesign: Story = { args: { channel: designChannel } };
