// What Astro and Starlight declare for a project, for a plugin that is not
// one: import.meta.env, astro:content, .astro imports and locals.starlightRoute.
/// <reference types="astro/client" />
/// <reference types="@astrojs/starlight" />

// Astro 7's client types no longer declare .astro imports; the component tests
// import them directly to render in a container.
declare module '*.astro' {
  const Component: import('astro/runtime/server/index.js').AstroComponentFactory;
  export default Component;
}

// A server build's catalog, serialized by `catalogSnapshot`. See catalog.ts.
interface ImportMetaEnv {
  readonly AUTOCATALOG_CATALOG?: string;
  /** The repository a site publishes at its root. See ui/lib/docs.ts. */
  readonly AUTOCATALOG_DOCS_ROOT_REPO?: string;
}

// Each Markdown page in a site's --pages folder, by route. See own-pages.ts.
declare module 'virtual:autocatalog-docs-own-markdown' {
  const pages: Record<string, () => Promise<import('astro').MarkdownInstance<{ title: string }>>>;
  export default pages;
}

// The assistant's model and the pages it answers from, fixed at build time. See chat.ts.
declare module 'virtual:autocatalog-chat' {
  export const options: import('./chat').SiteChatOptions;
  export const pages: import('autocatalog-chatbot').ChatPage[];
}

// What a site's middleware can set for the page being rendered.
declare namespace App {
  interface Locals {
    /** The assistant's panel for this reader, over what autocatalog.site.json set. */
    chat?: Partial<import('autocatalog-chatbot/react').ChatPanelProps>;
    /**
     * Whether this reader may open a document, on a site with `access`. Declare
     * `reader` here in your own project as your `access.reader` returns it.
     */
    canRead?: (doc: { id: string }) => boolean;
    /** In `ac site dev`, the sample readers to view the site as, and which one it is. */
    viewAs?: { names: string[]; current: string | undefined };
    /** The closed document a `teaser` names. */
    denied?: { id: string; title: string; description?: string | undefined };
  }
}

// The assistant's panel, with its icon files read at build time.
declare module 'virtual:autocatalog-docs-build' {
  /** The assistant's panel, or null for a site without one. */
  export const chatPanel: import('autocatalog-chatbot/react').ChatPanelProps | null;
  /** Documents render per request (`output: 'server'`), so none has a copy built ahead. */
  export const documentsPerRequest: boolean;
}

// The assistant's panel: the site's `chat.panel` component, or the default. See index.ts.
declare module 'virtual:autocatalog-chat-panel' {
  const Panel: import('react').ComponentType<import('autocatalog-chatbot/react').ChatPanelProps>;
  export default Panel;
}

// The site's `access` module, and what a closed document answers with. See access.ts.
declare module 'virtual:autocatalog-access' {
  export const access: import('./access').SiteAccess<unknown>;
  export const denied: 'hide' | 'teaser';
}

// The site's header links, from `nav`. See index.ts.
declare module 'virtual:autocatalog-docs-blocks' {
  const blocks: Record<string, import('astro/runtime/server/index.js').AstroComponentFactory>;
  export default blocks;
}

declare module 'virtual:autocatalog-docs-nav' {
  const links: import('autocatalog-docs-core').SiteNavLink[];
  export default links;
}
