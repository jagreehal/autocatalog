/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventCatalogDiagram } from './EventCatalogDiagram';

const meta = {
  title: 'Components/EventCatalogDiagram',
  component: EventCatalogDiagram,
  args: {
    embed: false,
    // A real, public EventCatalog, so the frame shows a real diagram. Its
    // embed=true mode needs an EventCatalog licence the public demo lacks, so the
    // story frames the full page rather than a licence notice.
    iframeSrc: 'https://demo.eventcatalog.dev/visualiser/domains/payments/1.0.0',
    openHref: 'https://demo.eventcatalog.dev/visualiser/domains/payments/1.0.0',
    title: 'Payments domain diagram',
  },
} satisfies Meta<typeof EventCatalogDiagram>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Without embed mode the reader is sent to the hosted EventCatalog. */
export const Default: Story = {};

export const Embedded: Story = { args: { embed: true } };
