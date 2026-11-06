import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReportTable } from './ReportTable';

const meta = {
  title: 'Reports/ReportTable',
  component: ReportTable,
} satisfies Meta<typeof ReportTable>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A day with one settled payment. */
export const OneRow: Story = { args: { rows: [{ reference: 'PAY-1', amount: '£42.00' }] } };
