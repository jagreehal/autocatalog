/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServicesPage, type ServicesPageRow } from './ServicesPage';

const orders: ServicesPageRow = {
  name: 'orders-api',
  href: '/services/orders-api/',
  summary: 'Takes orders and reports their status.',
  owner: { team: 'orders-team', href: '/owners/orders-team/' },
  domains: ['orders'],
  apis: [{ label: 'Orders API', href: '/apis/orders-api/openapi/' }],
  endpoints: 3,
  receives: [{ label: 'Payment Completed', href: '/events/payments/payment.completed/' }],
  sends: [
    { label: 'Order Placed', href: '/events/orders/order.placed/' },
    { label: 'Order Cancelled', href: '/events/orders/order.cancelled/' },
  ],
  calls: [{ label: 'users-api', href: '/services/users-api/' }],
};

const users: ServicesPageRow = {
  name: 'users-api',
  href: '/services/users-api/',
  domains: [],
  apis: [{ label: 'Users API', href: '/apis/users-api/openapi/' }],
  endpoints: 2,
  receives: [],
  sends: [],
  calls: [],
};

const meta = {
  title: 'Pages/ServicesPage',
  component: ServicesPage,
  parameters: { layout: 'fullscreen' },
  args: { services: [orders, users] },
} satisfies Meta<typeof ServicesPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Services from events and OpenAPI specs alike, one of them with no owner yet. */
export const Default: Story = {};

/** A catalog whose services come only from OpenAPI specs: no events to receive or send. */
export const ApisOnly: Story = {
  args: {
    services: [
      { ...orders, summary: undefined, domains: [], receives: [], sends: [] },
      { ...users, owner: { team: 'users-team', href: '/owners/users-team/' } },
    ],
  },
};

/** More than a cell shows: the rest are on the service's page. */
export const Busy: Story = {
  args: {
    services: [
      {
        ...orders,
        sends: Array.from({ length: 6 }, (_, n) => ({
          label: `Order Event ${n + 1}`,
          href: `/events/orders/order.event-${n + 1}/`,
        })),
      },
    ],
  },
};

export const NoServices: Story = { args: { services: [] } };

const event = (name: string) => ({ label: name, href: `/events/${name}/` });

/** Worst case: a long name and owner, an unbroken summary, many events, and a one-letter service. */
export const WorstCase: Story = {
  args: {
    services: [
      {
        name: 'customer-notification-preferences-reconciliation-worker',
        href: '/services/customer-notification-preferences-reconciliation-worker/',
        summary:
          'Reconciles notification preferences between the CRM, the marketing platform and the in-app settings, nightly and on every consent change.',
        owner: {
          team: 'northwind-industries/platform-reliability-engineering',
          href: '/owners/northwind-industries/platform-reliability-engineering/',
        },
        domains: ['customer-communication-preferences-and-consent', 'notifications', 'compliance'],
        apis: [
          { label: 'Notification Preferences Administration API (v3, internal)', href: '/apis/a/' },
          { label: 'Consent Ledger API', href: '/apis/b/' },
        ],
        endpoints: 1,
        receives: [
          'customer.preferences.updated',
          'consent.withdrawn',
          'consent.granted',
          'account.closed',
          'account.merged',
        ].map(event),
        sends: ['preferences.reconciled', 'reconciliation.conflict.detected'].map(event),
        calls: [{ label: 'customer-profile-read-model-projection-service', href: '/services/c/' }],
        calledBy: [{ label: 'q', href: '/services/q/' }],
      },
      {
        name: 'q',
        href: '/services/q/',
        domains: [],
        apis: [],
        endpoints: 0,
        receives: [],
        sends: [],
        calls: [],
      },
      {
        name: 'zahlungsabwicklung',
        href: '/services/zahlungsabwicklung/',
        summary:
          'Verarbeitet Zahlungen über https://payments.internal.northwind-industries-holdings.example.com/v2/transactions/settlement',
        owner: { team: 'zahlungen' },
        domains: ['zahlungsverkehr'],
        apis: [],
        endpoints: 1284,
        receives: [],
        sends: [event('zahlung.abgeschlossen')],
        calls: [],
      },
    ],
  },
};

/** One service, with no owner: every count reads in the singular. */
export const One: Story = { args: { services: [{ ...users, endpoints: 1 }] } };
