import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta = {
  title: 'Design system/Button',
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The main action on a page. */
export const Primary: Story = { args: { label: 'Continue' } };

/** Every other action. */
export const Secondary: Story = { args: { label: 'Cancel', variant: 'secondary' } };
