import { twinPath } from './twins';
import { groupByRepo, type DocListItem } from './view';

export interface LlmsTxtInput {
  title: string;
  description: string;
  /** Site origin without a trailing slash. Empty when no `site` is configured. */
  base: string;
  items: DocListItem[];
  /** Current events, each linked to its Markdown twin. */
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
  const lines = [
    `# ${title}`,
    '',
    `> ${description}`,
    '',
    `Every page below in one file: [llms-full.txt](${base}/llms-full.txt)`,
    '',
  ];

  for (const [repo, docs] of groupByRepo(items)) {
    lines.push(`## ${repo}`, '');

    for (const doc of docs) {
      // A decision's state and date are what an agent asks of it first.
      const kind = doc.kind ? [doc.kind, doc.status, doc.date].filter(Boolean).join(', ') : '';

      lines.push(
        `- [${doc.title}](${base}/${doc.id}.md): owned by ${doc.owner}${kind && `; ${kind}`}`,
      );
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
