/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CountCards } from './CountCards';

const meta = {
  title: 'Components/CountCards',
  component: CountCards,
  args: {
    items: [
      { label: 'services', value: 34, href: '/services/', kind: 'service' },
      { label: 'events', value: 72, href: '/catalog/?kind=event', kind: 'event' },
      { label: 'domains', value: 11, href: '/domains/', kind: 'domain' },
      { label: 'endpoints', value: 15, href: '/catalog/?kind=endpoint', kind: 'endpoint' },
      { label: 'owners', value: 8, href: '/owners/', kind: 'owner' },
      { label: 'relationships', value: 1240, kind: 'relationship' },
    ],
  },
} satisfies Meta<typeof CountCards>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A card per kind, each leading to its list; relationships have no list, so no link. */
export const Default: Story = {};

/** A kind with none has no card. */
export const SomeEmpty: Story = {
  args: {
    items: [
      { label: 'services', value: 4, href: '/services/', kind: 'service' },
      { label: 'domains', value: 0, href: '/domains/', kind: 'domain' },
    ],
  },
};

export const Nothing: Story = { args: { items: [] } };

/** Worst case: a catalog in the hundreds of thousands, a long kind name, and a kind of one. */
export const WorstCase: Story = {
  args: {
    items: [
      { label: 'relationships', value: 1_284_507, kind: 'relationship' },
      { label: 'data products', value: 1, href: '/data-products/', kind: 'dataProduct' },
      { label: 'MCP servers', value: 12_840, href: '/mcp-servers/', kind: 'agent' },
      { label: 'services', value: 4_096, href: '/services/', kind: 'service' },
      { label: 'retirements', value: 1, kind: 'decision' },
      { label: 'endpoints', value: 98_765, href: '/catalog/?kind=endpoint', kind: 'endpoint' },
    ],
  },
};
