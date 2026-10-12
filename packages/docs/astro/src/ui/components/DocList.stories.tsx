/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import { DocList } from './DocList';

const meta = {
  title: 'Components/DocList',
  component: DocList,
  // As the home page draws it: a repository's documents, in its card.
  decorators: [
    (Story, { args, parameters }) => (
      <div className="not-content max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {parameters.heading ?? 'orders'}
            </CardTitle>
            <CardDescription>{`${args.items.length} documents`}</CardDescription>
          </CardHeader>
          <CardContent>
            <Story />
          </CardContent>
        </Card>
      </div>
    ),
  ],
  args: {
    items: [
      {
        id: 'orders/runbook',
        repo: 'orders',
        title: 'Orders runbook',
        owner: 'orders-team',
        updated: '2026-09-14T10:00:00Z',
        tags: ['runbook', 'oncall'],
      },
      {
        id: 'orders/retries',
        repo: 'orders',
        title: 'Why order placement retries three times',
        owner: 'orders-team',
        updated: '2026-08-02T10:00:00Z',
        tags: ['adr'],
      },
      {
        id: 'orders/glossary',
        repo: 'orders',
        title: 'Order states',
        owner: 'orders-team',
        updated: null,
        tags: [],
      },
    ],
  },
} satisfies Meta<typeof DocList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A list that mixes repositories, as a tag's documents do, names each one's. */
export const WithRepository: Story = {
  parameters: { heading: 'runbook' },
  args: {
    showRepo: true,
    items: [
      {
        id: 'orders/runbook',
        repo: 'orders',
        title: 'Orders runbook',
        owner: 'orders-team',
        updated: '2026-09-14T10:00:00Z',
        tags: [],
      },
      {
        id: 'billing/refunds',
        repo: 'billing',
        title: 'Refund policy',
        owner: 'billing-team',
        updated: '2026-07-21T10:00:00Z',
        tags: [],
      },
    ],
  },
};
