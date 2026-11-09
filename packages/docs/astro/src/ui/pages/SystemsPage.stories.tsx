/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { systems } from './fixtures';
import { SystemsPage } from './SystemsPage';

const meta = {
  title: 'Pages/SystemsPage',
  component: SystemsPage,
  parameters: { layout: 'fullscreen' },
  args: { systems },
} satisfies Meta<typeof SystemsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { systems: [] } };
