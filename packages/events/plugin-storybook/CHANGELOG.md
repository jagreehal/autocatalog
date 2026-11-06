# autocatalog-plugin-storybook

## 0.1.0

### Minor Changes

- 95f623d: - `ac federation lock` pins releases with `--latest-tag` and `--ref`, and event pages show the release.
  - `ac federation status` names consumers on an earlier release, and each event's Versions card shows what upgrading changes.
  - Components join the catalog. Commit `autocatalog.components.json`, or run `ac from-storybook` from the new `autocatalog-plugin-storybook`, and `/components`, `/owners`, `--index` and `llms.txt` list them. Plugins publish through `writeComponents`.

### Patch Changes

- Updated dependencies [95f623d]
  - autocatalog-core@0.9.0
