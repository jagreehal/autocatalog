/** @jsxImportSource react */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import * as React from 'react';
import { createPortal } from 'react-dom';
import Markdown, { type Components } from 'react-markdown';
import { Bubble, BubbleContent } from '#ui/components/ui/bubble.tsx';
import { Button } from '#ui/components/ui/button.tsx';
import { Checkbox } from '#ui/components/ui/checkbox.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Field, FieldError, FieldGroup, FieldLabel } from '#ui/components/ui/field.tsx';
import { Input } from '#ui/components/ui/input.tsx';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#ui/components/ui/input-group.tsx';
import { Message, MessageContent } from '#ui/components/ui/message.tsx';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '#ui/components/ui/message-scroller.tsx';
import { Textarea } from '#ui/components/ui/textarea.tsx';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '#ui/components/ui/trace.tsx';
import { cn } from '#ui/lib/utils.ts';
import type { ChatMessage } from '../index';
import { type ChatIconName, type ChatText, DEFAULT_CHAT_TEXT, fill } from '../text';
import { type ChatIcon, DEFAULT_CHAT_ICONS, renderIcon } from './customize';

type Part = ChatMessage['parts'][number];

/** Dispatch on `window` with the question as `detail` to open the panel and ask it. */
export const ASK_EVENT = 'autocatalog:ask';

/** Dispatch on `window` to open the panel at the support form. */
export const SUPPORT_EVENT = 'autocatalog:support';

export interface ChatPanelProps {
  /** Where the site answers, with `createChat().respond`. */
  api: string;
  /** The panel's name, and the button that opens it unless `text.launcher` says otherwise. */
  title: string;
  /** One line under the title, such as whose pages answer. */
  description?: string | undefined;
  /** Questions a reader can send with one click before asking their own. */
  suggestions?: string[] | undefined;
  /**
   * A form to message a person, with the conversation attached. It posts
   * `{ email, message, page, from, transcript }` as JSON to `api`.
   */
  support?: { api: string; note?: string | undefined } | undefined;
  /** Any of the words the panel shows; see `DEFAULT_CHAT_TEXT`. */
  text?: Partial<ChatText> | undefined;
  /** Any of its icons: a React node, or an SVG's URL or markup drawn in the text colour. */
  icons?: Partial<Record<ChatIconName, ChatIcon>> | undefined;
  /**
   * `floating` is a button in a corner that opens the panel over the page;
   * `inline` is the panel itself, always open, where it is rendered.
   */
  layout?: 'floating' | 'inline' | undefined;
  /** The corner a floating panel sits in. */
  side?: 'right' | 'left' | undefined;
  /** Whether a floating panel starts open, the first time a reader sees it. */
  defaultOpen?: boolean | undefined;
  /** Added to the panel's own classes. Each part also has a `data-slot` to style. */
  className?: string | undefined;
  /** How Markdown in an answer renders, element by element, as react-markdown takes it. */
  markdown?: Components | undefined;
  /** How a link to the site's own page in an answer is written, such as with a `?ref=`. */
  linkHref?: ((href: string) => string) | undefined;
  /** Where the conversation is kept for the tab, so moving between pages keeps it. */
  storageKey?: string | undefined;
}

/** Which the panel shows: the conversation, or the form to message a person. */
export type ChatView = 'chat' | 'support';

interface Saved {
  id: string;
  open: boolean;
  view: ChatView;
  messages: ChatMessage[];
}

const textOf = (message: ChatMessage) =>
  message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');

// Storage can be unavailable (private windows, blocked site data); the chat then starts fresh.
function load(key: string): Saved | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, state: Saved) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...state, messages: state.messages.slice(-30) }));
  } catch {
    // Not kept: the next page starts a new conversation.
  }
}

type Chat = ReturnType<typeof useChat<ChatMessage>>;

/** Everything a part of the panel reads and does, for parts of a site's own. */
export interface ChatPanelState {
  /** The AI SDK chat: its messages, status, error, `sendMessage` and `stop`. */
  chat: Chat;
  busy: boolean;
  /** Send a question, unless one is still being answered. */
  send: (question: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  view: ChatView;
  setView: (view: ChatView) => void;
  /** Where the reader came to the support form from, sent with the message. */
  supportFrom: 'assistant' | 'page';
  setSupportFrom: (from: 'assistant' | 'page') => void;
  layout: 'floating' | 'inline';
  side: 'right' | 'left';
  title: string;
  description: string | undefined;
  suggestions: string[];
  support: ChatPanelProps['support'];
  /** The panel's words, the site's over the defaults. */
  text: ChatText;
  /** An icon by name, the site's or the default. */
  icon: (name: ChatIconName) => React.ReactNode;
  linkHref: (href: string) => string;
  markdown: Components | undefined;
}

const ChatPanelContext = React.createContext<ChatPanelState | null>(null);

/** The panel's state, inside `<ChatRoot>`: build any part of your own from it. */
export function useChatPanel(): ChatPanelState {
  const state = React.useContext(ChatPanelContext);

  if (!state) throw new Error('useChatPanel needs a <ChatRoot> around it');

  return state;
}

export interface ChatRootProps extends Omit<ChatPanelProps, 'className'> {
  children: React.ReactNode;
}

/**
 * The assistant's state, for the parts inside it. Floating, it renders into
 * <body>, so the page's own layout cannot cover it.
 */
export function ChatRoot(props: ChatRootProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return props.layout === 'inline' ? (
    <Root {...props} />
  ) : (
    createPortal(<Root {...props} />, document.body)
  );
}

function Root({
  api,
  title,
  description,
  suggestions = [],
  support,
  text: words,
  icons,
  layout = 'floating',
  side = 'right',
  defaultOpen = false,
  markdown,
  linkHref = (href) => href,
  storageKey = 'autocatalog-chat',
  children,
}: ChatRootProps) {
  const inline = layout === 'inline';
  const [saved] = React.useState(() => load(storageKey));
  const [open, setOpen] = React.useState(inline || (saved?.open ?? defaultOpen));
  const [view, setView] = React.useState<ChatView>(saved?.view ?? 'chat');
  const [supportFrom, setSupportFrom] = React.useState<'assistant' | 'page'>('assistant');

  const [transport] = React.useState(
    () => new DefaultChatTransport<ChatMessage>({ api, body: () => ({ path: location.pathname }) }),
  );

  const chat = useChat<ChatMessage>({ transport, id: saved?.id, messages: saved?.messages });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';

  // Saved once a reply has finished, so a half-streamed answer is never restored.
  React.useEffect(() => {
    if (!busy) save(storageKey, { id: chat.id, open, view, messages: chat.messages });
  }, [busy, chat.id, chat.messages, open, view, storageKey]);

  React.useEffect(() => {
    const ask = (event: Event) => {
      const question = event instanceof CustomEvent ? String(event.detail ?? '').trim() : '';

      if (!question) return;

      setOpen(true);
      setView('chat');
      void chat.sendMessage({ text: question });
    };

    const toSupport = () => {
      if (!support) return;

      setOpen(true);
      setSupportFrom('page');
      setView('support');
    };

    window.addEventListener(ASK_EVENT, ask);
    window.addEventListener(SUPPORT_EVENT, toSupport);

    return () => {
      window.removeEventListener(ASK_EVENT, ask);
      window.removeEventListener(SUPPORT_EVENT, toSupport);
    };
  }, [chat, support]);

  const state: ChatPanelState = {
    chat,
    busy,
    send: (question) => {
      if (!question.trim() || busy) return;

      void chat.sendMessage({ text: question.trim() });
    },
    open,
    setOpen: (next) => setOpen(inline || next),
    view,
    setView,
    supportFrom,
    setSupportFrom,
    layout,
    side,
    title,
    description,
    suggestions,
    support,
    text: { ...DEFAULT_CHAT_TEXT, ...words },
    icon: (name) => renderIcon(icons?.[name] ?? DEFAULT_CHAT_ICONS[name]),
    linkHref,
    markdown,
  };

  return <ChatPanelContext.Provider value={state}>{children}</ChatPanelContext.Provider>;
}

/** The button that opens a floating panel. Children replace its icon and words. */
export function ChatLauncher({ children }: { children?: React.ReactNode }) {
  const { open, setOpen, side, icon, text, title } = useChatPanel();

  if (open) return null;

  return (
    <div data-slot="chat-launcher" data-side={side}>
      <Button size="lg" onPress={() => setOpen(true)}>
        {children ?? (
          <>
            {icon('launcher')}
            {text.launcher || title}
          </>
        )}
      </Button>
    </div>
  );
}

/** The open panel, holding whatever parts it is given. */
export function ChatWindow({
  className,
  children,
}: {
  className?: string | undefined;
  children: React.ReactNode;
}) {
  const { open, layout, side, title } = useChatPanel();

  if (!open) return null;

  return (
    <section
      aria-label={title}
      data-slot="chat-panel"
      data-layout={layout}
      data-side={side}
      className={cn(
        'flex flex-col overflow-hidden border border-border bg-background text-foreground',
        layout === 'floating' && 'shadow-2xl',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The title, a line under it, the way to a person and the close button. Children go before them. */
export function ChatHeader({ children }: { children?: React.ReactNode }) {
  const {
    view,
    setView,
    setSupportFrom,
    setOpen,
    layout,
    title,
    description,
    support,
    text,
    icon,
  } = useChatPanel();

  return (
    <header
      data-slot="chat-header"
      className="flex items-start justify-between gap-3 border-b border-border px-4 py-3"
    >
      <div className="min-w-0">
        <div className="font-medium">{view === 'chat' ? title : text.supportTitle}</div>
        <div className="truncate text-xs text-muted-foreground">
          {view === 'chat' ? description : (support?.note ?? text.supportNote)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {support &&
          (view === 'chat' ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setSupportFrom('assistant');
                setView('support');
              }}
            >
              {icon('support')}
              {text.talkToPerson}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onPress={() => setView('chat')}>
              {text.backToAnswers}
            </Button>
          ))}
        {layout === 'floating' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={text.close}
            onPress={() => setOpen(false)}
          >
            {icon('close')}
          </Button>
        )}
      </div>
    </header>
  );
}

/**
 * The conversation, shown while the panel is not at the support form: the
 * messages and the box to ask in, unless it is given parts of its own.
 */
export function ChatConversation({ children }: { children?: React.ReactNode }) {
  const { view, support } = useChatPanel();

  if (view === 'support' && support) return null;

  return (
    <MessageScrollerProvider autoScroll>
      {children ?? (
        <>
          <ChatMessages />
          <ChatComposer />
        </>
      )}
    </MessageScrollerProvider>
  );
}

/** Questions a reader can send with one click. */
export function ChatSuggestions() {
  const { suggestions, send } = useChatPanel();

  if (suggestions.length === 0) return null;

  return (
    <div data-slot="chat-suggestions" className="flex flex-wrap justify-center gap-2">
      {suggestions.map((suggestion) => (
        <Button key={suggestion} variant="outline" size="sm" onPress={() => send(suggestion)}>
          {suggestion}
        </Button>
      ))}
    </div>
  );
}

/** What the panel shows before the first question. Children go below the suggestions. */
export function ChatEmpty({ children }: { children?: React.ReactNode }) {
  const { icon, text } = useChatPanel();

  return (
    <Empty data-slot="chat-empty" className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon('empty')}</EmptyMedia>
        <EmptyTitle>{text.emptyTitle}</EmptyTitle>
        <EmptyDescription>{text.emptyDescription}</EmptyDescription>
      </EmptyHeader>
      <ChatSuggestions />
      {children}
    </Empty>
  );
}

/**
 * Each question and answer, or `empty` before the first. `renderReply`
 * replaces how an answer renders; `<ChatReply>` is the default.
 */
export function ChatMessages({
  empty = <ChatEmpty />,
  renderReply = (message, streaming) => <ChatReply message={message} streaming={streaming} />,
}: {
  empty?: React.ReactNode;
  renderReply?: ((message: ChatMessage, streaming: boolean) => React.ReactNode) | undefined;
}) {
  const { chat, busy, text } = useChatPanel();
  const { messages, error } = chat;

  return (
    <div className="min-h-0 flex-1 px-4 py-3">
      {messages.length === 0 ? (
        empty
      ) : (
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent aria-busy={busy}>
              {messages.map((message) =>
                message.role === 'user' ? (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor>
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end" variant="muted">
                          <BubbleContent>{textOf(message)}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ) : (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    {renderReply(message, busy && message === messages.at(-1))}
                  </MessageScrollerItem>
                ),
              )}
              {error && <p className="text-sm text-destructive">{text.error}</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      )}
    </div>
  );
}

/** The box a reader asks in. Enter sends; Shift+Enter starts a new line. */
export function ChatComposer() {
  const { send, busy, text, icon } = useChatPanel();
  const [draft, setDraft] = React.useState('');
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      data-slot="chat-input"
      className="border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();

        if (busy || !draft.trim()) return;

        send(draft);
        setDraft('');
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={text.placeholder}
          aria-label={text.questionLabel}
          className="min-h-12"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            isDisabled={busy || !draft.trim()}
            className="ml-auto"
            aria-label={text.send}
          >
            {icon('send')}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/**
 * The assistant: suggestions, each answer with the steps it took and the pages
 * it used, and optionally a person to ask. The parts below compose it, and
 * `<ChatRoot>` with parts of your own builds any other.
 *
 * Sized and placed by CSS variables a site can set: `--chat-width`,
 * `--chat-height`, `--chat-inset` and `--chat-radius`. Colours are the site's
 * shadcn/ui tokens.
 */
export function ChatPanel({ className, ...props }: ChatPanelProps) {
  return (
    <ChatRoot {...props}>
      <ChatLauncher />
      <ChatWindow className={className}>
        <ChatHeader />
        <ChatConversation />
        <ChatSupport />
      </ChatWindow>
    </ChatRoot>
  );
}

/** One answer: the steps it took, the reply, then the pages it read. */
export function ChatReply({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const { text, linkHref, icon, markdown } = useChatPanel();

  const steps = message.parts.filter(
    (part) =>
      part.type === 'reasoning' ||
      part.type === 'tool-searchPages' ||
      part.type === 'tool-readPage',
  );

  const sources = message.parts.flatMap((part) =>
    part.type === 'tool-readPage' && part.state === 'output-available' && 'href' in part.output
      ? [part.output]
      : [],
  );

  const answer = textOf(message);

  return (
    <Message data-slot="chat-reply">
      <MessageContent>
        {steps.length > 0 && (
          <Trace>
            {steps.map((part, index) => (
              <Step key={index} part={part} streaming={streaming} />
            ))}
          </Trace>
        )}
        {answer && (
          <div
            data-slot="chat-answer"
            className="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          >
            <Markdown
              components={{
                // The site's own pages stay in the tab; anything else opens a new one.
                a: ({ href = '', children }) =>
                  href.startsWith('/') ? (
                    <a href={linkHref(href)}>{children}</a>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                ...markdown,
              }}
            >
              {answer}
            </Markdown>
          </div>
        )}
        {!streaming && sources.length > 0 && (
          <Trace data-slot="chat-sources">
            <TraceCollapsible>
              <TraceCollapsibleTrigger>
                <TraceLine>
                  <TraceIcon>{icon('sources')}</TraceIcon>
                  <TraceTitle>
                    {sources.length === 1
                      ? text.usedOne
                      : fill(text.usedMany, { count: sources.length })}
                  </TraceTitle>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {sources.map((source) => (
                    <li key={source.href}>
                      <a className="text-primary hover:underline" href={linkHref(source.href)}>
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          </Trace>
        )}
      </MessageContent>
    </Message>
  );
}

function Step({ part, streaming }: { part: Part; streaming: boolean }) {
  const { text, icon } = useChatPanel();

  if (part.type === 'reasoning') {
    return <Thinking reasoning={part.text} running={part.state === 'streaming'} />;
  }

  if (part.type !== 'tool-searchPages' && part.type !== 'tool-readPage') return null;

  const done = part.state === 'output-available';
  const running = !done && streaming;

  const title =
    part.type === 'tool-searchPages'
      ? fill(done ? text.searched : text.searching, { query: part.input?.query ?? '' })
      : done && 'title' in part.output
        ? fill(text.read, { title: part.output.title })
        : text.reading;

  return (
    <TraceLine status={running ? 'running' : part.state === 'output-error' ? 'error' : undefined}>
      <TraceIcon>{icon(part.type === 'tool-searchPages' ? 'search' : 'read')}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );
}

function Thinking({ reasoning, running }: { reasoning: string; running: boolean }) {
  const { text, icon } = useChatPanel();
  const [expanded, setExpanded] = React.useState<boolean>();

  if (!reasoning.trim()) return null;

  return (
    <TraceCollapsible isExpanded={expanded ?? running} onExpandedChange={setExpanded}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? 'running' : undefined}>
          <TraceIcon>{icon(running ? 'thinking' : 'thought')}</TraceIcon>
          <TraceTitle>{running ? text.thinking : text.thought}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{reasoning}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** The form to message a person, shown while the panel is at it. */
export function ChatSupport() {
  const { view, support, chat, supportFrom: from, setView, text, icon } = useChatPanel();
  const { messages } = chat;
  const [state, setState] = React.useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (view !== 'support' || !support) return null;

  const onDone = () => {
    setState('idle');
    setView('chat');
  };

  const lastQuestion = messages.filter((message) => message.role === 'user').at(-1);

  if (state === 'sent') {
    return (
      <Empty data-slot="chat-support-sent" className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon('sent')}</EmptyMedia>
          <EmptyTitle>{text.sentTitle}</EmptyTitle>
          <EmptyDescription>{text.sentDescription}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onPress={onDone}>
          {text.backToAnswers}
        </Button>
      </Empty>
    );
  }

  return (
    <form
      data-slot="chat-support"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
      onSubmit={async (event) => {
        event.preventDefault();

        const form = new FormData(event.currentTarget);

        setState('sending');

        const response = await fetch(support.api, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: form.get('email'),
            message: form.get('message'),
            page: location.pathname,
            from,
            // The conversation so far, so nobody has to ask the same question twice.
            transcript: form.get('transcript')
              ? messages.map((message) => ({ role: message.role, text: textOf(message) }))
              : [],
          }),
        }).catch(() => undefined);

        setState(response?.ok ? 'sent' : 'failed');
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="chat-support-email">{text.email}</FieldLabel>
          <Input id="chat-support-email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field>
          <FieldLabel htmlFor="chat-support-message">{text.message}</FieldLabel>
          <Textarea
            id="chat-support-message"
            name="message"
            required
            rows={6}
            defaultValue={lastQuestion ? textOf(lastQuestion) : ''}
          />
        </Field>
        {messages.length > 0 && (
          <Field orientation="horizontal">
            <Checkbox id="chat-support-transcript" name="transcript" value="yes" defaultSelected />
            <FieldLabel htmlFor="chat-support-transcript">{text.transcript}</FieldLabel>
          </Field>
        )}
        {state === 'failed' && <FieldError>{text.sendFailed}</FieldError>}
        <Button type="submit" isDisabled={state === 'sending'}>
          {state === 'sending' ? text.sending : text.sendMessage}
        </Button>
      </FieldGroup>
    </form>
  );
}

export default ChatPanel;
