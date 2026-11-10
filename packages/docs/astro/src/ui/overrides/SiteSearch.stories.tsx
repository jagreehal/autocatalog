/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SiteSearch } from './SiteSearch';

const meta = {
  title: 'Overrides/SiteSearch',
  component: SiteSearch,
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  args: { action: '/search', label: 'Search' },
} satisfies Meta<typeof SiteSearch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** On the search page, the box keeps what was asked. */
export const WithQuery: Story = { args: { query: 'refund policy' } };
