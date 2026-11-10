/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiPage } from './ApiPage';

const meta = {
  title: 'Pages/ApiPage',
  component: ApiPage,
  parameters: { layout: 'fullscreen' },
  args: {
    version: '1.0.0',
    repository: 'payments',
    file: 'contracts/openapi.json',
    specHref: '/apis/payments/openapi/openapi.json',
    services: [{ name: 'payments-service', href: '/services/payments-service/' }],
    operations: [
      { method: 'POST', path: '/payments', summary: 'Take a payment', deprecated: false },
      { method: 'GET', path: '/payments/{id}', summary: 'Read a payment', deprecated: false },
      { method: 'DELETE', path: '/payments/{id}', deprecated: true },
    ],
  },
} satisfies Meta<typeof ApiPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Unmatched: Story = { args: { version: undefined, services: [] } };

/** Scalar's whole page below the site's header, with its own sidebar and search. */
export const Full: Story = { args: { layout: 'full' } };

/**
 * The default: Scalar in a frame beside the site's navigation, with a rail for
 * the sidebar's toggle. Storybook does not serve the reference page, so a
 * stand-in shows where it goes.
 */
export const Framed: Story = {
  args: {
    layout: 'frame',
    title: 'Payments API reference',
    referenceHref:
      'data:text/html,<p style="font:14px monospace;padding:1rem">Scalar’s reference loads here, with its own sidebar and search.</p>',
  },
};

/** What the frame shows: Scalar alone, on a page of its own. */
export const Standalone: Story = { args: { layout: 'standalone' } };
