/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { schemaTree } from '../lib/schema-tree';
import { SchemaTree } from './SchemaTree';

const meta = {
  title: 'Components/SchemaTree',
  component: SchemaTree,
  args: {
    nodes: schemaTree({
      type: 'object',
      required: ['id', 'amount'],
      properties: {
        id: { type: 'string', description: 'The payment identifier.', format: 'uuid' },
        amount: { type: 'number', minimum: 0, description: 'Amount in minor units.' },
        currency: { type: 'string', enum: ['GBP', 'EUR', 'USD'] },
        customer: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            address: {
              type: 'object',
              properties: {
                line1: { type: 'string' },
                postcode: { type: 'string', pattern: '^[A-Z0-9 ]+$' },
              },
            },
          },
        },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sku'],
            properties: { sku: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
          },
        },
      },
    }),
  },
} satisfies Meta<typeof SchemaTree>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  args: {
    nodes: schemaTree({
      type: 'object',
      properties: { kind: { type: 'string' } },
      oneOf: [
        {
          title: 'Card',
          properties: {
            method: { const: 'card' },
            last4: { type: 'string', minLength: 4, maxLength: 4 },
          },
          required: ['method', 'last4'],
        },
        {
          properties: { method: { const: 'transfer' }, iban: { type: 'string' } },
          required: ['method'],
        },
      ],
    }),
  },
};

export const NoProperties: Story = { args: { nodes: schemaTree({ type: 'object' }) } };
