/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CatalogPage } from './CatalogPage';
import { emptyExplorerModel, explorerModel, flowVisualiser } from './fixtures';

const meta = {
  title: 'Pages/CatalogPage',
  component: CatalogPage,
  parameters: { layout: 'fullscreen' },
  args: {
    failures: [],
    datastores: [
      {
        anchor: 'resource-collection-orders',
        id: 'orders',
        namespace: 'orders-service',
        owner: 'orders-team',
        writers: ['OrderService'],
        readers: ['ReportingService'],
        evidence: { count: 4210, environment: 'production' },
      },
      {
        anchor: 'resource-table-ledger',
        id: 'ledger',
        namespace: 'payments',
        owner: null,
        writers: ['LedgerService', 'PaymentService'],
        readers: [],
        evidence: null,
      },
    ],
    map: flowVisualiser,
    explorer: explorerModel,
  },
} satisfies Meta<typeof CatalogPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A repository whose catalog did not compile is named, never swallowed. */
export const Quarantine: Story = {
  args: {
    failures: [
      {
        repository: 'shipping-service',
        source: 'events/ catalog',
        message: 'events/shipping/label.created/schema.json is not valid JSON.',
      },
      { repository: 'crm', source: 'autocatalog.resources.json', message: 'unknown spec version' },
    ],
  },
};

export const Empty: Story = {
  args: { datastores: [], map: undefined, explorer: emptyExplorerModel },
};
