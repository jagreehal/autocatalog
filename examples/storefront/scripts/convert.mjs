// Rebuild EventCatalog's demo as autocatalog team repositories. Run by
// regenerate.mjs, which says which EventCatalog commit it reads:
//   node convert.mjs <eventcatalog-example> <from-eventcatalog output> <out>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// yaml is autocatalog's own dependency; the demo installs nothing of its own.
const require = createRequire(
  path.resolve(import.meta.dirname, '../../../packages/events/core/package.json'),
);

const YAML = require('yaml');

const [EC, IMP, OUT] = process.argv.slice(2);

const HANDBOOK = 'handbook';

const PERSON = { id: 'sam-rivera', name: 'Sam Rivera' };

// ---------- helpers
const read = (f) => fs.readFileSync(f, 'utf8');

const json = (f) => JSON.parse(read(f));

const write = (f, s) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
};

const writeJson = (f, v) => write(f, JSON.stringify(v, null, 2) + '\n');

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);

    if (e.name === 'node_modules' || e.name === 'versioned') return [];

    return e.isDirectory() ? walk(p) : [p];
  });

const matter = (src) => {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);

  return m ? { data: YAML.parse(m[1]) ?? {}, body: m[2] } : { data: {}, body: src };
};

const front = (data, body) =>
  `---\n${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;

const slug = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const lc = (s) => String(s).toLowerCase();

const defined = (data) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== ''));

// ---------- index every EventCatalog resource
const KINDS = {
  events: 'event',
  commands: 'command',
  queries: 'query',
  services: 'service',
  systems: 'system',
  domains: 'domain',
  subdomains: 'domain',
  containers: 'container',
  channels: 'channel',
  entities: 'entity',
  flows: 'flow',
  agents: 'agent',
  adrs: 'adr',
};

const resources = [];

for (const file of walk(EC)) {
  if (!/\/index\.mdx?$/.test(file)) continue;
  const dir = path.dirname(file);
  const parentKind = KINDS[path.basename(path.dirname(dir))];

  if (!parentKind) continue;
  const { data, body } = matter(read(file));
  const rel = path.relative(EC, dir);
  const segs = rel.split('/');
  // nearest domain folder (a subdomain belongs to its parent domain)
  const di = segs.indexOf('domains');
  const domain = di >= 0 ? lc(segs[di + 1]) : undefined;
  resources.push({ kind: parentKind, id: data.id, data, body, rel, domain });
}

const byKind = (k) => resources.filter((r) => r.kind === k);

const find = (k, id) => resources.find((r) => r.kind === k && r.id === id);

// ownership: own owners, else nearest ancestor with owners
const ownerOf = (r) => {
  // An owner is written as its id, or as { id }.
  if (r.data.owners?.length) return r.data.owners[0].id ?? r.data.owners[0];

  const anc = resources
    .filter((a) => a.data.owners?.length && r.rel.startsWith(a.rel + '/'))
    .sort((a, b) => b.rel.length - a.rel.length)[0];

  return anc ? ownerOf(anc) : undefined;
};

// ---------- the importer's view of services, tables and messages
const graph = json(path.join(IMP, '.autocatalog/imports/eventcatalog.json')).graph;

const serviceNodes = graph.resources.filter((r) => r.ref.kind === 'service');

const serviceTeam = new Map(serviceNodes.map((s) => [s.ref.id, s.owner?.team]));

const ecServiceName = new Map(byKind('service').map((s) => [s.id, s.data.name]));

const ecSystem = new Map(byKind('system').map((s) => [s.id, s]));

const ecContainer = new Map(byKind('container').map((s) => [s.id, s]));

const messages = []; // { kind, id, domain, dir, manifest }

for (const domain of fs.readdirSync(path.join(IMP, 'events'))) {
  const d = path.join(IMP, 'events', domain);

  if (!fs.statSync(d).isDirectory()) continue;

  for (const name of fs.readdirSync(d)) {
    const dir = path.join(d, name);
    messages.push({ kind: 'event', name, dir, manifest: json(path.join(dir, 'autocatalog.json')) });
  }
}

for (const domain of fs.readdirSync(path.join(IMP, 'commands/eventcatalog'))) {
  for (const name of fs.readdirSync(path.join(IMP, 'commands/eventcatalog', domain))) {
    const dir = path.join(IMP, 'commands/eventcatalog', domain, name);
    messages.push({
      kind: 'command',
      name,
      dir,
      manifest: json(path.join(dir, 'autocatalog.json')),
    });
  }
}

const teamOfMessage = (m) =>
  m.manifest.owner?.team ??
  serviceTeam.get(m.manifest.handler ?? m.manifest.producers?.[0]) ??
  'handbook';

for (const m of messages) m.team = teamOfMessage(m);

const messageById = new Map(messages.map((m) => [m.manifest.id, m]));

// A message under a subdomain is that subdomain's, as EventCatalog shows it,
// though the importer files it under the top-level domain.
const subdomains = byKind('domain').filter((d) => d.rel.includes('/subdomains/'));

for (const m of messages) {
  const source = resources.find(
    (r) => ['event', 'command', 'query'].includes(r.kind) && r.id === m.manifest.id,
  );

  const sub = source && subdomains.find((d) => source.rel.startsWith(`${d.rel}/`));

  if (sub) m.manifest.domain = lc(sub.id);
}

const parentOf = (d) => {
  const parent = byKind('domain').find((p) => p !== d && d.rel.startsWith(`${p.rel}/subdomains/`));

  return parent ? lc(parent.id) : undefined;
};

const teams = [
  ...new Set([...serviceNodes.map((s) => s.owner?.team), ...messages.map((m) => m.team)]),
].filter(Boolean);

const repoDir = (team) => path.join(OUT, team);

// ---------- body conversion: EventCatalog MDX → autocatalog Markdown
const repoOfDoc = new Map(); // ec rel → `${repo}/${docPath}` filled as docs are planned

let PIPE = '|';

function linkFor(kind, id) {
  switch (kind) {
    case 'service': {
      const name = ecServiceName.get(id) ?? id;

      return `[[service${PIPE}${name}]]`;
    }

    case 'event':
    case 'command':
    case 'query':
    case 'message': {
      const m = messageById.get(id);

      if (!m) return `\`${id}\``;

      // commands have no page of their own; a two-part id opens the Catalog on them
      return m.kind === 'event'
        ? `[[event${PIPE}${m.team}/${m.manifest.domain}/${m.manifest.id}]]`
        : `[[event${PIPE}${m.manifest.domain}/${m.manifest.id}]]`;
    }

    case 'domain':
      return `[[domain${PIPE}${lc(id)}]]`;
    case 'system': {
      const s = ecSystem.get(id);

      return s ? `[[system${PIPE}${id}]]` : `**${id}**`;
    }

    case 'container':
      return `**${ecContainer.get(id)?.data.name ?? id}**`;
    case 'entity': {
      const e = find('entity', id);

      return `**${e?.data.name ?? id}**`;
    }

    case 'team':
      return `[[owner${PIPE}${id}]]`;
    case 'flow': {
      const f = find('flow', id);

      return f ? `[[flow${PIPE}${ownerOf(f)}/${id}]]` : `**${id}**`;
    }

    case 'channel':
      return `\`${id}\``;
    case 'doc':
    case 'adr':
      return repoOfDoc.has(`${kind}:${id}`)
        ? `[[doc${PIPE}${repoOfDoc.get(`${kind}:${id}`)}]]`
        : `**${id}**`;
    default:
      return `**${id}**`;
  }
}

const DROP_BLOCK = [
  'Tiles',
  'MessageTable',
  'EntityPropertiesTable',
  'CustomProperties',
  'AgentTools',
  'ADRTable',
  'Prompt',
];

const DIAGRAMS = [
  'NodeGraph',
  'ContextDiagram',
  'ArchitectureGraph',
  'ComponentDiagram',
  'EntityMap',
  'Flow',
];

function convertBody(body, { map } = {}) {
  let s = body;
  s = s.replace(/^import .*$/gm, '');

  // block components to drop entirely, with children
  for (const c of DROP_BLOCK) {
    s = s.replace(new RegExp(`<${c}\\b[^>]*/>`, 'g'), '');
    s = s.replace(new RegExp(`<${c}\\b[\\s\\S]*?</${c}>`, 'g'), '');
  }

  for (const c of ['Footer', 'SchemaViewer', 'Schema', 'ResourceLink', 'CustomProperty']) {
    s = s.replace(new RegExp(`<${c}\\b[^>]*/>`, 'g'), '');
    s = s.replace(new RegExp(`<${c}\\b[^>]*>([\\s\\S]*?)</${c}>`, 'g'), '$1');
  }

  for (const c of DIAGRAMS) s = s.replace(new RegExp(`<${c}\\b[^>]*/>`, 'g'), map ? map : '');
  // headings for titled wrappers
  s = s.replace(/<(Accordion|Step)\b[^>]*title=["{]`?([^"}`]*)`?["}][^>]*>/g, '\n#### $2\n');
  s = s.replace(/<\/?(Columns|Column|CodeGroup|AccordionGroup|Accordion|Steps|Step)\b[^>]*>/g, '');
  s = s.replace(/<Admonition\b[^>]*>([\s\S]*?)<\/Admonition>/g, (_, inner) =>
    inner
      .trim()
      .split('\n')
      .map((l) => `> ${l.trim()}`)
      .join('\n'),
  );
  s = s.replace(/\[\[([a-z]+)(\\?\|)([^\]]+)\]\]/g, (_, kind, pipe, id) => {
    PIPE = pipe;

    return linkFor(kind, id.trim());
  });
  // Headings that only introduced a dropped component
  s = s.replace(/^#{1,6} [^\n]*\n\s*(?=#{1,6} |$(?![\s\S]))/gm, '');
  // indentation left by unwrapped JSX would read as code blocks
  s = s.replace(/^[ \t]+(?=\S)/gm, (ws, off, all) => (inFence(all, off) ? ws : ''));

  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function inFence(all, offset) {
  const before = all.slice(0, offset);

  return (before.match(/^\s*```/gm) ?? []).length % 2 === 1;
}

// ---------- 1. event contracts
const consumes = new Map(); // team → { receives: [], sends: [] }

const pushConsume = (team, key, entry) => {
  if (!consumes.has(team)) consumes.set(team, { receives: [], sends: [] });
  const list = consumes.get(team)[key];

  if (!list.some((e) => e.service === entry.service && e.id === entry.id)) list.push(entry);
};

const examplesOf = (dir) => {
  const d = path.join(dir, 'examples');

  if (!fs.existsSync(d)) return [];

  return walk(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return json(f);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
};

for (const m of messages) {
  const mf = m.manifest;
  const schemaFile = path.join(m.dir, 'schema.json');
  const schema = fs.existsSync(schemaFile) ? json(schemaFile) : { type: 'object' };
  delete schema['x-eventcatalog'];
  const team = m.team;
  const sameTeam = (svc) => serviceTeam.get(svc) === team;

  const x = {
    id: mf.id,
    version: mf.version,
    domain: mf.domain,
    name: mf.name,
    summary: mf.summary?.trim(),
    ...defined({
      status: mf.status === 'active' ? undefined : mf.status,
      deprecation: mf.deprecation || undefined,
      tags: mf.tags?.length ? mf.tags : undefined,
    }),
  };

  if (m.kind === 'event') {
    x.producers = mf.producers ?? [];
    const own = (mf.consumers ?? []).filter(sameTeam);

    if (own.length) x.consumers = own;

    for (const c of (mf.consumers ?? []).filter((c) => !sameTeam(c)))
      pushConsume(serviceTeam.get(c) ?? HANDBOOK, 'receives', {
        service: c,
        id: `${mf.domain}/${mf.id}`,
      });

    // a producer in another team sends it
    for (const p of x.producers.filter((p) => !sameTeam(p))) {
      pushConsume(serviceTeam.get(p), 'sends', { service: p, id: `${mf.domain}/${mf.id}` });
    }

    x.producers = x.producers.filter(sameTeam);

    if (mf.transport?.length) x.transport = mf.transport;

    if (mf.delivery) x.delivery = mf.delivery;
    const examples = examplesOf(m.dir);

    const contract = {
      ...schema,
      title: schema.title ?? m.name,
      // The importer marks a schema it had to invent; the event's summary reads better.
      description: schema.description?.startsWith('Placeholder')
        ? mf.summary?.trim()
        : (schema.description ?? mf.summary?.trim()),
      ...defined({ examples: examples.length ? examples : undefined }),
      'x-autocatalog': x,
    };

    writeJson(path.join(repoDir(team), 'contracts/events', `${mf.id}.json`), contract);
  } else {
    // commands and queries keep their manifest beside the payload schema
    const manifest = {
      kind: 'command',
      id: mf.id,
      version: mf.version,
      name: mf.name,
      summary: mf.summary?.trim(),
      domain: mf.domain,
      ...defined({ handler: mf.handler || undefined }),
      senders: (mf.senders ?? []).filter(sameTeam),
      schema: './schema.json',
      outcome: mf.outcome,
      ...defined({
        transport: mf.transport?.length ? mf.transport : undefined,
        tags: mf.tags?.length ? mf.tags : undefined,
      }),
    };

    for (const sdr of (mf.senders ?? []).filter((s) => !sameTeam(s)))
      pushConsume(serviceTeam.get(sdr) ?? HANDBOOK, 'sends', {
        service: sdr,
        id: `${mf.domain}/${mf.id}`,
      });
    const dir = path.join(repoDir(team), 'commands', mf.id);
    writeJson(path.join(dir, 'autocatalog.json'), manifest);
    writeJson(path.join(dir, 'schema.json'), schema);
  }
}

for (const [team, c] of consumes) {
  const out = {};

  if (c.receives.length) out.receives = c.receives;

  if (c.sends.length) out.sends = c.sends;
  writeJson(path.join(repoDir(team), 'autocatalog.consumes.json'), out);
}

// ---------- 2. services, systems and datastores
for (const team of teams) {
  const svcs = serviceNodes.filter((s) => s.owner?.team === team);
  const names = new Set(svcs.map((s) => s.ref.id));
  const rels = graph.relationships.filter((r) => names.has(r.from.id));
  const tableIds = new Set(rels.map((r) => r.to.id));
  const tables = graph.resources.filter((r) => r.ref.kind !== 'service' && tableIds.has(r.ref.id));

  if (!svcs.length && !tables.length) continue;
  const ns = team;
  const retable = (ref) => (ref.kind === 'service' ? ref : { ...ref, namespace: ns });

  const res = [...svcs, ...tables].map((r) => {
    const { repository: _repository, ...attributes } = r.attributes ?? {};

    return { ...r, ref: retable(r.ref), attributes };
  });

  // declared services, their systems and datastores: an import `ac resources scan` folds into resources.json
  writeJson(path.join(repoDir(team), '.autocatalog/imports/services.json'), {
    graph: {
      spec: graph.spec,
      resources: res,
      relationships: rels.map((r) => ({ ...r, to: retable(r.to) })),
    },
    claims: [],
  });
}

// ---------- 3. specs (OpenAPI, AsyncAPI, carrier SLAs)
for (const file of walk(EC)) {
  if (!/\.(ya?ml)$/.test(file) || file.includes('/_data/')) continue;
  const rel = path.relative(EC, file);

  if (!rel.startsWith('domains/')) continue;

  const owner = ownerOf(
    resources
      .filter((r) => rel.startsWith(r.rel + '/'))
      .sort((a, b) => b.rel.length - a.rel.length)[0] ?? {
      data: {},
      rel: '',
    },
  );

  const svc = resources.find((r) => r.kind === 'service' && rel.startsWith(r.rel + '/'))?.data.name;

  const base = svc ? `${slug(svc)}-${path.basename(file)}` : path.basename(file);
  const dest = path.join(repoDir(owner ?? HANDBOOK), 'contracts', base);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);

  if (/carrier-sla/.test(file)) {
    writeJson(dest.replace(/\.ya?ml$/, '.autocatalog.json'), {
      specification: {
        name: 'Carrier SLAs',
        summary: 'Delivery promises each carrier makes, by service level.',
        service: 'Shipping API',
      },
    });
  }
}

// ---------- 4. documents
// plan every document first so [[doc|…]] and [[adr|…]] links resolve
const plans = []; // { team, path, data, body, map }

const plan = (team, docPath, data, body, opts = {}) => {
  plans.push({ team, docPath, data, body, ...opts });

  return `${team}/${docPath.replace(/^docs\//, '').replace(/\.mdx?$/, '')}`;
};

// Domain, system and service pages: overview files, the body at the top of
// each page. The page draws its own map, so the demo's diagrams are dropped.
const overviews = []; // { team, file, data, body }

const overview = (team, file, data, body) => overviews.push({ team, file, data, body });

for (const d of byKind('domain')) {
  overview(
    ownerOf(d) ?? HANDBOOK,
    `overviews/domains/${lc(d.id)}.md`,
    {
      name: d.data.name,
      summary: d.data.summary?.trim(),
      owner: ownerOf(d),
      parent: parentOf(d),
    },
    d.body,
  );
}

for (const s of byKind('system')) {
  overview(
    ownerOf(s) ?? HANDBOOK,
    `overviews/systems/${s.id}.md`,
    {
      name: s.data.name,
      summary: s.data.summary?.trim(),
      owner: ownerOf(s),
    },
    s.body,
  );
}

for (const s of byKind('service')) {
  const name = s.data.name;
  const team = serviceTeam.get(name) ?? ownerOf(s) ?? HANDBOOK;
  overview(
    team,
    `overviews/services/${slug(name)}.md`,
    {
      name,
      summary: s.data.summary?.trim(),
      owner: team,
    },
    s.body,
  );
}

// event and command narratives
for (const r of [...byKind('event'), ...byKind('command'), ...byKind('query')]) {
  const m = messageById.get(r.id);

  if (!m) continue;
  const body = convertBody(r.body);

  if (body.replace(/^#+ .*$/gm, '').trim().length < 40) continue;
  plan(
    m.team,
    `docs/messages/${m.manifest.id}.mdx`,
    {
      title: r.data.name,
      owner: m.team,
      summary: r.data.summary?.trim(),
      about: m.kind === 'event' ? [`event/${m.manifest.domain}/${m.manifest.id}`] : undefined,
      // Read from the event's own page; a team's sidebar keeps guides, runbooks and decisions.
      sidebar: { hidden: true },
    },
    r.body,
  );
}

// ADRs
for (const a of byKind('adr')) {
  const team = ownerOf(a) ?? HANDBOOK;

  const p = plan(
    team,
    `docs/adr/${a.id}.md`,
    {
      title: a.data.name ?? a.data.title,
      owner: team,
      summary: a.data.summary?.trim(),
      status: lc(a.data.status ?? 'accepted'),
      date: a.data.date ?? '2025-01-01',
    },
    a.body,
  );

  repoOfDoc.set(`adr:${a.id}`, p);
}

// domain docs (guides, runbooks)
for (const file of walk(EC)) {
  const rel = path.relative(EC, file);
  const m = /^domains\/([^/]+)\/docs\/(.+)\.mdx?$/.exec(rel);

  if (!m) continue;
  const { data, body } = matter(read(file));

  const dom =
    find('domain', m[1]) ??
    resources.find((r) => r.kind === 'domain' && r.rel === `domains/${m[1]}`);

  const team = ownerOf(dom) ?? HANDBOOK;
  const sub = m[2].replace(/\/index$/, '');

  const kindDir = sub.startsWith('runbooks/')
    ? 'runbooks'
    : sub.startsWith('guides/')
      ? 'guides'
      : 'guides';

  const name = path.basename(sub);

  const p = plan(
    team,
    `docs/${kindDir}/${name}.mdx`,
    {
      title: data.title ?? data.name ?? name,
      owner: team,
      summary: data.summary?.trim() ?? data.description,
      // Listed under its domain in the Catalog sidebar.
      about: dom ? [`domain/${lc(dom.id)}`] : undefined,
    },
    body,
  );

  if (data.id) repoOfDoc.set(`doc:${data.id}`, p);
}

// top-level docs → handbook
for (const file of walk(path.join(EC, 'docs'))) {
  const rel = path.relative(path.join(EC, 'docs'), file);
  const { data, body } = matter(read(file));

  const docPath = `docs/${rel.replace(/^(\d+-)?/, '').replace(/\/\d+-/g, '/')}`.replace(
    /\.md$/,
    '.mdx',
  );

  const p = plan(
    HANDBOOK,
    docPath,
    {
      title: data.title ?? data.name,
      owner: HANDBOOK,
      summary: data.summary?.trim() ?? data.description,
    },
    body,
    { map: '<Map />' },
  );

  if (data.id) repoOfDoc.set(`doc:${data.id}`, p);
  repoOfDoc.set(`doc:${rel.replace(/\.mdx?$/, '')}`, p);
}

for (const p of plans) {
  const data = defined(p.data);

  if (!data.title) data.title = path.basename(p.docPath).replace(/\.mdx?$/, '');
  write(path.join(repoDir(p.team), p.docPath), front(data, convertBody(p.body, { map: p.map })));
}

for (const o of overviews) {
  write(path.join(repoDir(o.team), o.file), front(defined(o.data), convertBody(o.body)));
}

// The handbook leads the Docs sidebar, in the order a newcomer reads it.
writeJson(path.join(repoDir(HANDBOOK), 'docs/meta.json'), {
  label: 'Handbook',
  order: 0,
  sidebar: [
    { directory: 'platform', label: 'Platform' },
    { directory: 'domains', label: 'Domains' },
    { directory: 'flows', label: 'Flows' },
    { directory: 'operations', label: 'Operations' },
  ],
});

// ---------- 5. entities
const ENTITY_KEYS = ['name', 'summary', 'identifier', 'aggregateRoot', 'properties'];

const cleanProps = (props) =>
  props?.map((p) => {
    const { relationType: _relationType, referenceTarget: _referenceTarget, ...rest } = p;

    return rest.properties ? { ...rest, properties: cleanProps(rest.properties) } : rest;
  });

for (const e of byKind('entity')) {
  const team = ownerOf(e) ?? HANDBOOK;

  const data = Object.fromEntries(
    ENTITY_KEYS.flatMap((k) => (e.data[k] === undefined ? [] : [[k, e.data[k]]])),
  );

  if (data.summary) data.summary = String(data.summary).trim();
  data.properties = cleanProps(data.properties);

  if (e.domain) data.domains = [e.domain];

  const holders = byKind('service')
    .filter((s) => (s.data.entities ?? []).some((x) => x.id === e.id))
    .map((s) => s.data.name);

  if (holders.length) data.services = holders;
  write(path.join(repoDir(team), 'entities', `${e.id}.md`), front(data, convertBody(e.body)));
}

// ---------- 6. flows
const stepOut = (s) => {
  const out = { id: String(s.id) };

  if (s.title) out.title = s.title;

  if (s.summary) out.summary = String(s.summary).trim();

  if (s.message) {
    const m = messageById.get(s.message.id);

    if (m?.kind === 'event') out.event = `${m.manifest.domain}/${m.manifest.id}`;
    // `command:` would make this an EventStorming board, where branches read as failures;
    // the demo's flows are maps whose branches run side by side
    else if (m)
      out.custom = { title: s.title ?? m.manifest.name, summary: `Command: ${m.manifest.name}` };
    else out.custom = { title: s.title ?? s.message.id };
  } else if (s.service) {
    out.service = ecServiceName.get(s.service.id) ?? s.service.id;
  } else if (s.actor) {
    out.actor = defined({
      name: s.actor.name,
      summary: s.actor.summary ? String(s.actor.summary).trim() : undefined,
    });
  } else if (s.externalSystem) {
    out.externalSystem = Object.fromEntries(
      ['name', 'summary', 'url'].flatMap((k) =>
        s.externalSystem[k] ? [[k, String(s.externalSystem[k]).trim()]] : [],
      ),
    );
  } else if (s.flow) {
    const f = find('flow', s.flow.id);
    out.custom = {
      title: s.title ?? f?.data.name ?? s.flow.id,
      summary: `Flow: ${f?.data.name ?? s.flow.id}`,
    };
  } else if (s.container) {
    out.custom = { title: ecContainer.get(s.container.id)?.data.name ?? s.container.id };
  } else if (s.custom) {
    out.custom = Object.fromEntries(
      ['title', 'summary', 'url'].flatMap((k) => (s.custom[k] ? [[k, s.custom[k]]] : [])),
    );
  }

  // A next step is written as its id, or as { id, label }.
  const hop = (n) =>
    n?.id === undefined ? String(n) : n.label ? { id: String(n.id), label: n.label } : String(n.id);

  if (s.next_step) out.next_step = hop(s.next_step);

  if (s.next_steps) out.next_steps = s.next_steps.map(hop);

  return out;
};

for (const f of byKind('flow')) {
  const team = ownerOf(f) ?? HANDBOOK;

  const data = {
    title: f.data.name,
    summary: f.data.summary?.trim(),
    steps: (f.data.steps ?? []).map(stepOut),
  };

  write(path.join(repoDir(team), 'flows', `${f.id}.md`), front(data, convertBody(f.body)));
}

// ---------- 7. directory: teams and one person
for (const file of fs.readdirSync(path.join(EC, 'teams'))) {
  const { data, body } = matter(read(path.join(EC, 'teams', file)));

  const t = {
    name: data.name,
    summary: data.summary?.trim(),
    email: data.email,
    slackDirectMessageUrl: data.slackDirectMessageUrl,
    members: [PERSON.id],
  };

  write(path.join(repoDir(HANDBOOK), 'teams', `${data.id}.md`), front(t, convertBody(body)));
}

write(
  path.join(repoDir(HANDBOOK), 'users', `${PERSON.id}.md`),
  front(
    { name: PERSON.name, role: 'Principal engineer', email: 'sam.rivera@acme.test' },
    'Leads the platform teams that own the Acme storefront.',
  ),
);

console.log(`teams: ${teams.join(', ')}`);

console.log(
  `messages: ${messages.length}, docs: ${plans.length}, overviews: ${overviews.length}, entities: ${byKind('entity').length}, flows: ${byKind('flow').length}`,
);
