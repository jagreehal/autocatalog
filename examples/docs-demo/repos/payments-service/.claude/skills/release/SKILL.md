---
name: release
description: Cut a release of the payments service, tag it and write the changelog.
allowed-tools: Bash(git:*) Read
---

1. Check the build is green on main.
2. Run `pnpm changeset version`, then tag the commit.
