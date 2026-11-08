/**
 * Every word the panel shows. `{query}`, `{title}` and `{count}` are filled in
 * where a line names one, so each can be rewritten, translated or shortened.
 */
export const DEFAULT_CHAT_TEXT = {
  /** The button that opens the panel; the panel's title when unset. */
  launcher: '',
  emptyTitle: 'How can we help?',
  emptyDescription: 'Answers come from the pages on this site.',
  placeholder: 'Ask a question…',
  questionLabel: 'Your question',
  send: 'Send',
  close: 'Close',
  error: 'Sorry, that didn’t work. Try again in a moment.',
  searching: 'Searching the pages for “{query}”',
  searched: 'Searched the pages for “{query}”',
  reading: 'Reading a page',
  read: 'Read “{title}”',
  thinking: 'Thinking',
  thought: 'Thought',
  usedOne: 'Used 1 page',
  usedMany: 'Used {count} pages',
  talkToPerson: 'Talk to a person',
  backToAnswers: 'Back to answers',
  supportTitle: 'Message a person',
  supportNote: 'A person will reply by email.',
  email: 'Your email',
  message: 'How can we help?',
  transcript: 'Include my conversation with the assistant',
  sendMessage: 'Send message',
  sending: 'Sending…',
  sentTitle: 'Message sent',
  sentDescription: 'A person will reply by email.',
  sendFailed: 'That didn’t send. Please try again.',
  /** On a site's search page when nothing matches: asks the panel instead. */
  askAbout: 'Ask about “{query}”',
};

export type ChatText = typeof DEFAULT_CHAT_TEXT;

/** A line of `ChatText` with its placeholders filled in. */
export function fill(line: string, values: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** The icons a site can replace. */
export const CHAT_ICON_NAMES = [
  'launcher',
  'empty',
  'send',
  'close',
  'support',
  'search',
  'read',
  'sources',
  'thinking',
  'thought',
  'sent',
] as const;

export type ChatIconName = (typeof CHAT_ICON_NAMES)[number];
