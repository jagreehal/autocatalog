/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CatalogExplorer } from './CatalogExplorer';
import { emptyExplorerModel, explorerModel, largeExplorerModel } from './catalog-explorer.fixture';

const meta = {
  title: 'Components/CatalogExplorer',
  component: CatalogExplorer,
  args: { model: explorerModel },
} satisfies Meta<typeof CatalogExplorer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Sixty resources: 25 a page, sortable by any column. */
export const ManyResources: Story = {
  args: { model: largeExplorerModel },
};

export const EmptyGraph: Story = {
  args: { model: emptyExplorerModel },
};
