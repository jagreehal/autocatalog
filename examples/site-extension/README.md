# site-extension

A site that `ac site` builds, extended with its own code and nothing installed:
staff-only pages behind a cookie, hidden from everyone else's sidebar, a
replaced footer and a rehype plugin, rendered per request. `brand/` and
`autocatalog.site.json` white-label it: logos for both themes, a PNG favicon,
its own font and tokens in `theme.css`, files in `brand/public/`, header links,
head tags, the interface's words and sections in the header.

```bash
npx autocatalog site .
node dist/server.mjs
```

Its Playwright stories drive the server build on a desktop and a phone:

```bash
pnpm --filter @autocatalog-example/site-extension test:e2e
```

Open `/site-extension/guide/`, then `/site-extension/staff/` (403), then
`/site-extension/staff/?staff`.
