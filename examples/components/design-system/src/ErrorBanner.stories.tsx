import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBanner } from './ErrorBanner';

const meta = {
  title: 'Design system/ErrorBanner',
  component: ErrorBanner,
} satisfies Meta<typeof ErrorBanner>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A title and how to fix it. */
export const WithDetail: Story = {
  args: { title: 'Could not save', detail: 'Check your connection and try again.' },
};
