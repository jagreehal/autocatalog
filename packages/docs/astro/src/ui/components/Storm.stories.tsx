/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BigPicture,
  InlineSticky,
  Sticky,
  StormBoard,
  StormEndings,
  StormHotspots,
  StormLegend,
  StormScenarios,
} from './Storm';
import {
  importColumns,
  importEndings,
  importHotspots,
  importScenarios,
  lanes,
} from './storm.fixture';

const meta = {
  title: 'Components/Storm/StormBoard',
  component: StormBoard,
  args: { columns: importColumns, label: 'Catalogue import' },
} satisfies Meta<typeof StormBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A process-level board, with the code behind each sticky one click away. */
export const Board: Story = {};

/** One stage, as a flow with a single step draws it. */
export const OneStage: Story = { args: { columns: importColumns.slice(1, 2) } };

/** A board with no code linked offers no switch for it. */
export const WithoutCode: Story = { args: { codeToggle: false } };

/** Every kind of sticky, as the legend shows them. */
export const Legend: Story = { render: () => <StormLegend /> };

/** In a sentence, as an MDX page writes `<Sticky kind="event">`. */
export const InSentence: Story = {
  render: () => (
    <p className="max-w-prose">
      Every run starts with <InlineSticky kind="event">Import loaded</InlineSticky>, and a file
      nobody can read ends it with{' '}
      <InlineSticky kind="failure">Catalogue file unreadable</InlineSticky> before{' '}
      <InlineSticky kind="policy">Whenever it can&apos;t be parsed, fail the import</InlineSticky>{' '}
      takes over.
    </p>
  ),
};

/** Stickies on their own, each kind and state. */
export const Stickies: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Sticky kind="event">Import loaded</Sticky>
      <Sticky kind="failure" summary="No key, no bucket, or nothing at that location.">
        Catalogue file missing
      </Sticky>
      <Sticky kind="event" hotspots={2}>
        Catalogue import partially completed
      </Sticky>
      <Sticky kind="command" href="#">
        Run catalogue import
      </Sticky>
      <Sticky kind="event" showCode code={[{ file: 'src/import.ts', contains: 'loadImport' }]}>
        Import loaded
      </Sticky>
      <Sticky kind="policy">
        Whenever a product fails, record it and carry on with the next one, however many fail
      </Sticky>
    </div>
  ),
};

export const Hotspots: Story = { render: () => <StormHotspots hotspots={importHotspots} /> };

export const Endings: Story = { render: () => <StormEndings endings={importEndings} /> };

export const Scenarios: Story = { render: () => <StormScenarios scenarios={importScenarios} /> };

/** Every flow as a lane of facts, with what is open on each. */
export const BigPictureLanes: Story = { render: () => <BigPicture lanes={lanes} /> };
