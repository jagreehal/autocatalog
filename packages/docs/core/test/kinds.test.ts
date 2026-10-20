import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDocs } from '../src/check';
import { DEFAULT_FRONTMATTER_SCHEMA } from '../src/frontmatter';
import {
  defaultConventionsFile,
  docKind,
  docKinds,
  kindContract,
  resolveDocKinds,
} from '../src/kinds';
import { buildDocsManifest } from '../src/manifest';
import { createDocsResourceGraph } from '../src/resource-graph';
import { readDocs } from '../src/read-docs';
import { frontmatterValidator } from '../src/frontmatter';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-kinds-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const doc = (title: string, extra = ''): string =>
  `---\ntitle: ${title}\nowner: Payments\n${extra}---\n\nBody text.\n`;

const ids = (kinds: Array<{ id: string }>) => kinds.map((kind) => kind.id);

describe('docKinds', () => {
  it('ships decisions, runbooks and incidents with no file at all', () => {
    const kinds = docKinds({});

    expect(ids(kinds)).toEqual(['adr', 'runbook', 'incident']);
    expect(kinds.map((kind) => kind.path)).toEqual(['decisions', 'runbooks', 'incidents']);
  });

  it('adds a kind, changes a default field and turns a default off', () => {
    const kinds = docKinds({
      kinds: {
        runbook: false,
        adr: { folder: 'decisions' },
        postmortem: { label: 'Postmortems', folder: 'postmortems', columns: ['severity'] },
      },
    });

    expect(ids(kinds)).toEqual(['adr', 'incident', 'postmortem']);
    expect(kinds[0]).toMatchObject({
      folder: 'decisions',
      label: 'Decisions',
      statusField: 'status',
    });
    // The index path defaults from the label.
    expect(kinds[2]).toMatchObject({ path: 'postmortems', columns: ['severity'] });
  });

  it('names what is wrong with the file, field by field', () => {
    expect(() => docKinds({ kinds: { adr: { folder: '/adr/' } } }, 'handbook.json')).toThrow(
      /handbook\.json is not a valid conventions file:[\s\S]*folder/,
    );
    expect(() => docKinds({ kinds: { 'Bad Id': {} } })).toThrow(/lowercase/);
    expect(() => docKinds({ kinds: { adr: { colour: 'red' } } })).toThrow(/colour/);
    expect(() => docKinds({ kinds: { postmortem: { label: 'Postmortems' } } })).toThrow(
      /kinds\.postmortem: a new kind needs a label and a folder/,
    );
  });

  it('refuses two kinds sharing a folder or an index path', () => {
    expect(() => docKinds({ kinds: { postmortem: { label: 'Incidents', folder: 'pm' } } })).toThrow(
      /path 'incidents' is also incident's/,
    );
    expect(() => docKinds({ kinds: { postmortem: { label: 'PMs', folder: 'adr' } } })).toThrow(
      /folder 'adr' is also adr's/,
    );
  });

  it('writes a starting file that reads back as the defaults', () => {
    expect(docKinds(JSON.parse(JSON.stringify(defaultConventionsFile())))).toEqual(docKinds({}));
  });
});

describe('resolveDocKinds', () => {
  it('finds the conventions the handbook publishes, as it finds the contract', async () => {
    await write(
      'handbook/contracts/autocatalog.conventions.json',
      JSON.stringify({ kinds: { incident: false } }),
    );
    await write('payments/docs/readme.md', doc('Readme'));

    const resolved = resolveDocKinds(root);

    expect(resolved.file).toBe(path.join(root, 'handbook/contracts/autocatalog.conventions.json'));
    expect(ids(resolved.kinds)).toEqual(['adr', 'runbook']);
  });

  it('refuses to choose between two different conventions files', async () => {
    await write('a/contracts/autocatalog.conventions.json', '{}');
    await write('b/contracts/autocatalog.conventions.json', '{"kinds":{"adr":false}}');

    expect(() => resolveDocKinds(root)).toThrow(/--docs-conventions/);
  });
});

describe('docKind', () => {
  const kinds = docKinds({ kinds: { legacy: { label: 'Legacy ADRs', folder: 'adr/legacy' } } });

  const kindOf = (id: string, data = {}) => docKind({ id, repo: id.split('/')[0]!, data }, kinds);

  it('reads the kind from the folder, the deepest one winning', () => {
    expect(kindOf('payments/adr/0001-use-kafka')).toMatchObject({ kind: { id: 'adr' } });
    expect(kindOf('payments/adr/legacy/0001-old')).toMatchObject({ kind: { id: 'legacy' } });
    expect(kindOf('payments/guides/setup')).toEqual({ kind: null });
  });

  it("leaves a folder's introduction a plain document", () => {
    expect(kindOf('payments/adr/README')).toEqual({ kind: null });
    expect(kindOf('payments/runbooks/index')).toEqual({ kind: null });
  });

  it('lets frontmatter name the kind, and only one that exists', () => {
    expect(kindOf('payments/notes', { kind: 'incident' })).toMatchObject({
      kind: { id: 'incident' },
    });
    expect(kindOf('payments/notes', { kind: 'postmortem' })).toEqual({
      failure: expect.stringContaining("kind 'postmortem' is not a kind this organisation keeps"),
    });
  });
});

describe('kindContract', () => {
  it('lets a closed base contract carry the kind’s own fields', () => {
    const closed = { ...DEFAULT_FRONTMATTER_SCHEMA, additionalProperties: false };
    const [adr] = docKinds({});
    const validator = frontmatterValidator(kindContract(closed, adr!));

    expect(
      validator.validate({
        title: 'Use Kafka',
        owner: 'Payments',
        status: 'accepted',
        date: '2026-01-02',
      }),
    ).toEqual([]);
    expect(validator.validate({ title: 'Use Kafka', owner: 'Payments', stray: 1 })).not.toEqual([]);
  });
});

describe('kinds in the check and the index', () => {
  it('reports what each kind requires, naming the kind', async () => {
    await write('a/docs/adr/0001-kafka.md', doc('Use Kafka', 'status: approved\n'));
    await write(
      'a/docs/incidents/2026-09-01-outage.md',
      doc('Outage', 'date: 2026-09-01\nseverity: critical\nstatus: resolved\n'),
    );

    const failures = checkDocs(root).failures.join('\n');

    expect(failures).toContain('0001-kafka.md (adr): status: must be one of proposed, accepted');
    expect(failures).toContain("0001-kafka.md (adr): (root): must have required property 'date'");
    expect(failures).toContain('outage.md (incident): severity: must be one of sev1, sev2');
  });

  it('checks that a superseded decision names one that exists', async () => {
    await write(
      'a/docs/adr/0002-kafka.md',
      doc('Use Kafka', 'status: accepted\ndate: 2026-02-01\nsupersedes:\n  - a/adr/0001-gone\n'),
    );

    expect(checkDocs(root).failures).toEqual([
      expect.stringContaining("supersedes 'a/adr/0001-gone' does not resolve"),
    ]);
  });

  it('records kind, status and date in the index and the graph', async () => {
    await write(
      'a/docs/adr/0001-kafka.md',
      doc('Use Kafka', 'status: accepted\ndate: 2026-02-01\n'),
    );
    await write('a/docs/guide.md', doc('Guide'));

    const manifest = buildDocsManifest(root, { includeDates: false });

    expect(manifest['a/adr/0001-kafka']).toMatchObject({
      kind: 'adr',
      status: 'accepted',
      date: '2026-02-01',
    });
    expect(manifest['a/guide']).toMatchObject({ kind: null, status: null, date: null });

    const graph = createDocsResourceGraph(readDocs(root), manifest);
    const adr = graph.resources.find((resource) => resource.ref.id === 'adr/0001-kafka');

    expect(adr?.attributes).toMatchObject({ kind: 'adr', status: 'accepted' });
  });
});
