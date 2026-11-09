/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { mcpServers } from './fixtures';
import { McpServersPage } from './McpServersPage';

const meta = {
  title: 'Pages/McpServersPage',
  component: McpServersPage,
  parameters: { layout: 'fullscreen' },
  args: { servers: mcpServers },
} satisfies Meta<typeof McpServersPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { servers: [] } };
