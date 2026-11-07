import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  validateUIMessages,
  type InferUITools,
  type LanguageModel,
  type UIMessage,
} from 'ai';
import { z } from 'zod';

/** A page a search found, for the assistant to choose from. */
export interface ChatFound {
  title: string;
  /** The page's address on the site, as an answer links it. */
  href: string;
  excerpt: string;
}

/** A value in a page's frontmatter, which is JSON. */
export type ChatData = string | number | boolean | null | ChatData[] | { [key: string]: ChatData };

/** A page read whole. */
export interface ChatPage {
  /** The document's id, for a rule that decides who may read it. */
  id?: string | undefined;
  title: string;
  href: string;
  text: string;
  /** A line saying what the page covers, shown under its title where a search lists it. */
  summary?: string | undefined;
  /** What the page says of itself, such as who may read it, for a source to filter by. */
  data?: { [key: string]: ChatData } | undefined;
}

/**
 * Where answers come from. A site gives each request the source for its reader,
 * so the assistant can search and read exactly the pages that reader can open.
 */
export interface ChatSource {
  search(query: string): ChatFound[] | Promise<ChatFound[]>;
  read(href: string): ChatPage | undefined | Promise<ChatPage | undefined>;
}

/** What one question led to, for analytics and for finding pages to write. */
export interface ChatTurn {
  question: string;
  /** The page it was asked on. */
  path?: string | undefined;
  searches: string[];
  read: string[];
  /** It read a page and reported no gap. */
  answered: boolean;
  /** What the assistant said is missing, when the pages do not answer. */
  gap?: string | undefined;
  ms: number;
  tokens?: number | undefined;
}

export interface ChatOptions {
  model: LanguageModel;
  /** What the pages are about, as the instructions name it: "the Acme Payments API". */
  subject: string;
  /**
   * The instructions in place of the defaults: a string replaces them, a
   * function is given them (see `defaultInstructions`) and returns its own.
   */
  system?: string | ((defaults: string) => string) | undefined;
  /** Lines added after the instructions, such as how to address the reader. */
  instructions?: string | undefined;
  /** What the model is told each tool does, in place of the defaults. */
  tools?: Partial<Record<ChatToolName, string>> | undefined;
  /** Searches and reads per answer, 5 by default. After a gap reported on the last, one more call replies. */
  maxSteps?: number | undefined;
  /** Messages of the conversation sent with each question. */
  history?: number | undefined;
  /** Headers for each model call, by conversation, for a provider that wants a session. */
  headers?: ((conversation: string) => Record<string, string>) | undefined;
  /** Told when a question arrives, and when its answer has finished. */
  onAsked?: ((question: Pick<ChatTurn, 'question' | 'path'>) => void) | undefined;
  onAnswered?: ((turn: ChatTurn) => void) | undefined;
}

export type ChatToolName = 'searchPages' | 'readPage' | 'reportGap';

/** What the model is told each tool does, unless `tools` says otherwise. */
export const DEFAULT_TOOL_DESCRIPTIONS: Record<ChatToolName, string> = {
  searchPages:
    'Search the pages this reader can open. Returns titles, addresses and a short excerpt.',
  readPage: 'Read one page whole, by the address a search returned.',
  reportGap:
    "Call this when the pages do not answer the reader's question. Say in a few words what a page would need to cover.",
};

/** The instructions an assistant about `subject` follows, unless `system` says otherwise. */
export function defaultInstructions(subject: string): string {
  return [
    `You answer questions about ${subject}, using only the pages of this site.`,
    'Search the pages first, read the most relevant ones, and answer from them in plain, short steps.',
    'Link each page you used as a Markdown link to its address.',
    'If the pages do not answer the question, call reportGap, then say so plainly. Never answer from general knowledge.',
    'Never name your tools or describe calling them: the reader sees only your answer.',
  ].join('\n');
}

/** A page's text past this is cut, so one long page cannot fill the context. */
const PAGE_LIMIT = 12_000;

/** The tools, recording what they did into `turn`. */
function chatTools(
  source: ChatSource,
  turn: Pick<ChatTurn, 'searches' | 'read' | 'gap'>,
  descriptions: Record<ChatToolName, string> = DEFAULT_TOOL_DESCRIPTIONS,
) {
  return {
    searchPages: tool({
      description: descriptions.searchPages,
      inputSchema: z.object({ query: z.string().describe('A few keywords') }),
      execute: async ({ query }) => {
        turn.searches.push(query);

        return source.search(query);
      },
    }),
    readPage: tool({
      description: descriptions.readPage,
      inputSchema: z.object({ href: z.string() }),
      execute: async ({ href }): Promise<Omit<ChatPage, 'data'> | { error: string }> => {
        const page = await source.read(href);

        // The same rule as the site: a page the reader cannot open, the assistant cannot read.
        if (!page) return { error: 'No such page' };

        turn.read.push(page.href);

        return { title: page.title, href: page.href, text: page.text.slice(0, PAGE_LIMIT) };
      },
    }),
    reportGap: tool({
      description: descriptions.reportGap,
      inputSchema: z.object({ topic: z.string().describe('What the missing page would cover') }),
      execute: async ({ topic }) => {
        turn.gap = topic;

        return { noted: true };
      },
    }),
  };
}

/** A conversation as the panel and the server share it, each tool step typed. */
export type ChatMessage = UIMessage<unknown, never, InferUITools<ReturnType<typeof chatTools>>>;

const body = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()).min(1),
  path: z.string().optional(),
});

const textOf = (message: UIMessage | undefined) =>
  message?.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim() ?? '';

/**
 * An assistant that answers only from a site's pages: it searches them, reads
 * the ones that fit, links what it used, and says so when nothing covers the
 * question rather than answering from what the model knows.
 */
export function createChat(options: ChatOptions) {
  const { model, subject, maxSteps = 5, history = 20 } = options;

  const defaults = defaultInstructions(subject);

  const instructions =
    options.system instanceof Function ? options.system(defaults) : (options.system ?? defaults);

  const descriptions = { ...DEFAULT_TOOL_DESCRIPTIONS, ...options.tools };

  return {
    /**
     * Answer one request from the panel, streamed. `context` is a line about
     * the reader, such as which account they are signed in to.
     */
    async respond(
      request: Request,
      {
        source,
        context,
        onAsked,
        onAnswered,
      }: Pick<ChatOptions, 'onAsked' | 'onAnswered'> & {
        source: ChatSource;
        context?: string | undefined;
      },
    ): Promise<Response> {
      const parsed = body.safeParse(await request.json().catch(() => undefined));

      if (!parsed.success) return new Response('Send a conversation', { status: 400 });

      const messages = await validateUIMessages<ChatMessage>({
        messages: parsed.data.messages,
      }).catch(() => undefined);

      if (!messages) return new Response('That conversation does not read', { status: 400 });

      const question = textOf(messages.at(-1));
      const path = parsed.data.path;

      const turn: Pick<ChatTurn, 'searches' | 'read' | 'gap'> = { searches: [], read: [] };

      const started = Date.now();

      // The chat's own callbacks, then this request's, such as for who asked.
      options.onAsked?.({ question, path });
      onAsked?.({ question, path });

      const result = streamText({
        model,
        ...(options.headers && { headers: options.headers(parsed.data.id ?? crypto.randomUUID()) }),
        system: [
          instructions,
          ...(options.instructions ? [options.instructions] : []),
          ...(context ? [context] : []),
        ].join('\n'),
        // The latest `history` messages go to the model.
        messages: await convertToModelMessages(messages.slice(-history)),
        // One step past `maxSteps`, only when the last one reported a gap: that
        // call is followed by the reply, so an answer never ends on a tool.
        stopWhen: stepCountIs(maxSteps + 1),
        prepareStep: ({ stepNumber, messages: sent }) =>
          stepNumber < maxSteps - 1
            ? undefined
            : {
                ...(stepNumber === maxSteps - 1
                  ? { activeTools: ['reportGap' as const] }
                  : { toolChoice: 'none' as const }),
                messages: [...sent, { role: 'user' as const, content: LAST_STEP }],
              },
        tools: chatTools(source, turn, descriptions),
        onFinish: ({ totalUsage }) => {
          const answered: ChatTurn = {
            question,
            path,
            searches: turn.searches,
            read: turn.read,
            answered: turn.read.length > 0 && !turn.gap,
            gap: turn.gap,
            ms: Date.now() - started,
            tokens: totalUsage.totalTokens,
          };

          options.onAnswered?.(answered);
          onAnswered?.(answered);
        },
      });

      return result.toUIMessageStreamResponse();
    },
  };
}

/** Said to the model on its last step, which may not search or read. */
const LAST_STEP =
  'You cannot search or read any more pages. Answer my question now, in plain short steps, from the pages you read, linking them. If they do not cover it, call reportGap if you have not, then say so and suggest talking to a person.';

/** Words a reader asks with that say nothing about what they want. */
const FILLER = new Set(
  'how what when where why who which can could does did should would will the and for are was were you your yours with this that these those have has had into from about there their they them its our'.split(
    ' ',
  ),
);

/** A query's words to look for: lower case, three letters or more, without the filler. */
export function queryWords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2 && !FILLER.has(word)),
    ),
  ];
}

/** How well a page fits: the words it has, a title's counting ten times. */
function fit(page: ChatPage, words: string[]): { matched: number; score: number } {
  const title = page.title.toLowerCase();
  const text = page.text.toLowerCase();

  return words.reduce(
    (sum, word) => {
      const inTitle = title.includes(word);
      const inText = text.split(word).length - 1;

      return {
        matched: sum.matched + (inTitle || inText > 0 ? 1 : 0),
        score: sum.score + (inTitle ? 10 : 0) + inText,
      };
    },
    { matched: 0, score: 0 },
  );
}

/** Each page that fits by `keep`, with how well. */
const fitting = (pages: readonly ChatPage[], words: string[], keep: (matched: number) => boolean) =>
  pages.flatMap((page) => {
    const how = fit(page, words);

    return keep(how.matched) ? [{ page, ...how }] : [];
  });

const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

/** Markdown or HTML as a reader sees it: no tags, link targets, emphasis or entities. */
export function plainText(text: string): string {
  return text
    .replace(/<\/?[a-z!][^>]*>/gi, ' ')
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*+|`+|~~/g, '')
    .replace(/(^|[^\p{L}\p{N}_])_{1,2}([^_\n]+?)_{1,2}(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, name: string) => {
      if (!name.startsWith('#')) return ENTITIES.get(name.toLowerCase()) ?? entity;

      const code = Number(name[1]?.toLowerCase() === 'x' ? `0${name.slice(1)}` : name.slice(1));

      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const EXCERPT = 160;

const found = (page: ChatPage): ChatFound => {
  const text = page.summary ?? plainText(page.text);

  return {
    title: page.title,
    href: page.href,
    excerpt: text.length > EXCERPT ? `${text.slice(0, EXCERPT).replace(/\s+\S*$/, '')}…` : text,
  };
};

/**
 * The pages with every word of the query, best first. Strict on purpose: a
 * question nothing covers comes back empty, which the assistant reports as a
 * gap rather than answering from a page about something else.
 */
export function searchPages(pages: readonly ChatPage[], query: string, limit = 6): ChatFound[] {
  const words = queryWords(query);

  if (words.length === 0) return [];

  return fitting(pages, words, (matched) => matched === words.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ page }) => found(page));
}

/**
 * The pages with any word of the query, those with more of them first: what a
 * reader typing into a search box expects, where `searchPages` would find
 * nothing for one word no page has.
 */
export function rankPages(pages: readonly ChatPage[], query: string, limit = 20): ChatFound[] {
  const words = queryWords(query);

  return fitting(pages, words, (matched) => matched > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score)
    .slice(0, limit)
    .map(({ page }) => found(page));
}

/** A source over pages held in memory, read by their address. */
export function pagesSource(pages: readonly ChatPage[]): ChatSource {
  const byHref = new Map(pages.map((page) => [page.href, page]));

  return {
    search: (query) => searchPages(pages, query),
    // An address with or without its trailing slash, or the reader's query string, is the same page.
    read: (href) =>
      byHref.get(`${href.split(/[?#]/)[0]!.replace(/\/?$/, '/')}`) ?? byHref.get(href),
  };
}

export { CHAT_ICON_NAMES, type ChatIconName, type ChatText, DEFAULT_CHAT_TEXT } from './text';
