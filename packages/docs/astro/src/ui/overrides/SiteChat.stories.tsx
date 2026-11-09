/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SiteChat } from './SiteChat';

const meta = {
  title: 'Overrides/SiteChat',
  component: SiteChat,
  args: {
    api: '/chat',
    title: 'Ask the docs',
    description: 'Answers from Example Co’s pages',
    suggestions: ['How do I take a payment?', 'Who owns the orders service?'],
    layout: 'inline',
  },
} satisfies Meta<typeof SiteChat>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The panel itself, open where it is rendered. */
export const Inline: Story = {};

/** A button in the corner that opens the panel over the page. */
export const Floating: Story = { args: { layout: 'floating', defaultOpen: true } };

/** With a form to reach a person, the conversation attached. */
export const WithSupport: Story = {
  args: { support: { api: '/support', note: 'A person replies within a working day.' } },
};
