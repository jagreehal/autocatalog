---
title: Writing a plugin
owner: Maintainers
summary: Teach ac scan and ac drift to read events from a format of your own.
tags:
  - plugins
related:
  - docs/cli
  - docs/events/zod
---

A plugin is an npm package that teaches autocatalog a new format: a company
contract format, a registry export, a framework's decorators, a component tool.
Install it next to autocatalog, and `ac scan` and `ac drift` read your events the
way they read JSON Schema, into the same catalog, site and breaking-change gate.
A plugin can also [publish components](#publish-components).

EventCatalog has plugins too, and its generators write into the catalog. A plugin
here returns what it found and writes nothing, so `ac drift` can run it on two
commits and compare.

`autocatalog-plugin-zod` is one. Yours works the same way.

## You may not need one

If your team already keeps its events in a file of its own, describe that file
instead of writing code. Add `sources` to
`contracts/autocatalog.conventions.json`:

```json
{
  "$schema": "https://unpkg.com/autocatalog-docs-core/contracts/autocatalog.conventions.schema.json",
  "sources": [
    {
      "kind": "event",
      "files": ["packages/sdk/event-schemas.json"],
      "match": ["v{version}.{id}", "v{version}/{id}"],
      "domain": "payments",
      "meta": { "owner": { "team": "payments" }, "producers": ["payments-api"] }
    }
  ]
}
```

- `files` lists JSON files in the repository. Each is one object with an event
  per key and that event's JSON Schema as the value.
- `match` says how a key names an event, and the first pattern that fits wins.
  `{id}` is required. Without `{version}`, the event is `0.1.0` and marked for
  review. Everything else is plain text, not a regular expression.
- `domain` is the domain of every event in those files.
- `meta` holds what the files cannot say, for all their events. It takes the
  fields of an [`x-autocatalog` block](/docs/events/json-schema#embedding-metadata).

`ac scan` reports a key that fits no pattern, and a listed file this repository
does not have, and carries on. When a file holds several versions of an event,
the newest is published and the rest are reported. The site reads earlier
versions from git, through today's mapping, so a commit from before you added it
still counts. A schema a generator wrapped in a named
definition, as `zod-to-json-schema` does, is unwrapped.

The event is the whole message, envelope included: a consumer receives all of
it, so a change to a shared field is a change to every event.

A mapping runs no code, so `ac` reads one without `--allow-code-execution`. If
those files are generated, have CI regenerate them and fail on a difference, or
the catalog reads a stale copy.

### One file for every team

Publish the conventions file once, in an npm package or a repository every team
has, and name it:

```sh
ac scan --conventions node_modules/@acme/conventions/autocatalog.conventions.json
ac drift --base-ref origin/main --conventions node_modules/@acme/conventions/autocatalog.conventions.json
```

It replaces the repository's own file, and `ac drift --base-ref` reads the same
one on both sides. A repository with none of the listed files finds no events.

## Writing to the contract yourself

To skip mapping altogether, write what the catalog reads. These JSON Schemas are
generated from the code that reads the files:

| Contract                                                              | Describes                                      |
| --------------------------------------------------------------------- | ---------------------------------------------- |
| `autocatalog-core/contracts/event-manifest.schema.json`               | An event's `autocatalog.json`                  |
| `autocatalog-core/contracts/graph-v1.schema.json`                     | The resource graph at `/catalog.json`          |
| `autocatalog-core/contracts/autocatalog.components.schema.json`       | A repository's `autocatalog.components.json`   |
| `autocatalog-agents-core/contracts/<kind>.schema.json`                | An agent, tool, `mcp-server` or other manifest |
| `autocatalog-docs-core/contracts/autocatalog.conventions.schema.json` | The conventions file                           |

They cover a file's shape. A few checks have no JSON Schema form, such as a
snapshot header holding a `${NAME}` rather than a value, and `ac` still applies
those when it reads the file. For types, import from the same packages.

## The package

`ac` finds plugins in the project's `node_modules` by name:
`autocatalog-plugin-<name>`, or the same under your scope,
`@acme/autocatalog-plugin-<name>`. A company plugin can stay on a private
registry.

The `autocatalog.plugin` block in `package.json` says what it adds:

```json
{
  "name": "@acme/autocatalog-plugin-orders",
  "version": "1.0.0",
  "type": "module",
  "autocatalog": {
    "plugin": {
      "description": "Events from the order service's contract files",
      "discovery": { "entry": "./index.js", "export": "ordersPlugin" }
    }
  }
}
```

- `discovery` names the module and export `ac scan` and `ac drift` call.
- `command` and `entry` add a subcommand: `"command": "from-orders"` makes
  `ac from-orders`, which runs `entry` with the arguments it was given.

A package can declare both.

## The scanner

The export is a `DiscoveryAdapter` from `autocatalog-core`: a name and a
`discover` function. `discover` gets the repository root and returns each
event it found with the file it came from.

```js
import fs from 'node:fs/promises';
import path from 'node:path';

/** Every `orders/*.order-event.json` file is one event. */
export const ordersPlugin = {
  name: 'orders',
  async discover({ root }) {
    const dir = path.join(root, 'orders');
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) =>
      f.endsWith('.order-event.json'),
    );
    const candidates = [];
    const errors = [];

    for (const file of files) {
      try {
        const contract = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));

        candidates.push({
          event: {
            id: contract.id,
            version: contract.version,
            name: contract.name,
            summary: contract.summary,
            domain: 'orders',
            folderName: contract.name.replaceAll(' ', ''),
            schema: contract.schema,
            examples: [],
          },
          finding: {
            file: path.join('orders', file),
            symbol: contract.id,
            kind: 'order-event',
            id: contract.id,
            needsReview: false,
            source: 'orders',
          },
        });
      } catch (error) {
        errors.push(`${file}: ${error.message}`);
      }
    }

    return { candidates, errors };
  },
};
```

- `event.schema` is a JSON Schema object. Drift compares these between
  commits, so the same contract must give the same schema every run.
- `finding.needsReview: true` marks an event the plugin guessed at. The
  catalog shows it as needing review.
- `ac scan` reports each of `errors` and fails. Return one per unreadable file,
  and keep going.

With TypeScript, type the export as `DiscoveryAdapter` from `autocatalog-core`
and the compiler checks every field.

## Publish components

A plugin can list the UI components a tool holds, the way
`autocatalog-plugin-storybook` does for Storybook. Add a `command`, read your
format, and call `writeComponents` from `autocatalog-core`:

```js
import { writeComponents } from 'autocatalog-core';

await writeComponents(process.cwd(), {
  components: [
    {
      id: 'receipt-card',
      name: 'ReceiptCard',
      props: [],
      stories: [{ id: 'receipt-card--paid', name: 'paid', link: '#receipt-card/paid' }],
    },
  ],
  viewer: { name: 'Gallery', url: 'https://gallery.acme.dev/' },
});
```

- `viewer` names the tool. The site says `Open in Gallery` and joins each story's
  `link` onto `url`.
- Pass `{ check: true }` to compare instead of write. It returns `current` or
  `stale`, so CI can fail on a file that fell behind.
- The site never loads your plugin. It reads the committed file, so anything that
  writes that file publishes to the catalog, with or without a plugin.

[`examples/components`](https://github.com/jagreehal/autocatalog/tree/main/examples/components)
has a working one in `autocatalog-plugin-gallery`.

## Running it

A plugin runs code, so `ac` asks first:

```sh
ac scan --allow-code-execution
```

Without the flag, `ac scan` stops and names the installed plugin. With it,
`ac` runs the plugin in its own Node process, with read access to the
repository and its dependencies, a memory cap, a 30 second timeout and a 16 MB
limit on what it returns. It needs Node 24 or later.

`ac` names the scanner after its package: `@acme/autocatalog-plugin-orders`
reports as `@acme/orders`, so each company's plugins keep names of their own.

## Renamed from adapters

Plugins used to be called adapters. A package named `autocatalog-adapter-<name>`,
or declaring `autocatalog.adapter`, keeps working. If both the old and new names
of a package are installed, `ac` uses the new one. `autocatalog-adapter-zod` is
now `autocatalog-plugin-zod`, with the same exports. The TypeScript type is still
`DiscoveryAdapter`.

## Testing it

Call `discover` on a fixture folder and check the candidates. Then install the
package into a scratch project, add one contract file, and run
`ac scan --allow-code-execution`: the event appears under `events/`.
