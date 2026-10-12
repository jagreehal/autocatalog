/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SourceLinks } from './SourceLinks';

const meta = {
  title: 'Components/SourceLinks',
  component: SourceLinks,
  // As a document's footer lays them out: one quiet row of meta.
  decorators: [
    (Story) => (
      <div className="not-content flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Last changed 14 Sep 2026</span>
        <Story />
      </div>
    ),
  ],
  args: {
    source: 'https://github.com/acme/orders/blob/main/docs/runbook.md',
    edit: 'https://github.com/acme/orders/edit/main/docs/runbook.md',
  },
} satisfies Meta<typeof SourceLinks>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SourceOnly: Story = { args: { edit: null } };

/** No web-hosted origin: nowhere to point, so no links. */
export const NoOrigin: Story = { args: { source: null, edit: null } };
