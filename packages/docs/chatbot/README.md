# autocatalog-chatbot

An assistant for a docs site. It answers only from the pages a reader can open:
it searches them, reads the ones that fit, links what it used, and says so when
nothing covers the question instead of answering from what the model knows.
Built on the [AI SDK](https://ai-sdk.dev) and [shadcn/ui](https://ui.shadcn.com).

`ac site` adds it to a site with `chat` in `autocatalog.site.json`; see
[the site docs](https://jagreehal.github.io/autocatalog/docs/site#an-assistant).
This page is for using it in a site of your own.

## The endpoint

```ts
// src/pages/api/chat.ts in an Astro site; any server that takes a Request works.
import type { APIRoute } from 'astro';
import { createChat, pagesSource } from 'autocatalog-chatbot';

const chat = createChat({
  model: 'anthropic/claude-haiku-5.5', // any AI SDK model
  subject: 'the Acme Payments API',
});

export const POST: APIRoute = async ({ request, locals }) =>
  chat.respond(request, {
    // The pages this reader may open, per request.
    source: pagesSource(await pagesFor(locals.user)),
    context: `The reader is signed in as ${locals.user.name}.`,
  });
```

A source is two functions, so it can follow any access rule:

```ts
const source: ChatSource = {
  search: (query) => searchIndex(query, user), // [{ title, href, excerpt }]
  read: (href) => pageAt(href, user), // { title, href, text }, or undefined
};
```

`pagesSource(pages)` is a ready source over pages in memory. A search finds a
page only when every word is on it, so a question nothing covers comes back
empty and is reported as a gap. Words such as "how" or "what" are left out.
For a search box, `rankPages(pages, query)` finds pages with any of the words,
those with more of them first.

| Option         | What it does                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| `model`        | Any AI SDK model, or a model id the AI Gateway serves                                      |
| `subject`      | What the pages are about, as the instructions name it                                      |
| `system`       | A string in place of the instructions, or a function given `defaultInstructions(subject)`  |
| `instructions` | Lines added after them                                                                     |
| `tools`        | What the model is told `searchPages`, `readPage` or `reportGap` does                       |
| `maxSteps`     | Searches and reads per answer, 5 by default; a gap on the last gets one more call to reply |
| `history`      | Messages of the conversation sent each time, 20 by default                                 |
| `headers`      | Headers per model call, by conversation, for a provider that wants a session               |
| `onAsked`      | Told each question and the page it was asked on                                            |
| `onAnswered`   | Told what it searched, what it read, whether it answered, and the gap it reported          |

`onAnswered` is how you find the pages to write: a turn with `answered: false`
names the gap.

## The panel

```tsx
import { ChatPanel } from 'autocatalog-chatbot/react';

<ChatPanel
  api="/api/chat"
  title="Ask Acme"
  description="Answers from these guides."
  suggestions={['How do I authenticate?']}
/>;
```

In Astro, render it with `client:only="react"`. Import the styles into your
Tailwind entry, after shadcn/ui's, so its classes are generated:

```css
@import 'autocatalog-chatbot/styles.css';
```

It is drawn with your shadcn/ui tokens, so it already looks like your site.

| Prop          | What it does                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| `text`        | Any of its words, by name; see `DEFAULT_CHAT_TEXT`                            |
| `icons`       | Any of its icons, by name: a React node, or an SVG's URL or markup            |
| `layout`      | `floating` (a button that opens it) or `inline` (always open, where it sits)  |
| `side`        | `right` or `left`, for a floating panel                                       |
| `defaultOpen` | Start a floating panel open                                                   |
| `className`   | Added to the panel                                                            |
| `markdown`    | react-markdown components, element by element, for answers                    |
| `support`     | `{ api }`: a form to message a person, posting the conversation as JSON       |
| `linkHref`    | How a link to one of your pages in an answer is written, such as with `?ref=` |
| `storageKey`  | Where the conversation is kept for the tab                                    |

A string in `text` can name `{query}`, `{title}` or `{count}` where the default
does. An icon given as a string is drawn in the text colour, so it follows the
theme. Icons are `launcher`, `empty`, `send`, `close`, `support`, `search`,
`read`, `sources`, `thinking`, `thought` and `sent`.

Size and place it with CSS variables:

```css
:root {
  --chat-width: 32rem;
  --chat-height: 48rem;
  --chat-inset: 1.5rem;
  --chat-radius: 1rem;
}
```

Each part has a `data-slot` for anything else: `chat-launcher`, `chat-panel`,
`chat-header`, `chat-empty`, `chat-suggestions`, `chat-reply`, `chat-answer`,
`chat-sources`, `chat-input` and `chat-support`.

Open it from anywhere on the page:

```ts
window.dispatchEvent(new CustomEvent('autocatalog:ask', { detail: 'How do I refund?' }));
window.dispatchEvent(new Event('autocatalog:support'));
```

## Compose your own

`ChatPanel` is these parts, put together. Use them to build the panel you want:
leave a part out, reorder them, or write one of your own on `useChatPanel()`.

```tsx
import {
  ChatComposer,
  ChatConversation,
  ChatEmpty,
  ChatHeader,
  ChatLauncher,
  ChatMessages,
  ChatRoot,
  ChatSupport,
  ChatWindow,
  useChatPanel,
} from 'autocatalog-chatbot/react';

function Asked() {
  const { chat } = useChatPanel();

  return <p>{chat.messages.length} messages</p>;
}

<ChatRoot api="/api/chat" title="Ask Acme" support={{ api: '/api/support' }}>
  <ChatLauncher />
  <ChatWindow>
    <ChatHeader>
      <Asked />
    </ChatHeader>
    <ChatConversation>
      <ChatMessages empty={<ChatEmpty>Or browse the guides.</ChatEmpty>} />
      <ChatComposer />
    </ChatConversation>
    <ChatSupport />
  </ChatWindow>
</ChatRoot>;
```

| Part               | What it is                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| `ChatRoot`         | The state every part reads. It takes `ChatPanelProps`, less `className`              |
| `ChatLauncher`     | The button that opens a floating panel; children replace its icon and words          |
| `ChatWindow`       | The open panel                                                                       |
| `ChatHeader`       | Title, description, the way to a person, close; children go before the buttons       |
| `ChatConversation` | The conversation, hidden at the support form; `ChatMessages` and `ChatComposer`      |
| `ChatMessages`     | Each question and answer; `empty` before the first, `renderReply` for each answer    |
| `ChatEmpty`        | The first view: icon, words and `ChatSuggestions`; children go below                 |
| `ChatReply`        | One answer, with the steps it took and the pages it used                             |
| `ChatComposer`     | The box to ask in                                                                    |
| `ChatSupport`      | The form to message a person, shown when the reader asks for one                     |
| `useChatPanel()`   | The AI SDK chat, `send`, `open`, `view`, the words and icons, for a part of your own |
