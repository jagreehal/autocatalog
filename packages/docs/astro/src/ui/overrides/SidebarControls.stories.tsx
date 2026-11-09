/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SIDEBAR_COLLAPSED_KEY } from '../../sidebar-state';
import { SidebarControls } from './SidebarControls';

const meta = {
  title: 'Overrides/SidebarControls',
  component: SidebarControls,
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  // The state is the reader's, kept in localStorage: each story starts from its own.
  beforeEach: () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);

    return () => {
      localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
      delete document.documentElement.dataset.sidebar;
    };
  },
} satisfies Meta<typeof SidebarControls>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Collapsed: Story = {
  beforeEach: () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
  },
};
