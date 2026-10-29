import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Person } from 'autocatalog-docs-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MDX_MODULE, mdxMap, withComponentImports } from '../src/mdx';
import { remarkMermaid } from '../src/mermaid';
import { ownerProfile } from '../src/model';
import { ownPageRoutes } from '../src/own-pages';
import type { Owner } from '../src/owners';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-pages-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const imports = (names: string) => `import { ${names} } from ${JSON.stringify(MDX_MODULE)};\n`;

it('imports the built-in components an .mdx file uses, below its frontmatter', () => {
  expect(
    withComponentImports('---\ntitle: A\n---\n\n<Map focus="service/A" />\n<Term id="x" />'),
  ).toBe(`---\ntitle: A\n---\n${imports('Map, Term')}\n<Map focus="service/A" />\n<Term id="x" />`);

  // Its own import of a name wins, and a file using none is left alone.
  expect(
    withComponentImports('import { Map } from \'./map.astro\';\n\n<Map />\n<Owner name="A" />'),
  ).toBe(`${imports('Owner')}import { Map } from './map.astro';\n\n<Map />\n<Owner name="A" />`);
  expect(withComponentImports('# Mapping things <Mapper />')).toBeUndefined();

  // An alias binds its own name, so the built-in is still imported.
  expect(withComponentImports("import { Map as Own } from './map.astro';\n\n<Map />")).toBe(
    `${imports('Map')}import { Map as Own } from './map.astro';\n\n<Map />`,
  );
  expect(
    withComponentImports("import Map, * as parts from './map.astro';\n\n<Map />"),
  ).toBeUndefined();
  expect(
    withComponentImports("import './styles.css';\nimport Map from './map.astro';\n\n<Map />"),
  ).toBeUndefined();

  // An import in a code example binds nothing, and an element there uses nothing.
  expect(
    withComponentImports('Write `<Owner name="a" />`.\n\n~~~\n<Term id="x" />\n~~~'),
  ).toBeUndefined();
  expect(
    withComponentImports(
      '```mdx\nimport Map from \'./map.astro\';\n<Term id="x" />\n```\n\n<Map />',
    ),
  ).toBe(
    `${imports('Map')}\`\`\`mdx\nimport Map from './map.astro';\n<Term id="x" />\n\`\`\`\n\n<Map />`,
  );
});

it('draws a mermaid fence in an .mdx file as JSX, which MDX keeps verbatim', () => {
  const tree = {
    type: 'root',
    children: [{ type: 'code', lang: 'mermaid', value: 'graph LR\n  A --> B' }],
  };

  remarkMermaid()(tree, { path: '/docs/a.mdx' });

  expect(tree.children[0]).toEqual({
    type: 'mdxJsxFlowElement',
    name: 'pre',
    attributes: [{ type: 'mdxJsxAttribute', name: 'className', value: 'mermaid not-content' }],
    children: [{ type: 'text', value: 'graph LR\n  A --> B' }],
  });
});

it('routes a folder of pages as src/pages/ would, and refuses one the catalog publishes', async () => {
  await fs.mkdir(path.join(dir, 'api'));
  await fs.writeFile(path.join(dir, 'index.astro'), '');
  await fs.writeFile(path.join(dir, 'team.mdx'), '');
  await fs.writeFile(path.join(dir, 'api/status.json.ts'), '');
  await fs.writeFile(path.join(dir, '_layout.astro'), '');
  await fs.writeFile(path.join(dir, 'notes.txt'), '');

  expect(ownPageRoutes(dir, new Set(['/catalog']))).toEqual([
    ['/api/status.json', path.join(dir, 'api/status.json.ts')],
    ['/', path.join(dir, 'index.astro')],
    ['/team', path.join(dir, 'team.mdx')],
  ]);

  await fs.writeFile(path.join(dir, 'glossary.astro'), '');

  expect(() => ownPageRoutes(dir, new Set())).toThrow(
    `${path.join(dir, 'glossary.astro')}: /glossary is a page the catalog publishes; rename the file`,
  );
});

const person = (
  kind: Person['kind'],
  id: string,
  name: string,
  extra: Partial<Person> = {},
): Person => ({
  repository: 'handbook',
  file: `${kind}s/${id}.md`,
  body: '',
  kind,
  id,
  name,
  members: [],
  ...extra,
});

it('finds the directory’s profile for an owner however CODEOWNERS spells it', () => {
  const people = [
    person('team', 'payments', 'Payments', { email: 'pay@acme.test', members: ['ada', 'bob'] }),
    person('user', 'ada', 'Ada', { role: 'Engineer' }),
  ];

  // SAFETY: ownerProfile reads only the owner's key.
  const owner = (key: string) => ({ key }) as Owner;

  expect(ownerProfile(owner('acme/payments'), people)).toMatchObject({
    kind: 'team',
    email: 'pay@acme.test',
    members: [{ name: 'Ada', role: 'Engineer' }, { name: 'bob' }],
  });
  expect(ownerProfile(owner('ada'), people)).toMatchObject({
    role: 'Engineer',
    memberOf: ['Payments'],
  });
  expect(ownerProfile(owner('ledger'), people)).toBeUndefined();
});

it('refuses a map of a service the catalog does not have, with the nearest match', async () => {
  const catalog: Parameters<typeof mdxMap>[0] = {
    graph: {
      spec: 'autocatalog/graph-v1',
      resources: [
        {
          ref: { kind: 'service', id: 'PaymentService' },
          title: 'PaymentService',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domains: [] },
        },
      ],
      relationships: [],
    },
    events: [],
    flows: [],
    model: { glossaries: [], entities: [], dataProducts: [], people: [] },
  };

  await expect(mdxMap(catalog, '/', 'service/PaymntService')).rejects.toThrow(
    "no service 'PaymntService' — did you mean 'PaymentService'?",
  );
});
