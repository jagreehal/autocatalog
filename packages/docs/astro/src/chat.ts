import fs from 'node:fs';
import {
  CHAT_ICON_NAMES,
  type ChatOptions,
  type ChatPage,
  type ChatSource,
  type ChatTurn,
  type ChatText,
  DEFAULT_CHAT_TEXT,
} from 'autocatalog-chatbot';
import { z } from 'zod';
import { apiDescription, apiOperations, apiPath, apiTitle } from './apis';
import type { DocsCatalog } from './catalog';
import { eventPath } from './event-path';
import { docPage } from './ui/lib/docs';

const text = z.string().min(1);

/** Text of a JSON document past this is cut: the model reads the operations first. */
const SPEC_LIMIT = 40_000;

/** What a site's assistant module is given for each question. */
export interface SiteChatRequest {
  request: Request;
  /** What the site's middleware set, such as who is signed in. */
  locals: App.Locals;
  /** Every page the build published, each with its frontmatter as `data`. */
  pages: ChatPage[];
}

/**
 * What `chat.module` in autocatalog.site.json default-exports: the options of
 * `createChat`, and optionally, per question, the source the assistant reads
 * (the pages this reader may open) and a line about the reader.
 */
export interface SiteChatOptions extends Omit<ChatOptions, 'onAsked' | 'onAnswered'> {
  source?: ((chat: SiteChatRequest) => ChatSource | Promise<ChatSource>) | undefined;
  context?: ((chat: SiteChatRequest) => string | undefined) | undefined;
  /** Told each question, with the request it came in: who asked, from `locals`. */
  onAsked?:
    ((question: Pick<ChatTurn, 'question' | 'path'>, chat: SiteChatRequest) => void) | undefined;
  /** Told what it searched, read and answered, with the request it came in. */
  onAnswered?: ((turn: ChatTurn, chat: SiteChatRequest) => void) | undefined;
}

/**
 * What the assistant may answer from: the pages this site publishes, each at
 * its address. Built from the catalog the site was built from, so a site for an
 * audience answers only from what that audience can open.
 */
export function chatPages(catalog: DocsCatalog, base: string): ChatPage[] {
  const at = (page: string) => `${base}${page.replace(/^\/+/, '').replace(/\/?$/, '/')}`;

  const docs = catalog.docs.map((doc) => ({
    id: doc.id,
    title: text.safeParse(doc.data.title).data ?? doc.id,
    href: at(docPage(doc.id)),
    text: [text.safeParse(doc.data.summary).data, doc.body].filter(Boolean).join('\n\n'),
    // As the page's title block shows it: Starlight's `description`, then the convention's `summary`.
    summary: text.safeParse(doc.data.description ?? doc.data.summary).data,
    data: doc.data,
  }));

  const apis = catalog.apis.map((api) => ({
    title: apiTitle(api),
    href: at(apiPath(api)),
    text: [
      apiDescription(api),
      ...apiOperations(api).map(
        ({ method, path, summary, deprecated }) =>
          `${method} ${path}${summary ? `: ${summary}` : ''}${deprecated ? ' (deprecated)' : ''}`,
      ),
      // The rest of the spec, for parameters, bodies and responses.
      JSON.stringify(api.document).slice(0, SPEC_LIMIT),
    ]
      .filter(Boolean)
      .join('\n'),
  }));

  const events = catalog.events.map((entry) => {
    const { name, summary } = entry.event.frontmatter;

    return {
      title: name,
      href: at(eventPath(entry)),
      text: [summary, entry.event.body.trim(), JSON.stringify(entry.event.schema)]
        .filter(Boolean)
        .join('\n\n'),
      summary,
    };
  });

  return [...docs, ...apis, ...events];
}

/** The panel's words a site set, refusing a name the panel does not show. */
export function chatText(text: Record<string, string> | undefined): Partial<ChatText> | undefined {
  const unknown = Object.keys(text ?? {}).filter((name) => !(name in DEFAULT_CHAT_TEXT));

  if (unknown.length > 0) {
    throw new Error(
      `chat.text: no ${unknown.join(', ')}. The panel shows ${Object.keys(DEFAULT_CHAT_TEXT).join(', ')}`,
    );
  }

  return text;
}

/** The panel's icons a site set, each file read now so the page carries it. */
export function chatIcons(icons: Record<string, string> | undefined) {
  if (!icons) return undefined;

  const names: readonly string[] = CHAT_ICON_NAMES;
  const unknown = Object.keys(icons).filter((name) => !names.includes(name));

  if (unknown.length > 0) {
    throw new Error(`chat.icons: no ${unknown.join(', ')}. Icons are ${names.join(', ')}`);
  }

  return Object.fromEntries(
    Object.entries(icons).map(([name, icon]) => [
      name,
      icon.startsWith('file:') ? fs.readFileSync(new URL(icon), 'utf8') : icon,
    ]),
  );
}
