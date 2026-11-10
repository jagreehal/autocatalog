import type { Plugin } from 'vite';

const PANEL = 'virtual:autocatalog-chat-panel';

/**
 * The assistant's panel module as a site with no `chat.panel` of its own gets
 * it, for Storybook and the story tests, which run outside a site's build.
 */
export function defaultChatPanel(): Plugin {
  return {
    name: 'autocatalog-default-chat-panel',
    resolveId: (id) => (id === PANEL ? `\0${PANEL}` : undefined),
    load: (id) =>
      id === `\0${PANEL}`
        ? `export { ChatPanel as default } from 'autocatalog-chatbot/react';`
        : undefined,
  };
}
