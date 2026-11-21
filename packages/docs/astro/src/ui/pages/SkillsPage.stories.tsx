/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { skillsPage } from './fixtures';
import { SkillsPage } from './SkillsPage';

const meta = {
  title: 'Pages/SkillsPage',
  component: SkillsPage,
  parameters: { layout: 'fullscreen' },
  args: skillsPage,
} satisfies Meta<typeof SkillsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { plugins: [], skills: [] } };
