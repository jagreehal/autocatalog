/** @jsxImportSource react */
// The assistant's panel, composed from its parts: the default ones, with a way
// to the search page under the suggestions.
import {
  ChatComposer,
  ChatConversation,
  ChatEmpty,
  ChatHeader,
  ChatLauncher,
  ChatMessages,
  type ChatPanelProps,
  ChatRoot,
  ChatSupport,
  ChatWindow,
} from 'autocatalog-docs-astro/chat';

const search = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}search`;

export default function HelpChat({ className, ...props }: ChatPanelProps) {
  return (
    <ChatRoot {...props}>
      <ChatLauncher />
      <ChatWindow className={className}>
        <ChatHeader />
        <ChatConversation>
          <ChatMessages
            empty={
              <ChatEmpty>
                <a href={search}>Or search the guides</a>
              </ChatEmpty>
            }
          />
          <ChatComposer />
        </ChatConversation>
        <ChatSupport />
      </ChatWindow>
    </ChatRoot>
  );
}
