/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { NewDesign } from './NewDesign';

const meta = {
  title: 'Pages/NewDesign',
  component: NewDesign,
  // Storybook serves nothing here, so a start fails as it would with the dev server down.
  args: { repositories: ['payments'], startUrl: '/designs/new.json' },
} satisfies Meta<typeof NewDesign>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OneRepository: Story = {};

export const ManyRepositories: Story = {
  args: { repositories: ['payments', 'orders', 'platform'] },
};

export const StartFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText('New design'), 'Refunds v2');
    await userEvent.click(canvas.getByRole('button', { name: 'Start design' }));
    await expect(await canvas.findByText('The design could not be started.')).toBeVisible();
  },
};
