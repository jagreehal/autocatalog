# Upstream

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10, "Merge pull request #36 from K-Mistele/contrib/effect-tag-match-rules"), clean working tree
- Copied from: `skills/install-anti-slop/assets/anti-slop/` via `skills/install-anti-slop/scripts/install.mjs`
- Installed: 2026-09-27, with `oxlint@1.85.0` and `@oxlint/plugins@1.85.0`
- Refreshed: 2026-10-10 — staged incoming from the current install-anti-slop skill bundle and compared to the live tree. Rules, shared, effect, vendor, and `index.ts` were byte-identical; no code merge required. Runtime pair is now `oxlint@1.87.0` / `@oxlint/plugins@1.87.0`.
- Plugin paths: `tools/oxlint/anti-slop/index.ts` (registered in `.oxlintrc.json`). `effect/index.ts` was copied but is not registered, because no package declares `effect`.

## Deviations

- Added `package.json` (`"type": "module"`) so Node loads `index.ts` as ESM without a reparse warning. The root package is not `"type": "module"`.
- Otherwise byte-identical to the source. The directory is in `.prettierignore` so repo formatting does not drift it from upstream.
