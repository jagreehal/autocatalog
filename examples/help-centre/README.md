# help-centre

A help centre for an app's customers, built with autocatalog alone: each
account sees the guides for its plan, and an assistant answers from those
guides only.

```bash
npx autocatalog site .
node dist/server.mjs
```

Open `/getting-started/`, then pick an account at the top right.
Lakeview Shop has invoicing, so it sees the invoicing guide and gets a 403 on
the payments one; Riverside Studio sees both. The assistant needs
`AI_GATEWAY_API_KEY`, or another model in `site/chat.ts`.

| What it does                                       | Where                       |
| -------------------------------------------------- | --------------------------- |
| Who is reading                                     | `site/access.ts`            |
| The accounts, and what each one has                | `site/readers.ts`           |
| Signing in, the assistant's suggestions per reader | `site/middleware.ts`        |
| The account switcher in the header                 | `site/ReaderSwitcher.astro` |
| The assistant's model, and who it is talking to    | `site/chat.ts`              |
| A home page per account, the support endpoint      | `pages/`                    |
| Colours, radius, font and the panel's width        | `brand/theme.css`           |
| Who may open a guide: per folder, or in one guide  | `docs/meta.json`, `access:` |

autocatalog applies `access` everywhere: a guide this account may not open is a
403 that names it (`"denied": "teaser"`), and the sidebar, previous and next,
home page and assistant leave it out.

`"audience": "customers"` publishes only guides that name that audience, and
leaves out the catalog's own pages. `"pageActions": false` drops the Markdown
copy and pin.
