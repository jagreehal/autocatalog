---
title: Platform workspace
owner: Platform
tier: standard
summary: How the services in this monorepo publish their own docs and contracts.
related:
  - orders/runbook
  - shipping/dispatch
---

# Platform workspace

Each service under `services/` keeps its `docs/` and `contracts/` beside its
code, as a separate repository would. The catalog finds them where they are
and publishes each under the service's folder name, so moving a service to
another repository keeps its addresses.
