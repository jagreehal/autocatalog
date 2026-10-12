/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeSelect } from './ThemeSelect';

const meta = {
  title: 'Overrides/ThemeSelect',
  component: ThemeSelect,
  // On the site this renders outside Starlight's Markdown, unlike the preview.
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  // The button sets data-theme on <html>, as Starlight's own does, so pressing
  // it here flips the whole preview.
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ThemeSelect>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
