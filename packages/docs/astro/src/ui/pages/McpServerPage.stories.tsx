/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { builtMcpServer, unknownMcpServer } from './fixtures';
import { McpServerPage } from './McpServerPage';

const meta = {
  title: 'Pages/McpServerPage',
  component: McpServerPage,
  parameters: { layout: 'fullscreen' },
  args: { server: builtMcpServer },
} satisfies Meta<typeof McpServerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Configured nowhere, owned by nobody, and never snapshotted. */
export const NotSnapshotted: Story = { args: { server: unknownMcpServer } };

/** Snapshotted, and it offered nothing: said differently from never asked. */
export const NoTools: Story = { args: { server: { ...unknownMcpServer, snapshotted: true } } };
