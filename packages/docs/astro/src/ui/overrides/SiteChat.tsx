/** @jsxImportSource react */
import type { ChatPanelProps } from 'autocatalog-chatbot/react';
import Panel from 'virtual:autocatalog-chat-panel';

/**
 * The assistant's panel as one of this package's islands: the site's own
 * component from `chat.panel`, or the default one. A site hydrates it from
 * here and never has to install autocatalog-chatbot itself.
 */
export function SiteChat(props: ChatPanelProps) {
  return <Panel {...props} />;
}
