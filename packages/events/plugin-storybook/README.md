# autocatalog-plugin-storybook

List a team's Storybook components on the company site.

```bash
npm install -D autocatalog-plugin-storybook
```

Turn on the component manifest in `.storybook/main.ts`:

```ts
const config: StorybookConfig = {
  // …
  features: { componentsManifest: true },
};
```

Build Storybook, write `autocatalog.components.json`, and commit it:

```bash
npx storybook build
npx ac from-storybook storybook-static --url https://storybook.acme.dev/checkout/
```

`--check` fails when the committed file does not match the build. Props come
from `react-docgen`, `react-docgen-typescript` or the component meta engine. A
build with `features.experimentalDocgenServer` can write stories with no props,
and the command says so. See the
[components guide](https://jagreehal.github.io/autocatalog/docs/components).
