/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataModelsPage } from './DataModelsPage';

const meta = {
  title: 'Pages/DataModelsPage',
  component: DataModelsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    models: [
      {
        title: 'Loan',
        href: '/data/library/loan/',
        store: 'table',
        name: 'loans',
        datastore: 'library/lending',
        adapter: 'Prisma',
        repository: 'library',
        owner: 'Lending',
        fields: 5,
        readers: [{ name: 'lending-service', href: '/services/lending-service/' }],
        writers: [
          { name: 'lending-service', href: '/services/lending-service/' },
          { name: 'reminders', href: '/catalog/#resource-service%3Areminders' },
        ],
      },
      {
        title: 'Member',
        href: '/data/library/member/',
        store: 'collection',
        name: 'members',
        datastore: 'library/lending',
        adapter: 'Mongoose',
        repository: 'library',
        fields: 4,
        readers: [],
        writers: [],
      },
    ],
  },
} satisfies Meta<typeof DataModelsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoModels: Story = { args: { models: [] } };
