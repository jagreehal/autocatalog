/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComponentsPage } from './ComponentsPage';
import { components } from './fixtures';

const meta = {
  title: 'Pages/ComponentsPage',
  component: ComponentsPage,
  parameters: { layout: 'fullscreen' },
  args: { components },
} satisfies Meta<typeof ComponentsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { components: [] } };
