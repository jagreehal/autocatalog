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

// Each Markdown page in a site's --pages folder, by route. See own-pages.ts.
declare module 'virtual:autocatalog-docs-own-markdown' {
  const pages: Record<string, () => Promise<import('astro').MarkdownInstance<{ title: string }>>>;
  export default pages;
}
