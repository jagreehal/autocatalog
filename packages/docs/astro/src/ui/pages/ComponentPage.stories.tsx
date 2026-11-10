/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComponentPage } from './ComponentPage';
import { bareComponent, documentedComponent } from './fixtures';

const meta = {
  title: 'Pages/ComponentPage',
  component: ComponentPage,
  parameters: { layout: 'fullscreen' },
  args: { component: documentedComponent },
} satisfies Meta<typeof ComponentPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No owner, import, props or stories: only what the page always says remains. */
export const Bare: Story = { args: { component: bareComponent } };
