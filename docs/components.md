---
title: Components
owner: Maintainers
summary: List every team's UI components on the company site, from Storybook or any other tool.
tags:
  - guide
  - reference
related:
  - docs/federation
  - docs/site
  - docs/plugins
---

# Components

Each team keeps its components in the tool it already uses. The company site
lists every component, who owns it and which other teams built one of the same
name, and links into each team's tool. The components stay where they are.

A repository publishes by committing `autocatalog.components.json`. Anything can
write that file: a plugin, or your own script. The catalog reads the file and
knows nothing about the tool behind it.

## Publish from Storybook

Install the plugin, and turn on the component manifest in `.storybook/main.ts`.
Storybook leaves it off by default, and without it the site has stories but no
props or descriptions:

```bash
npm install -D autocatalog-plugin-storybook
```

```ts
const config: StorybookConfig = {
  // …
  features: { componentsManifest: true },
};
```

Build Storybook, then write the file and commit it:

```bash
npx storybook build
npx ac from-storybook storybook-static --url https://storybook.acme.dev/checkout/
```

Props come from whichever docgen engine the build used. A build with
`features.experimentalDocgenServer` can write stories with no props, and the
command says so.

`--url` says where the Storybook is deployed. Without it, the site lists the
component with no link to its stories. Later runs keep the address and owner
already committed, so a rebuild names neither. Nothing about the machine that
built it goes in the file.

Fail a pull request when the file no longer matches the components:

```bash
npx storybook build
npx ac from-storybook storybook-static --check
```

## Publish from anything else

[Write a plugin](/docs/plugins#publish-components), or write the file yourself.
`autocatalog-core/contracts/autocatalog.components.schema.json` describes it:

```json
{
  "viewer": { "name": "Gallery", "url": "https://gallery.acme.dev/" },
  "owner": "Mobile",
  "components": [
    {
      "id": "receipt-card",
      "name": "ReceiptCard",
      "description": "The receipt in the mobile app.",
      "props": [],
      "stories": [{ "id": "receipt-card--paid", "name": "paid", "link": "#receipt-card/paid" }]
    }
  ]
}
```

`viewer.name` labels the links, and each story's `link` joins onto `viewer.url`.

## Owners

`owner` names one team for every component in the file. Without it, `CODEOWNERS`
names each component's owner from its `source` file. `ac from-storybook --owner`
sets `owner`.

## How components compose

A component is a resource in the graph, as an event is, so what reads the graph
reads components:

- `/catalog.json` carries them, and [`--index`](/docs/federation) joins them into
  another site.
- `/owners` lists them under their team, and the catalog explorer finds them.
- A [lock](/docs/federation) pins them with the rest of the repository, and a tag
  moves them. Each package in a monorepo can publish a file of its own.

## What the site shows

- `/components` lists each component with its repository, owner and story count,
  and marks a name that more than one repository publishes.
- `/components/<repository>/<id>/` has the import line, props and stories, with
  a link to each in the team's tool.
- `/components/<repository>/<id>.md` is the same for agents. `llms.txt` lists
  every component and `llms-full.txt` includes each one.

A repository whose documents are all invalid still publishes its components: the
documents are left out by name.

The site compares whole names across repositories. Two components of one name can
do different things, so the mark says where to look.

## A worked example

[`examples/components`](https://github.com/jagreehal/autocatalog/tree/main/examples/components)
has three Storybook teams and one team with a format of its own, read by a plugin
in the example. `pnpm verify:components` publishes them as one site.
