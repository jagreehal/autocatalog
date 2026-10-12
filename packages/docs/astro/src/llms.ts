import { groupByRepo, type DocListItem } from './view';

export interface LlmsTxtInput {
  title: string;
  description: string;
  /** Site origin without a trailing slash. Empty when no `site` is configured. */
  base: string;
  items: DocListItem[];
  /** Current events, each linked to its JSON Schema. */
  events?: Array<{ path: string; name: string; summary: string; owner?: string }>;
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
  events = [],
}: LlmsTxtInput): string {
  const lines = [`# ${title}`, '', `> ${description}`, ''];

  for (const [repo, docs] of groupByRepo(items)) {
    lines.push(`## ${repo}`, '');

    for (const doc of docs) {
      lines.push(`- [${doc.title}](${base}/${doc.id}.md): owned by ${doc.owner}`);
    }

    lines.push('');
  }

  // Events link to their JSON Schema: for a contract, the schema is the
  // machine-readable form, the way the .md twin is for a document.
  if (events.length > 0) {
    lines.push('## Events', '');

    for (const event of events) {
      const owner = event.owner ? `; owned by ${event.owner}` : '';
      const summary = event.summary.replace(/\.$/, '');
      lines.push(`- [${event.name}](${base}/${event.path}schema.json): ${summary}${owner}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
