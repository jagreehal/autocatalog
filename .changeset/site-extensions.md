---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-core': patch
'autocatalog-chatbot': minor
---

Build branded public sites, help centres and an assistant from `autocatalog.site.json`.

- `extend` adds your middleware, component overrides, CSS, head tags, Markdown plugins, Starlight plugins and Astro integrations. `pages` adds your own pages and API routes, and a page at a built-in address replaces that page. `"output": "server"` renders pages per request and writes `server.mjs`, carrying the catalog it was built from so `dist/` deploys on its own.
- White-label without code: `social`, `head` and `strings` (the interface's words), `nav` for sections in the header and phone menu, a `favicon.ico` or `favicon.png`, and `brand/public/` served as it is, with the fonts and images `theme.css` uses bundled.
- `"audience": "public"` publishes the guides that name that audience and each OpenAPI reference with Scalar, leaving out `x-internal` paths, operations, webhooks and callbacks, with the tags and components only they use. Owners, events, services and the graph stay on the internal site, and `llms.txt` links each API's `openapi.json`.
- `access` names a module that says who is reading. A guide opens when the reader holds everything its `access:` lists, set per guide or per folder in `docs/meta.json`, or as your `canRead` decides. Pages, the sidebar, previous and next, the home and kind pages, search, Markdown twins, `llms.txt` and the assistant all follow it, and pages built ahead list only what a signed-out reader may open. A closed guide answers with a 404, or with `"denied": "teaser"` its title and a 403. Sample `readers` give the build a table of who opens what, link warnings, and a View as menu in `ac site --dev`.
- A server site searches on the server, ranking pages with more of the query's words first. Results show each page's summary or its opening words, a count and the matched words in bold, and offer the assistant when nothing matches. `autocatalog-docs-astro/search` exports `searchSite()` and `SearchPage` for a search page of your own.
- `chat` adds an assistant from the new `autocatalog-chatbot` package, built on the AI SDK and shadcn/ui. It answers from the pages the reader may open, links what it used and reports gaps. You set its prompts, words, icons, layout and size, and middleware can change it per reader through `locals.chat`. Every answer ends in a reply: its last step can only report a gap, and the reply follows. Its panel is parts you can compose, from `ChatRoot` to `useChatPanel()`, and `chat.panel` names a component of your own built from them.
- `"repo"` names a single repository, and `"atRoot": true` publishes its documents at the site's root while ids keep the name.
- `docs/meta.json` sets `audience` and `access` per folder, nested folders included, and labels nested sidebar groups.
- The access module's `onDenied` is told each refusal, `locals.denied` names the document, and the assistant's `onAsked` and `onAnswered` get the request. A site's own page replaces the built-in search, no-access, 404 and chat routes, and the site's own dependencies load from its `node_modules`.
- `url` sets where the site is deployed, for the sitemap and `llms.txt`. A page's summary is left out under its title when the page opens with the same words, a header with sections keeps room for the search box and scrolls the sections past it, and a page without a sidebar has no sidebar toggle.
- `ac site --dev` serves each project from its own folder, in the foreground.
- `"pageActions": false` drops the Markdown copy and pin. `docsCatalog()`, `docHref()` and `loadSiteAccess()` serve your own pages and config.
- A repository whose `docs/meta.json` is not valid has its documents left out until it is fixed. OpenAPI webhook schemas resolve their `$ref`s on their own.
