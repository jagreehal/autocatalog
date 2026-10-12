---
title: Production operation
owner: Maintainers
summary: The trust model, artifact integrity, transactional publication, and crash recovery.
tags:
  - ci
  - reference
related:
  - docs/events/json-schema
  - docs/drift-ci
---

Autocatalog supports Node.js 24 and newer. Production consumers should enter through `loadCatalogSnapshot()` or a higher-level Astro/MCP Interface; those readers wait for publication, reject incomplete Catalogs, and verify every present producer index.

## Stability

Three things are a contract from the first published version: the `ac` commands, the
`autocatalog/v2` IR, and the `autocatalog/graph-v1` Interface. Breaking any of them ships
as a major version with a documented migration. A tool that asks a team to trust its
catalog cannot casually break the catalog.

## Discovery trust

Raw JSON Schema discovery is passive: it reads data files and does not execute repository code.

Runtime Adapters such as Zod must evaluate code to recover the runtime schema. Autocatalog refuses that by default. For a repository you trust:

```bash
ac scan . --allow-code-execution
```

Authorized runtime Adapters execute outside the CLI process with:

- repository and dependency paths read-only;
- filesystem writes, network access, child processes, workers, and inherited credentials denied;
- a minimal environment;
- memory, time, candidate, and output limits;
- a validated `autocatalog/discovery-v1` result protocol.

This is process isolation and least privilege, not a universal sandbox. Do not authorize runtime discovery for an untrusted pull request on a privileged runner. Use passive discovery, a disposable locked-down runner, or produce the Catalog artifact inside the producer's trusted CI context.

## Artifact integrity

`autocatalog.artifact.json` indexes every current and historical Event folder. It records manifest, schema, and complete folder SHA-256 hashes, repository revision, dirty state, and a working-tree digest. Loading a present artifact verifies:

- its format and validation status;
- safe, unique relative paths;
- an exact index-to-folder mapping;
- Event identity and version;
- every recorded content hash.

Any mismatch rejects the entire Catalog. Hashes detect corruption and accidental mutation; they do not authenticate an artifact against an attacker who can replace both files and hashes. Use an authenticated artifact registry or signed release provenance when crossing a trust domain.

Editing generated files or `index.mdx` changes a published generation. Run `ac scan` again to publish and hash the new complete artifact.

## Publication and recovery

Publication is transactional for supported Autocatalog readers:

1. Acquire an exclusive sibling lock.
2. Build and validate a private staging tree.
3. Flush the producer index.
4. Move the old generation to a recorded backup.
5. Move the new generation into place and flush its parent directory.
6. Remove the backup and release the owned lock.

Readers wait while the swap is active. Concurrent publishers fail with `catalog_publication_locked`. If a process dies during the rename window, the next reader or publisher verifies that the local owner process is gone, restores the recorded backup when needed, removes abandoned staging, and then continues. A lock owned by another host is never guessed stale.

If automated recovery cannot establish ownership, preserve the lock and directories and inspect them manually. They sit beside the events root and use these names:

```text
.<events-name>-publish.lock
.<events-name>-stage-*
.<events-name>-backup-*
```

## Git-ref drift

```bash
git fetch origin main
ac drift --base-ref origin/main --root .
```

Runtime discovery additionally requires `--allow-code-execution`. Baseline and current dependency lockfiles must be identical before Autocatalog will reuse installed dependencies. If dependencies differ, produce a Catalog artifact in each revision's own CI environment and compare them with directory mode:

```bash
ac drift --base ./baseline-events --current ./current-events
```

An artifact from `ac scan --out` carries the repository's resource graph as `resources.json`, so datastore and command changes are compared too; when only one artifact has it, drift warns and skips the resource comparison.

Missing or shallow-clone refs fail with `source_ref_not_found` and a fetch instruction. Worktrees are always temporary and removed after comparison.

## Release gate

Before publishing packages:

```bash
pnpm release:check
```

The gate checks formatting, then runs oxlint with the vendored anti-slop rules
and oxlint's correctness rules as errors. It type-checks every package with
TypeScript 7, then runs the tests, the package builds and the default starter
Catalog. TypeScript 6 stays installed beside 7, because the static Zod scanner,
tsup's declaration build and `astro check` call the compiler API, which
TypeScript 7 only publishes as unstable. CI also performs package publish dry-runs and the executable browser smoke story on Node.js 24.

`pnpm smoke:product` runs the built CLI against temporary repositories, without
network access. It checks contract discovery, repository quarantine, ownership,
resource-linked docs, version history, relative links, repeat builds from a
relocated checkout, EventCatalog export/import, and a failing drift gate with
field-level consumer impact. CI and `release:check` run it after package builds;
run `pnpm build && pnpm smoke:product` to reproduce those journeys locally.
