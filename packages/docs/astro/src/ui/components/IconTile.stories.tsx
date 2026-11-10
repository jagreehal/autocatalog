/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconTile } from './IconTile';

const meta = {
  title: 'Components/IconTile',
  component: IconTile,
  args: { name: 'event' },
} satisfies Meta<typeof IconTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Small: Story = {};

export const Medium: Story = { args: { name: 'service', size: 'md' } };
