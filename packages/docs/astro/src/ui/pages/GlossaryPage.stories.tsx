/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlossaryPage } from './GlossaryPage';

const meta = {
  title: 'Pages/GlossaryPage',
  component: GlossaryPage,
  parameters: { layout: 'fullscreen' },
  args: {
    domains: [
      {
        domain: 'payments',
        href: '/domains/payments/',
        repository: 'payments-service',
        file: 'glossary/payments.md',
        terms: [
          {
            anchor: 'payments-capture',
            name: 'Capture',
            summary: 'Taking money a card issuer has already authorised.',
            description: 'A capture can be for less than the authorised amount, never more.',
            aliases: ['settlement'],
            about: [
              { name: 'PaymentService', href: '/services/PaymentService/' },
              {
                name: 'Payment captured',
                href: '/events/payments-service/payments/payment.captured/',
              },
            ],
          },
          { anchor: 'payments-refund', name: 'Refund', aliases: [], about: [] },
        ],
      },
    ],
  },
} satisfies Meta<typeof GlossaryPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoGlossary: Story = { args: { domains: [] } };
