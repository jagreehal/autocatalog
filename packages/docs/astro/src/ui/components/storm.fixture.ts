import type {
  BigPictureLaneView,
  StormColumnView,
  StormEndingView,
  StormHotspotView,
  StormScenarioView,
  StormStickyView,
} from './Storm';

const rows = (
  partial: Partial<Record<keyof StormColumnView['rows'], StormStickyView[]>>,
): StormColumnView['rows'] => ({
  who: [],
  command: [],
  decidedBy: [],
  happy: [],
  failure: [],
  policy: [],
  ...partial,
});

/** A catalogue import, stormed from its code. */
export const importColumns: StormColumnView[] = [
  {
    stage: 'Request import',
    rows: rows({
      who: [
        { kind: 'actor', text: 'Supplier user', summary: 'uploads a catalogue file in the app' },
        { kind: 'system', text: 'Job queue', summary: 'the catalogue import task' },
      ],
      command: [{ kind: 'command', text: 'Run catalogue import', summary: 'import id and email' }],
    }),
  },
  {
    stage: 'Load import record',
    rows: rows({
      who: [{ kind: 'system', text: 'Database' }],
      decidedBy: [{ kind: 'aggregate', text: 'Import' }],
      happy: [
        {
          kind: 'event',
          text: 'Import loaded',
          href: '#step-load',
          code: [{ file: 'src/import.ts', contains: 'loadImport' }],
        },
      ],
      failure: [
        {
          kind: 'failure',
          text: 'Import not found',
          hotspots: 1,
          code: [{ file: 'src/import.ts', contains: 'ImportNotFound' }],
        },
      ],
      policy: [
        { kind: 'hotspot', text: 'No policy after “Import not found”: nothing happens next' },
      ],
    }),
  },
  {
    stage: 'Download file',
    rows: rows({
      who: [{ kind: 'system', text: 'Object storage', summary: "the file at the import's key" }],
      command: [{ kind: 'command', text: 'Download catalogue file' }],
      decidedBy: [{ kind: 'aggregate', text: 'Import' }],
      happy: [{ kind: 'event', text: 'Catalogue file downloaded' }],
      failure: [
        {
          kind: 'failure',
          text: 'Catalogue file missing',
          summary: 'No key, no bucket, or nothing at that location.',
        },
      ],
      policy: [{ kind: 'policy', text: "Whenever the file can't be fetched, fail the import" }],
    }),
  },
  {
    stage: 'Ingest each product',
    repeats: 'once per parsed product',
    subflow: { title: 'Ingest a product', href: '/flows/imports/ingest-product/' },
    rows: rows({
      who: [{ kind: 'system', text: 'Database', summary: 'products and prices' }],
      command: [{ kind: 'command', text: 'Ingest product' }],
      decidedBy: [{ kind: 'aggregate', text: 'Product' }],
      happy: [
        { kind: 'event', text: 'Product created or updated' },
        { kind: 'event', text: 'Import progress recorded', summary: 'Every 100 products.' },
      ],
      failure: [
        {
          kind: 'failure',
          text: 'Product ingest failed',
          summary: 'Records the title, SKU and reason.',
        },
        { kind: 'failure', text: 'Product outside sales region', hotspots: 1 },
      ],
      policy: [
        {
          kind: 'policy',
          text: 'Whenever a product fails, record it and carry on with the next one',
        },
        { kind: 'policy', text: 'Every 100 products, save progress' },
      ],
    }),
  },
  {
    stage: 'Finish import',
    rows: rows({
      who: [
        {
          kind: 'read-model',
          text: 'Import status screen',
          summary: 'status, products imported, error list',
        },
        { kind: 'read-model', text: 'Notifications', summary: 'in-app and email' },
      ],
      command: [{ kind: 'command', text: 'Finish import' }],
      decidedBy: [{ kind: 'aggregate', text: 'Import' }],
      happy: [
        { kind: 'event', text: 'Catalogue import completed', summary: 'No errors.' },
        { kind: 'event', text: 'Catalogue import partially completed', hotspots: 1 },
      ],
      failure: [{ kind: 'failure', text: 'Catalogue import errored' }],
      policy: [{ kind: 'policy', text: 'Whenever the import finishes, notify the user' }],
    }),
  },
];

export const importHotspots: StormHotspotView[] = [
  {
    title: 'Missing import or supplier vanishes silently',
    href: '/imports/findings/missing-import-or-supplier/',
    step: 'Import not found',
    nature: 'question',
    status: 'draft',
    derived: false,
  },
  {
    title: 'No policy after “Import not found”: nothing happens next',
    step: 'Import not found',
    derived: true,
  },
];

export const importEndings: StormEndingView[] = [
  {
    title: 'Catalogue import completed',
    track: 'happy',
    summary: 'No errors.',
    status: 'complete',
    policies: ['Whenever the import finishes, notify the user'],
  },
  {
    title: 'Catalogue import errored',
    track: 'failure',
    summary: 'The file was missing or unreadable.',
    status: 'errored',
    policies: ['Whenever the import finishes, notify the user'],
  },
  { title: 'Import not found', track: 'failure', status: 'unchanged', policies: [] },
];

export const importScenarios: StormScenarioView[] = [
  {
    given: 'A valid file with new products',
    when: 'The import runs',
    // oxlint-disable-next-line unicorn/no-thenable -- Given, When, Then, not a Promise
    then: 'Products are created and the user is told how many',
    outcome: 'Catalogue import completed',
    test: 'test/import.test.ts',
  },
  {
    given: "The import's supplier has been deleted",
    when: 'The import runs',
    // oxlint-disable-next-line unicorn/no-thenable -- Given, When, Then, not a Promise
    then: 'Nothing visible happens',
    expected: 'The import ends as errored and the user is told',
    outcome: 'Supplier not found',
  },
];

export const lanes: BigPictureLaneView[] = [
  {
    title: 'Catalogue import',
    href: '/flows/imports/catalogue-import/',
    repository: 'imports',
    summary: "A supplier's product file becomes products in the catalogue.",
    events: [
      'Import loaded',
      'Supplier resolved',
      'Catalogue file downloaded',
      'Catalogue file parsed',
      'Product created or updated',
      'Catalogue import completed',
    ],
    failures: 7,
    hotspots: 4,
  },
  {
    title: 'Capturing a payment',
    href: '/flows/payments/capturing-a-payment/',
    repository: 'payments',
    events: ['Capture started', 'Payment captured'],
    failures: 1,
    hotspots: 0,
  },
];
