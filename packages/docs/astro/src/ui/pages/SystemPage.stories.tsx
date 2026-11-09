/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { externalSystem, internalSystem } from './fixtures';
import { SystemPage } from './SystemPage';

const meta = {
  title: 'Pages/SystemPage',
  component: SystemPage,
  parameters: { layout: 'fullscreen' },
  args: { system: internalSystem },
} satisfies Meta<typeof SystemPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Someone else's system: no summary, and nothing nested under it. */
export const External: Story = { args: { system: externalSystem } };
