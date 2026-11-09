/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SectionHeading } from './SectionHeading';

const meta = {
  title: 'Components/SectionHeading',
  component: SectionHeading,
  args: { id: 'events', count: '12 events', children: 'Events' },
} satisfies Meta<typeof SectionHeading>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutCount: Story = { args: { count: undefined } };

export const LongHeading: Story = {
  args: {
    children: 'Events published by the order fulfilment and warehouse allocation services',
    count: '148 events',
  },
};
