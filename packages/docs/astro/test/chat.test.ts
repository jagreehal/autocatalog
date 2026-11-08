import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { chatIcons, chatText } from '../src/chat';
import { builtSettings } from '../src/index';

it('refuses a word the panel does not show, and names the ones it does', () => {
  expect(chatText({ placeholder: 'Ask' })).toEqual({ placeholder: 'Ask' });
  expect(() => chatText({ placehloder: 'Ask' })).toThrow(
    /chat\.text: no placehloder\..*placeholder/,
  );
});

it('reads an icon file into the page, keeps a URL, and refuses an unknown icon', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-chat-'));
  const file = path.join(dir, 'chat.svg');

  try {
    await fs.writeFile(file, '<svg/>');

    expect(chatIcons({ launcher: pathToFileURL(file).href, send: '/send.svg' })).toEqual({
      launcher: '<svg/>',
      send: '/send.svg',
    });
    expect(() => chatIcons({ rocket: '/r.svg' })).toThrow(/chat\.icons: no rocket\..*launcher/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("writes the site's settings into a build, and leaves the dev server's signals live", () => {
  expect(
    builtSettings({
      AUTOCATALOG_DOCS_ROOT: '/repos',
      AUTOCATALOG_SITE_AUDIENCE: 'public',
      AUTOCATALOG_EVENTCATALOG: '/ec.json',
      AUTOCATALOG_DESIGNS_CHANGED_AT: '1',
      HOME: '/home',
    }),
  ).toEqual({
    'process.env.AUTOCATALOG_DOCS_ROOT': '"/repos"',
    'process.env.AUTOCATALOG_SITE_AUDIENCE': '"public"',
    'process.env.AUTOCATALOG_EVENTCATALOG': '"/ec.json"',
  });
});
