/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { docHead, eventHead } from './fixtures';
import { PageTitleChrome } from './PageTitleChrome';

// Starlight's own <h1> is Astro; a plain one stands in for it.
const meta = {
  title: 'Overrides/PageTitleChrome',
  component: PageTitleChrome,
  // On the site this renders outside Starlight's Markdown, unlike the preview.
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  args: { ...eventHead, children: <h1>payment.completed</h1> },
} satisfies Meta<typeof PageTitleChrome>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Event: Story = {};

/** A draft with the badges its team gave it: the state is quiet, the labels plain. */
export const DraftWithBadges: Story = {
  args: {
    pills: [
      { text: 'v0.1.0' },
      { text: 'draft', tone: 'quiet' },
      { text: 'PCI' },
      { text: 'Beta' },
    ],
  },
};

/** A document: crumbs from its id, and a button that copies its Markdown twin. */
export const Document: Story = {
  args: { ...docHead, children: <h1>Payments service runbook</h1> },
};

/** An index page: no kind, a call to action level with the title. */
export const IndexWithPrimaryAction: Story = {
  args: {
    kind: undefined,
    kindLabel: undefined,
    catalogKey: undefined,
    summary: 'Every resource this build found, with how it was found.',
    pills: [],
    actions: [],
    primary: { label: 'Explore catalog', href: '/catalog/' },
    children: <h1>Knowledge graph</h1>,
  },
};

export const TitleOnly: Story = {
  args: {
    kind: undefined,
    kindLabel: undefined,
    catalogKey: undefined,
    summary: undefined,
    pills: [],
    actions: [],
    children: <h1>Getting started</h1>,
  },
};
