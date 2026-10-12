/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventVersions } from './EventVersions';

const meta = {
  title: 'Components/EventVersions',
  component: EventVersions,
  args: {
    versions: [
      { href: '/events/payment.completed', label: 'v2.0.0', current: true, active: true },
      { href: '/events/payment.completed/1.1.0', label: 'v1.1.0', current: false, active: false },
      { href: '/events/payment.completed/1.0.0', label: 'v1.0.0', current: false, active: false },
    ],
  },
} satisfies Meta<typeof EventVersions>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithChanges: Story = {
  args: {
    changesHtml:
      // As `ac changelog` prints it, rendered to HTML.
      '<h3>payments/payment.completed: 1.1.0 → 2.0.0</h3><ul><li>✖ BREAKING: field <code>legacyId</code> (string) was removed</li><li>✖ BREAKING: field <code>currency</code> is now required — payloads that omit it become invalid</li><li>+ additive: new field <code>capturedAt</code> (string)</li></ul>',
  },
};

export const OlderVersionActive: Story = {
  args: {
    versions: [
      { href: '/events/payment.completed', label: 'v2.0.0', current: true, active: false },
      { href: '/events/payment.completed/1.0.0', label: 'v1.0.0', current: false, active: true },
    ],
  },
};
