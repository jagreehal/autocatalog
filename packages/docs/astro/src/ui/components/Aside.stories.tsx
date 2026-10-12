/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Aside } from './Aside';

const meta = {
  title: 'Components/Aside',
  component: Aside,
  args: {
    title: 'You are reading an earlier version',
    children: (
      <>
        This is version 1.0.0 of payment.completed. The current version is <a href="#">2.0.0</a>.
      </>
    ),
  },
} satisfies Meta<typeof Aside>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Note: Story = {};

export const Caution: Story = {
  args: {
    type: 'caution',
    title: 'Deprecated',
    children: (
      <>
        Publish <code>payment.settled</code> instead. This event stops being emitted in 3.0.0.
      </>
    ),
  },
};

/** A title says enough on its own; no empty line is left below it. */
export const TitleOnly: Story = { args: { title: 'Generated from code', children: undefined } };
