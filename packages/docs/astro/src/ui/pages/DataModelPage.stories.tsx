/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataModelPage } from './DataModelPage';

const meta = {
  title: 'Pages/DataModelPage',
  component: DataModelPage,
  parameters: { layout: 'fullscreen' },
  args: {
    store: 'table',
    name: 'loans',
    datastore: 'library/lending',
    adapter: 'Prisma',
    repository: 'library',
    provenance: {
      method: 'extracted',
      location: 'prisma/schema.prisma:14',
      symbol: 'Loan',
      confidence: null,
      needsReview: false,
    },
    sourceHref: 'https://github.com/acme/library/blob/main/prisma/schema.prisma#L14',
    owner: { team: 'Lending', href: '/owners/lending/' },
    fields: [
      { name: 'id', type: 'Int', required: true, primary: true, default: 'autoincrement()' },
      {
        name: 'memberId',
        type: 'Int',
        required: true,
        column: 'member_id',
        references: 'Member',
      },
      {
        name: 'status',
        type: 'LoanStatus',
        required: true,
        default: 'OPEN',
        values: ['OPEN', 'RETURNED', 'LOST'],
      },
      {
        name: 'dueOn',
        type: 'DateTime',
        required: true,
        doc: 'Inclusive: due by the end of the day.',
      },
      { name: 'updatedAt', type: 'DateTime', required: true, updatedAt: true },
      {
        name: 'member',
        type: 'Member',
        required: true,
        relation: { model: 'Member', href: '/data/library/member/', many: false, holdsKey: true },
      },
      {
        name: 'renewals',
        type: 'Renewal',
        required: false,
        relation: { model: 'Renewal', many: true, holdsKey: false, name: 'LoanRenewals' },
      },
    ],
    indexes: [
      { fields: ['memberId', 'dueOn'], unique: false },
      { fields: ['memberId', 'bookIsbn'], unique: true, name: 'one_copy_each' },
    ],
    readers: [{ name: 'lending-service', href: '/services/lending-service/' }],
    writers: [{ name: 'reminders', href: '/catalog/#resource-service%3Areminders' }],
    diagram: [
      'erDiagram',
      '  direction LR',
      '  Loan {',
      '    Int id PK',
      '    Int memberId FK',
      '  }',
      '  Member {',
      '    Int id PK',
      '  }',
      '  Member ||--o{ Loan : "member"',
    ].join('\n'),
  },
} satisfies Meta<typeof DataModelPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Known by name only, as an imported catalog leaves a database. */
export const NameOnly: Story = {
  args: {
    fields: [],
    indexes: [],
    readers: [],
    writers: [],
    diagram: undefined,
    sourceHref: undefined,
  },
};
