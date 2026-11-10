// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ChatConversation,
  ChatMessages,
  ChatPanel,
  ChatRoot,
  ChatSuggestions,
  ChatWindow,
  useChatPanel,
} from '../src/react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('opens, and sends a suggestion to the site with the page it was asked on', async () => {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response('', { status: 500 }),
  );

  vi.stubGlobal('fetch', fetch);

  render(<ChatPanel api="/api/chat" title="Ask Acme" suggestions={['How do I authenticate?']} />);

  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Ask Acme' })));
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'How do I authenticate?' })),
  );

  expect(screen.getByRole('region', { name: 'Ask Acme' })).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith('/api/chat', expect.anything());

  const [, init] = fetch.mock.calls[0]!;

  const body = JSON.parse(String(init?.body));

  expect(body.path).toBe('/');
  expect(body.messages.at(-1).parts[0].text).toBe('How do I authenticate?');
});

it('takes its words, icons and layout from the site', async () => {
  render(
    <ChatPanel
      api="/api/chat"
      title="Help"
      layout="inline"
      text={{ emptyTitle: 'Ask us anything', placeholder: 'Type here', send: 'Go' }}
      icons={{ send: '<svg viewBox="0 0 1 1"></svg>', empty: <i data-testid="empty-icon" /> }}
      className="my-panel"
    />,
  );

  const panel = await screen.findByRole('region', { name: 'Help' });

  expect(panel.dataset.layout).toBe('inline');
  expect(panel.className).toContain('my-panel');
  expect(screen.getByText('Ask us anything')).toBeTruthy();
  expect(screen.getByPlaceholderText('Type here')).toBeTruthy();
  expect(screen.getByTestId('empty-icon')).toBeTruthy();
  // Inline, it is always open: no launcher and nothing to close.
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Go' })
      .querySelector<HTMLElement>('[data-slot="chat-icon"]')
      ?.style.getPropertyValue('--chat-icon'),
  ).toContain('data:image/svg+xml');
});

it('composes from its parts and a part of the site’s own', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  );

  function AskedCount() {
    const { chat } = useChatPanel();

    return <p>{`${chat.messages.length} messages`}</p>;
  }

  render(
    <ChatRoot api="/api/chat" title="Help" layout="inline" suggestions={['Refunds?']}>
      <ChatWindow>
        <AskedCount />
        <ChatConversation>
          <ChatMessages empty={<ChatSuggestions />} />
        </ChatConversation>
      </ChatWindow>
    </ChatRoot>,
  );

  expect(await screen.findByText('0 messages')).toBeTruthy();
  // Its own empty state, and no composer: only the parts it was given.
  expect(screen.queryByRole('textbox')).toBeNull();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refunds?' })));

  expect(screen.getByText('1 messages')).toBeTruthy();
});

it('opens at the support form for a reader who asked before it loaded', async () => {
  document.documentElement.dataset.acSupport = '';

  render(<ChatPanel api="/api/chat" title="Ask Acme" support={{ api: '/api/support' }} />);

  expect(await screen.findByText('Message a person')).toBeTruthy();
  expect(document.documentElement.dataset.acSupport).toBeUndefined();
});
