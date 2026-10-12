---
title: Versioning
owner: Maintainers
summary: How versions are stored, ordered, and diffed.
tags:
  - events
related:
  - docs/drift-ci
  - docs/events/validation
---

Use semver (`1.2.3`). It gives deterministic ordering and version-to-version
diffs: added fields, removed fields, type changes, requirement changes, enum
changes, and format changes.

Integer versions like `2` or EventCatalog's `V2` are accepted as they are.
Other labels, such as `latest`, work too: `ac validate` warns about them and
nothing breaks, but you lose ordering and therefore the diff.

## Where old versions live

```text
events/payments/PaymentCompleted/
  autocatalog.json       1.0.0 (current)
  schema.json
  index.mdx              optional narrative
  versioned/
    0.9.0/
      autocatalog.json
      schema.json
```

The current version sits at the top of the folder; history goes in `versioned/`.
The detail page renders a version selector and the diff between each version and
the one before it.

## Deprecation

An event manifest can record `deprecation.replacedBy`, pointing at the event that
supersedes it. `ac validate` fails if that reference does not resolve, so a
deprecation notice cannot outlive its replacement.

## Changelogs

```bash
ac changelog
```

Renders the version-to-version schema changes in plain language — the same
diff the site shows, in a form you can paste into a release note.

## Versions and the drift gate

Bumping a version does not make a breaking change safe, and
[`ac drift`](/docs/drift-ci) does not treat it that way. It flags a changed
schema with an unchanged version as suspicious, because version discipline is
the point; and it flags a removed or narrowed field as breaking whatever the
version says, because the consumers reading the old shape are still out there.
