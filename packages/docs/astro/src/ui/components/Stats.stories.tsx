/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stats } from './Stats';

const meta = {
  title: 'Components/Stats',
  component: Stats,
  args: {
    label: 'Catalog totals',
    items: [
      { label: 'events', value: 12 },
      { label: 'services', value: 5 },
      { label: 'agents', value: 2 },
    ],
  },
} satisfies Meta<typeof Stats>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Counts that have a page link to it; the rest are said plainly. */
export const WithLinks: Story = {
  args: {
    items: [
      { label: 'Resources', value: 19, href: '/catalog' },
      { label: 'Relationships', value: 31 },
      { label: 'Need review', value: 3, href: '/catalog?review=true' },
    ],
  },
};

export const One: Story = { args: { items: [{ label: 'event', value: 1, href: '/events' }] } };
