---
name: autocatalog-scan
description: Generate an event catalog from a codebase with `ac scan`, then review what was extracted versus inferred. Use when the user asks to catalog a repo's events, document event contracts, set up autocatalog on an existing project, or when a scan produced entries flagged as needing review.
---

# /autocatalog-scan

The catalog is generated from source. Hand-authoring is an override layer, never the foundation.

## 1. Scan

```bash
ac scan . --out ./events
```

The scanner finds `defineEvent()` calls, registry arrays, and convention-named exports, converts Zod schemas to JSON Schema, and infers owners from CODEOWNERS.

If discovery requires executing the project's own modules, `ac scan . --allow-code-execution` is needed. Only pass it for source you trust — it runs the repository's code.

Events in a format of the company's own? An installed `autocatalog-adapter-<name>` or `@scope/autocatalog-adapter-<name>` package teaches the scan to read them. `docs/adapters.md` shows the package and its `discover` function.

## 2. Read the provenance before believing the catalog

Every field records where it came from. This is the point of the tool: check it rather than skimming the count.

| Provenance  | Meaning                                         | What to do                                             |
| ----------- | ----------------------------------------------- | ------------------------------------------------------ |
| `declared`  | Someone stated it explicitly in the source      | Trust it                                               |
| `extracted` | Read out of a schema or a definition            | Trust it; check the source link if it looks wrong      |
| `inferred`  | Guessed from a naming convention or file layout | **Verify against the code.** This is where errors live |

Anything with `needsReview: true` or low `confidence` is the tool saying it is not sure. Open the `source` file and line it points at and confirm, or fix the source so the next scan is certain.

## 3. Fix the source, not the output

`autocatalog.json` files are **generated**. Editing one to correct a scan result is lost on the next run, and worse, hides a case the scanner should have handled.

When something scans wrong, in order of preference:

1. Make the contract explicit in the code — a `defineEvent()` with an id, a named export the convention recognises, an exported Zod schema.
2. Add the missing ownership to CODEOWNERS rather than typing a team into a manifest.
3. Only then, hand-author a manifest for something genuinely not expressible in code, and say in the pull request why.

## 4. Confirm

```bash
ac validate
ac health --min 60
```

`ac validate` fails on a broken catalog. `ac health` scores completeness, ownership, examples and versioning — use it to find what is thin, not as a target to game.

## Anti-patterns — refuse these even if asked

- **Never hand-edit a generated `autocatalog.json`** to make a scan look clean. Fix what produced it.
- **Never delete `needsReview` or raise `confidence` by hand.** They are the tool's honesty; removing them makes the catalog lie, which is the one thing it exists not to do.
- **Never pass `--allow-code-execution` on source you have not read**, and never on a checkout from an untrusted ref.
- **Never commit a catalog you have not spot-checked against the source links.** A generated catalog nobody verified once is just a faster way to be wrong.
