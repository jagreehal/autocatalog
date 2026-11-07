import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { expect, it } from 'vitest';
import {
  type ChatPage,
  type ChatTurn,
  createChat,
  pagesSource,
  plainText,
  rankPages,
  searchPages,
} from '../src/index';

const pages: ChatPage[] = [
  {
    title: 'Authentication',
    href: '/api/authentication/',
    text: 'Send your API key as a bearer token.',
  },
  {
    title: 'Payments',
    href: '/api/payments/',
    text: 'Create a payment to a beneficiary in any currency.',
  },
];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const call = (toolCallId: string, toolName: string, input: Record<string, string>) => ({
  type: 'tool-call' as const,
  toolCallId,
  toolName,
  input: JSON.stringify(input),
});

const step = (...parts: LanguageModelV4StreamPart[]) => ({
  stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
    ...parts,
    {
      type: 'finish',
      usage,
      finishReason: {
        unified: parts.some((part) => part.type === 'tool-call') ? 'tool-calls' : 'stop',
        raw: undefined,
      },
    },
  ]),
});

const answer = (text: string) =>
  step(
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
  );

const ask = (question: string) =>
  new Request('http://site/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      id: 'c1',
      path: '/api/',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: question }] }],
    }),
  });

it('answers from the pages it searched and read, and only those the reader can open', async () => {
  const turns: ChatTurn[] = [];

  const model = new MockLanguageModelV4({
    doStream: [
      step(call('1', 'searchPages', { query: 'bearer token' })),
      step(
        call('2', 'readPage', { href: '/api/authentication' }),
        call('3', 'readPage', { href: '/internal/runbook/' }),
      ),
      answer('Send it as a [bearer token](/api/authentication/).'),
    ],
  });

  const chat = createChat({
    model,
    subject: 'the Acme API',
    onAnswered: (turn) => turns.push(turn),
  });

  const response = await chat.respond(ask('How do I authenticate?'), {
    source: pagesSource(pages),
    context: 'The reader is a developer.',
  });

  const stream = await response.text();

  expect(stream).toContain('bearer token](/api/authentication/)');
  expect(stream).toContain('No such page');
  expect(turns).toEqual([
    expect.objectContaining({
      question: 'How do I authenticate?',
      path: '/api/',
      searches: ['bearer token'],
      read: ['/api/authentication/'],
      answered: true,
    }),
  ]);

  const system = JSON.stringify(model.doStreamCalls[0]!.prompt[0]);

  expect(system).toContain('the Acme API');
  expect(system).toContain('The reader is a developer.');
});

it('says what is missing when the pages do not answer', async () => {
  const turns: ChatTurn[] = [];

  const model = new MockLanguageModelV4({
    doStream: [
      step(call('1', 'searchPages', { query: 'refund' })),
      step(call('2', 'reportGap', { topic: 'Refunding a payment' })),
      answer('The pages do not cover refunds.'),
    ],
  });

  await (
    await createChat({ model, subject: 'x', onAnswered: (turn) => turns.push(turn) }).respond(
      ask('How do I refund?'),
      { source: pagesSource(pages) },
    )
  ).text();

  expect(turns[0]).toMatchObject({ answered: false, gap: 'Refunding a payment', read: [] });
});

it('refuses a request that carries no conversation', async () => {
  const chat = createChat({ model: new MockLanguageModelV4(), subject: 'x' });

  const response = await chat.respond(
    new Request('http://site/api/chat', { method: 'POST', body: '{"messages":[]}' }),
    { source: pagesSource(pages) },
  );

  expect(response.status).toBe(400);
});

it('answers on its last step, which can only report a gap', async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      step(call('1', 'searchPages', { query: 'dolby' })),
      step(call('2', 'searchPages', { query: 'atmos' })),
      answer('Nothing here covers Dolby Atmos.'),
    ],
  });

  const response = await createChat({ model, subject: 'Acme', maxSteps: 3 }).respond(
    ask('Dolby Atmos?'),
    { source: pagesSource(pages) },
  );

  expect(await response.text()).toContain('Nothing here covers Dolby Atmos.');
  expect(model.doStreamCalls.map((call) => call.tools?.map((tool) => tool.name))).toEqual([
    ['searchPages', 'readPage', 'reportGap'],
    ['searchPages', 'readPage', 'reportGap'],
    ['reportGap'],
  ]);
  expect(JSON.stringify(model.doStreamCalls[2]!.prompt.at(-1))).toContain('cannot search');
});

it('replies after a gap reported on its last step, with no tools at all', async () => {
  const turns: ChatTurn[] = [];

  const model = new MockLanguageModelV4({
    doStream: [
      step(call('1', 'searchPages', { query: 'dolby' })),
      step(call('2', 'reportGap', { topic: 'Dolby Atmos' })),
      answer('The pages do not cover Dolby Atmos.'),
    ],
  });

  const response = await createChat({
    model,
    subject: 'Acme',
    maxSteps: 2,
    onAnswered: (turn) => turns.push(turn),
  }).respond(ask('Dolby Atmos?'), { source: pagesSource(pages) });

  expect(await response.text()).toContain('The pages do not cover Dolby Atmos.');
  expect(model.doStreamCalls.map((call) => call.toolChoice?.type)).toEqual([
    'auto',
    'auto',
    'none',
  ]);
  expect(turns).toEqual([expect.objectContaining({ gap: 'Dolby Atmos', answered: false })]);
});

it('finds a page only when every word of the query is on it, title first', () => {
  expect(searchPages(pages, 'payment currency').map((found) => found.href)).toEqual([
    '/api/payments/',
  ]);
  expect(searchPages(pages, 'refund payment')).toEqual([]);
  expect(searchPages(pages, 'a an')).toEqual([]);
  expect(searchPages(pages, 'How do I send a bearer token?').map((found) => found.href)).toEqual([
    '/api/authentication/',
  ]);
});

it('ranks pages with more of the words first, and finds one with any of them', () => {
  expect(rankPages(pages, 'how do I refund a payment').map((found) => found.href)).toEqual([
    '/api/payments/',
  ]);
  expect(rankPages(pages, 'bearer payment currency').map((found) => found.href)).toEqual([
    '/api/payments/',
    '/api/authentication/',
  ]);
  expect(rankPages(pages, 'how what')).toEqual([]);
});

it('lists a page by its summary, or by its words without markup', () => {
  const results = rankPages(
    [
      { title: 'Payees', href: '/payees/', text: '<p>Long body</p>', summary: 'Who you pay.' },
      {
        title: 'Payee files',
        href: '/payee-files/',
        text: `<div class="article"><h2>**Payee** files</h2><p>See [the upload](/upload/) &amp; check &#x2019;em. ${'More words. '.repeat(20)}</p></div>`,
      },
    ],
    'payee',
  );

  const summarised = results.find((found) => found.href === '/payees/');
  const plain = results.find((found) => found.href === '/payee-files/');

  expect(summarised?.excerpt).toBe('Who you pay.');
  expect(plain?.excerpt).toMatch(/^Payee files See the upload & check ’em\. More words\./);
  expect(plain?.excerpt).toMatch(/words\.…$/);
  expect(plain?.excerpt.length).toBeLessThanOrEqual(161);
});

it('keeps a bare < and links with brackets in their address', () => {
  expect(plainText('Retry if count < 3.\n\n> Note: wait')).toBe('Retry if count < 3. Note: wait');
  expect(
    plainText('See [Foo](https://w.org/Foo_(bar)) and __bold__ or _this_ in snake_case.'),
  ).toBe('See Foo and bold or this in snake_case.');
});

it('reads Markdown and HTML as a reader sees them', () => {
  expect(plainText('## Set up\n\n- Open **Settings** and `run`\n> note &#99999999; &bogus;')).toBe(
    'Set up Open Settings and run note &#99999999; &bogus;',
  );
});

it('takes its own instructions and tool descriptions', async () => {
  const model = new MockLanguageModelV4({ doStream: [answer('Hi.')] });

  await (
    await createChat({
      model,
      subject: 'Acme',
      system: (defaults) => defaults.replace('plain, short steps', 'one sentence'),
      instructions: 'Answer in French.',
      tools: { searchPages: 'Look things up.' },
    }).respond(ask('Bonjour'), { source: pagesSource(pages) })
  ).text();

  const [call] = model.doStreamCalls;
  const system = JSON.stringify(call!.prompt[0]);

  expect(system).toContain('one sentence');
  expect(system).not.toContain('plain, short steps');
  expect(system).toContain('Answer in French.');
  expect(JSON.stringify(call!.tools)).toContain('Look things up.');
});
