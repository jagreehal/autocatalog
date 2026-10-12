import { ENTITY_KINDS, ownersOf, type Entity, type EntityKind } from './schemas.js';
import { refKey, type Catalog } from './loader.js';
import { filterForAudience } from './visibility.js';

const KIND_HEADINGS: Record<EntityKind, string> = {
  agent: 'Agents',
  tool: 'Tools',
  model: 'Models',
  workflow: 'Workflows',
  domain: 'Domains',
  eval: 'Evals',
  policy: 'Policies',
};

const formatTag = (k: string, v: string): string => `[${k}: ${v}]`;

const entityTags = (e: Entity): string => {
  const parts: string[] = [];

  if (e.kind === 'agent' || e.kind === 'tool') parts.push(formatTag('risk', e.risk));

  if (e.kind === 'tool') {
    parts.push(formatTag('effects', e.side_effects));

    if (e.protocol) parts.push(formatTag('protocol', e.protocol));
  }

  if (e.status !== 'active') parts.push(formatTag('status', e.status));

  if (e.version !== undefined) parts.push(formatTag('version', e.version));
  const allOwners = ownersOf(e);

  if (allOwners.length > 0) parts.push(formatTag('owners', allOwners.join(', ')));

  if (e.kind === 'agent' && e.repository?.url) parts.push(formatTag('repo', e.repository.url));

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
};

export type LlmsTxtOptions = {
  /** Title at the top of the file. Defaults to "Catalog". */
  title?: string;
  /** Short tagline / blurb under the title. */
  description?: string;
  /** Public base URL for entity links. e.g. "https://catalog.example.com". Defaults to relative paths. */
  baseUrl?: string;
  /** Include each entity's body (audience-filtered for 'agent') as a section after the index. */
  includeBodies?: boolean;
};

export const buildLlmsTxt = (cat: Catalog, opts: LlmsTxtOptions = {}): string => {
  const {
    title = 'Catalog',
    description = 'AI agent catalog: agents, tools, models, workflows, domains, evals, and policies.',
    baseUrl = '',
    includeBodies = true,
  } = opts;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> ${description}`);
  lines.push('');

  for (const kind of ENTITY_KINDS) {
    const bucket = cat.entities.get(kind);

    if (!bucket || bucket.size === 0) continue;
    lines.push(`## ${KIND_HEADINGS[kind]}`);
    lines.push('');
    const sorted = [...bucket.values()].sort((a, b) => a.id.localeCompare(b.id));

    for (const e of sorted) {
      const url = `${baseUrl}/${kind}/${e.id}`;
      const tags = entityTags(e);
      const desc = e.description ?? '';
      lines.push(`- [${e.name}](${url}): ${desc}${tags}`);
    }

    lines.push('');
  }

  if (!includeBodies) return lines.join('\n');

  lines.push('---');
  lines.push('');
  lines.push('## Entity details');
  lines.push('');

  for (const kind of ENTITY_KINDS) {
    const bucket = cat.entities.get(kind);

    if (!bucket || bucket.size === 0) continue;
    const sorted = [...bucket.values()].sort((a, b) => a.id.localeCompare(b.id));

    for (const e of sorted) {
      const ref = refKey(kind, e.id);
      const m = cat.meta.get(ref);

      if (!m?.body) continue;
      const agentBody = filterForAudience(m.body, 'agent').trim();

      if (!agentBody) continue;
      lines.push(`### ${kind}/${e.id} — ${e.name}`);
      lines.push('');
      lines.push(agentBody);
      lines.push('');
    }
  }

  return lines.join('\n');
};
