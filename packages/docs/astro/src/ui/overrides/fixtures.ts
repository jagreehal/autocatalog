import type { PageTitleChromeProps } from './PageTitleChrome';

export const eventHead: PageTitleChromeProps = {
  kind: 'event',
  kindLabel: 'Event',
  catalogKey: 'event:payments/payment.completed',
  summary: 'Emitted once a payment has been captured and the ledger entry is safe to write.',
  pills: [{ text: 'v1.2.0' }, { text: 'Needs review', tone: 'warn' }],
  actions: [
    { label: 'View JSON Schema', href: '/payments/payment.completed/schema.json', icon: 'doc' },
  ],
};

export const docHead: PageTitleChromeProps = {
  kind: 'doc',
  kindLabel: 'Document',
  catalogKey: 'document:payments-service/runbook',
  summary: 'What to do when payments stop completing.',
  pills: [],
  actions: [
    {
      label: 'Copy page as Markdown',
      href: '/payments-service/runbook.md',
      icon: 'copy',
      copy: true,
    },
    { label: 'View as Markdown', href: '/payments-service/runbook.md', icon: 'doc' },
  ],
};
