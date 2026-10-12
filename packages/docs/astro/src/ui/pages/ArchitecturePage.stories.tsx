/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArchitecturePage } from './ArchitecturePage';

const meta = {
  title: 'Pages/ArchitecturePage',
  component: ArchitecturePage,
  parameters: { layout: 'fullscreen' },
  // A real, public EventCatalog, so the frame shows what a reader would see.
  args: {
    base: 'https://jagreehal.github.io/cbd-catalog/',
    defaultPath: 'visualiser/domains/payments/1.0.0',
  },
} satisfies Meta<typeof ArchitecturePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
