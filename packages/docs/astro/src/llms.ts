import type { DomainModel, FlowNote } from 'autocatalog-docs-core';
import { dataProductPath, entityPath } from './model';
import { twinPath } from './twins';
import { docPage } from './ui/lib/docs';
import { groupByRepo, type DocListItem } from './view';

export interface LlmsTxtInput {
  title: string;
  description: string;
  /** Site origin without a trailing slash. Empty when no `site` is configured. */
  base: string;
  items: DocListItem[];
  /** The site's MCP endpoint, for an agent that can connect rather than read. */
  mcp?: string | undefined;
  /** OpenAPI references, each linked to its spec as JSON. */
  apis?: Array<{ path: string; title: string; summary?: string | undefined }>;
  /** Current events, each linked to its Markdown twin. */
  events?: Array<{ path: string; name: string; summary: string; owner?: string }>;
  /** Documents attached to flows, which an agent must not read as settled fact. */
  notes?: FlowNote[];
  /** Components, each linked to its Markdown twin. */
  components?: Array<{
    path: string;
    name: string;
    description?: string | undefined;
    repository: string;
    owner?: { team: string } | undefined;
  }>;
  /** The domain model: each term with its meaning, and the entities and data products with their pages. */
  model?: DomainModel;
  /** Whether llms-full.txt is published beside it. */
  full?: boolean;
}

/**
 * The llms.txt format: an H1, a blockquote summary, then H2 sections of
 * `[name](url): notes`. That is the whole specification.
 *
 * Generated from the same documents the site renders, so it is derived output
 * that cannot drift. Links point at the `.md` twins because that is the half of
 * the agent story with evidence behind it: agents ask for markdown when they
 * can get it, and far fewer of them ever fetch this file.
 */
export function renderLlmsTxt({
  title,
  description,
  base,
  items,
  apis = [],
  events = [],
  components = [],
  model,
  notes = [],
  full = true,
  mcp,
}: LlmsTxtInput): string {
  const lines = [
    `# ${title}`,
    '',
    `> ${description}`,
    '',
    ...(full ? [`Every page below in one file: [llms-full.txt](${base}/llms-full.txt)`, ''] : []),
    ...(mcp
      ? [`Connect an agent to search these pages and read the APIs over MCP: ${mcp}`, '']
      : []),
  ];

  for (const [repo, docs] of groupByRepo(items)) {
    lines.push(`## ${repo}`, '');

    for (const doc of docs) {
      // A decision's state and date are what an agent asks of it first.
      const kind = doc.kind ? [doc.kind, doc.status, doc.date].filter(Boolean).join(', ') : '';

      // A site for readers outside names no owner.
      const notes = [doc.owner && `owned by ${doc.owner}`, kind].filter(Boolean).join('; ');

      lines.push(`- [${doc.title}](${base}/${docPage(doc.id)}.md)${notes && `: ${notes}`}`);
    }

    lines.push('');
  }

  // The spec is what a client generator or an agent writing a request reads.
  if (apis.length > 0) {
    lines.push('## APIs', '');

    for (const api of apis) {
      const about = api.summary?.replace(/\.$/, '');

      lines.push(`- [${api.title}](${base}/${api.path}openapi.json)${about ? `: ${about}` : ''}`);
    }

    lines.push('');
  }

  // An event's twin carries its schema, so one link serves both the reader
  // and the code generator.
  if (events.length > 0) {
    lines.push('## Events', '');

    for (const event of events) {
      const owner = event.owner ? `; owned by ${event.owner}` : '';
      const summary = event.summary.replace(/\.$/, '');
      lines.push(`- [${event.name}](${base}/${twinPath(event.path)}): ${summary}${owner}`);
    }

    lines.push('');
  }

  if (components.length > 0) {
    lines.push('## Components', '');

    for (const { path, name, description, repository, owner } of components) {
      const notes = [
        description?.replace(/\s+/g, ' ').replace(/\.$/, ''),
        `in ${repository}`,
        owner && `owned by ${owner.team}`,
      ];

      lines.push(`- [${name}](${base}/${twinPath(path)}): ${notes.filter(Boolean).join('; ')}`);
    }

    lines.push('');
  }

  // The words themselves, not links: an agent naming a field needs the meaning.
  if (model && model.glossaries.length > 0) {
    lines.push('## Glossary', '');

    for (const glossary of model.glossaries) {
      for (const term of glossary.terms) {
        const aliases = term.aliases?.length ? `, also ${term.aliases.join(', ')}` : '';

        const about = term.refs.length
          ? ` Implemented by ${term.refs.map((ref) => `${ref.kind}/${ref.id}`).join(', ')}.`
          : '';

        lines.push(
          `- ${term.name} (${glossary.domain}${aliases})${term.summary ? `: ${term.summary}` : ''}${about}`,
        );
      }
    }

    lines.push('');
  }

  for (const [heading, resources] of [
    ['Entities', model?.entities.map((entity) => [entity, entityPath(entity)] as const) ?? []],
    [
      'Data products',
      model?.dataProducts.map((product) => [product, dataProductPath(product)] as const) ?? [],
    ],
  ] as const) {
    if (resources.length === 0) continue;

    lines.push(`## ${heading}`, '');

    for (const [resource, page] of resources) {
      lines.push(
        `- [${resource.name}](${base}/${page})${resource.summary ? `: ${resource.summary}` : ''}`,
      );
    }

    lines.push('');
  }

  if (notes.length > 0) {
    lines.push('## Notes on flows', '');
    lines.push('A draft or a question is a hypothesis, not established behaviour.', '');

    for (const note of notes) {
      const facts = [note.nature, note.status, note.hotspot && 'open'].filter(Boolean).join(', ');
      const where = note.step ? `${note.flow}, step ${note.step}` : note.flow;

      lines.push(
        `- [${note.title}](${base}/${docPage(note.id)}.md): ${where}${facts && `; ${facts}`}`,
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * llms-full.txt: the same header, then every twin in full, for an agent that
 * would rather read the whole catalog in one request than follow each link.
 */
export function renderLlmsFullTxt({
  title,
  description,
  twins,
}: {
  title: string;
  description: string;
  /** Each page's Markdown twin, documents first, then events, then data models. */
  twins: string[];
}): string {
  return `${[`# ${title}`, `> ${description}`, ...twins.map((twin) => twin.trim())].join('\n\n')}\n`;
}
