# Components

Four teams keep their components in different places, published as one list.
The tests and `pnpm verify:components` read these apps.

| App                          | Shows                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `checkout`                   | A real Storybook, owner from `CODEOWNERS`, an `ErrorBanner`                      |
| `design-system`              | A real Storybook, owner in the file, and a second `ErrorBanner`                  |
| `reports`                    | A real Storybook, no owner, nothing deployed, and a document with no frontmatter |
| `gallery`                    | No Storybook: a `gallery.json` of its own                                        |
| `autocatalog-plugin-gallery` | The plugin that reads it, and all it takes: one call to `writeComponents`        |

```bash
pnpm turbo run build --filter=autocatalog-cli... --filter=autocatalog-plugin-storybook...
pnpm verify:components            # in a temporary folder
pnpm verify:components ./work     # kept, to look at the site it built
```

After changing a component, write its file again:

```bash
cd examples/components/checkout
pnpm build-storybook
pnpm exec ac from-storybook storybook-static
```
