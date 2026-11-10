# autocatalog-chatbot

## 0.1.1

### Patch Changes

- ac55524: A public site gives each OpenAPI reference Scalar's full layout below the site's header, with its own sidebar, search and request client. With one API, **API reference** opens it directly, and a site with guides and an API gets **Documentation** and **API reference** in the header. `"apiReference": "embedded"` keeps the reference inside the site's navigation.

  A site with `"output": "server"` serves an MCP endpoint at `/mcp`. Agents connect by URL and get `search_docs`, `list_pages` and `read_page` over the pages, and `list_operations` and `get_operation` over each API, with the API it belongs to and the auth, servers and schemas it needs. It follows `access`, `llms.txt` names it, and Scalar's Connect MCP button installs it. `"mcp": false` leaves it out. Markdown copies, `llms.txt` and `llms-full.txt` render per request on a server site, behind the site's own gate.

  Scalar takes the site's colours, font and corners, and a `theme.css` copied from a shadcn app works as it is. Page actions sit in a light row with dividers, and Copy shows a tick when it copies.

  `autocatalog-mcp` adds `list_documents`. `read_document` takes a source without `.md` or a repository and names the closest pages when it misses. Both MCP servers tell a client which tool to call first.

  A server site resolves the packages its own package.json names from its project, and everything else from autocatalog's.

- 8258ffd: Flows draw as EventStorming boards: stages, actors, commands, policies, read models, tracks and Given, When, Then scenarios, with a hotspot for each failure that has no policy. `ac flows draft` drafts a flow from an Effect v4 program, and `<Storm>` and `<Sticky>` work in MDX.

  `/services/` lists every service with its owner, APIs, events and calls, from events, OpenAPI specs or both. CODEOWNERS sets the owner of services, endpoints, gateways and repositories.

  Each API's Scalar reference opens in a frame beside the site's navigation, in its theme, with the reader's place in the address. The sidebar link reads "Scalar" unless you set `apiReferenceLabel`.

  A rail holds the site's sections, from `nav` with an optional `icon`, and the sidebar shows the current section under its name. Page changes fade, and a change of section slides the sidebar. The sidebar draws repositories as headings, folders with folder icons and pages with their kind's icon.

  Sites use grey neutrals, Inter for text and JetBrains Mono for code. The home page opens with count cards, chosen by `homeCounts`, and the architecture map. Maps size to their graph, a flow's walkthrough starts from a button above its map, filters keep text typed while the page loads, and asking a person for help works before the assistant has loaded.

  On Sätteri, Astro's default Markdown processor, Mermaid diagrams, `[[kind|id]]` links, a document's repeated title and scrollable tables work as they do on unified.

## 0.1.0

### Minor Changes

- ab0b648: Build branded public sites, help centres and an assistant from `autocatalog.site.json`.

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
