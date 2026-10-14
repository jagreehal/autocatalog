---
title: Writing an adapter
owner: Maintainers
summary: Teach ac scan and ac drift to read events from a format of your own.
tags:
  - adapters
related:
  - docs/cli
  - docs/events/zod
---

An adapter is an npm package that teaches autocatalog a new event format: a
company contract format, a registry export, a framework's decorators. Install
it next to autocatalog, and `ac scan` and `ac drift` read your events the way
they read JSON Schema, into the same catalog, site and breaking-change gate.

`autocatalog-adapter-zod` is one. Yours works the same way.

## The package

`ac` finds adapters in the project's `node_modules` by name:
`autocatalog-adapter-<name>`, or the same under your scope,
`@acme/autocatalog-adapter-<name>`. A company adapter can stay on a private
registry.

The `autocatalog.adapter` block in `package.json` says what it adds:

```json
{
  "name": "@acme/autocatalog-adapter-orders",
  "version": "1.0.0",
  "type": "module",
  "autocatalog": {
    "adapter": {
      "description": "Events from the order service's contract files",
      "discovery": { "entry": "./index.js", "export": "ordersAdapter" }
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
export const ordersAdapter = {
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
- `finding.needsReview: true` marks an event the adapter guessed at. The
  catalog shows it as needing review.
- `ac scan` reports each of `errors` and fails. Return one per unreadable file,
  and keep going.

With TypeScript, type the export as `DiscoveryAdapter` from `autocatalog-core`
and the compiler checks every field.

## Running it

An adapter runs code, so `ac` asks first:

```sh
ac scan --allow-code-execution
```

Without the flag, `ac scan` stops and names the installed adapter. With it,
`ac` runs the adapter in its own Node process, with read access to the
repository and its dependencies, a memory cap, a 30 second timeout and a 16 MB
limit on what it returns. It needs Node 24 or later.

`ac` names the scanner after its package: `@acme/autocatalog-adapter-orders`
reports as `@acme/orders`, so each company's adapters keep names of their own.

## Testing it

Call `discover` on a fixture folder and check the candidates. Then install the
package into a scratch project, add one contract file, and run
`ac scan --allow-code-execution`: the event appears under `events/`.
