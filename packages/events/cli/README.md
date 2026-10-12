# autocatalog-cli

The `ac` command: scan a repository into an event catalog, validate it, gate
breaking changes in CI, and build the site.

```bash
ac scan .        # discover event contracts and write events/
ac validate      # check every event
ac drift         # compare against a baseline and fail on breaking changes
ac site . --dev  # serve the catalog and docs as one site
```

Most people start with `npx autocatalog .`, which installs and runs this.

Documented at **[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT. No licence key, no telemetry.
