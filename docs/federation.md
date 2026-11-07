---
title: Federation
owner: Maintainers
summary: One company catalog from catalogs each team owns, EventCatalog projects included, pinned to reviewed commits.
tags:
  - guide
  - reference
related:
  - docs/site
  - docs/events/importing
  - docs/drift-ci
---

# Federation

Each team keeps its catalog with its code. The company site composes them into
one catalog. Teams change their documentation through their own pull requests.
The site only says which catalogs belong in it and which commit of each to
build.

## Sources

A source is an autocatalog repository or an EventCatalog project.

- **Repositories** are enrolled as the [company site](/docs/site) describes:
  every repository with a GitHub topic, `--repo <url>`, or checkouts on disk.
  A monorepo can hold several catalogs, and each package that publishes one is
  found where it is, with no paths to configure.
- **EventCatalog projects** are federated as they are. Any folder with an
  `eventcatalog.config.js` (or `.mjs`, `.cjs`, `.ts`) is read as one source,
  named after its folder. `ac site` imports it into a cache folder it owns,
  so nothing is written to the project's checkout and nothing needs migrating.
  A project named like one of the site's own pages, such as `catalog`,
  publishes as `catalog-eventcatalog`.

```bash
# A monorepo of EventCatalog projects, one company site
npx autocatalog site ./catalogs
```

## References across catalogs

A team names what another team owns by id, as EventCatalog does. Nobody copies
the other team's definition. `ac from-eventcatalog` and federated EventCatalog
projects keep these references in `autocatalog.consumes.json`, and you can
write them yourself:

```json
{
  "receives": [{ "service": "Warehouse Service", "id": "order-completed", "version": "^1.0.0" }],
  "sends": [{ "service": "Checkout Orchestrator", "id": "create-order" }]
}
```

The site resolves each one against everything composed:

| Pointer    | Names an event          | Names a command        |
| ---------- | ----------------------- | ---------------------- |
| `receives` | the service consumes it | the service handles it |
| `sends`    | the service produces it | the service sends it   |

`id` is bare or `domain/id`. `version` is an exact version, `latest`, or a
range: `^1.0.0`, `~1.2`, `1.x`, `>=1.0.0 <2.0.0`, and `||` between
alternatives. Without one, or with `latest`, the newest stable release wins, and
a prerelease is chosen only when no release exists. A prerelease satisfies a
range only when the range names a prerelease of the same version, so `^1.0.0`
never picks `1.1.0-beta.1`. Earlier versions count: a repository that publishes
only `contracts/` has the versions its git history declares, so `^1` picks
`1.1.0` from history while the current contract is `2.0.0-beta.1`.

A reference that names nothing, names an id two repositories publish, or asks
for a version nobody publishes is reported with what does exist, and left out.
It doesn't block the build. Use `domain/id` to settle an id two domains share.
When two repositories publish the same `domain/id`, only removing one copy
settles it. Until then, each consumer declared for that event in
`autocatalog.consumes.json` is drawn on both copies, so drift in either
repository still names it.

Resolved references are relationships in the company graph, so
`ac drift --consumers https://catalog.acme.dev/catalog.json` names the
Fulfillment team when a Payments change breaks the event it receives.

## Pin what you build

A federated site built from every branch's latest commit changes whenever any
team merges. Pin it instead:

```bash
npx autocatalog federation lock --topic catalog --owner acme
```

`autocatalog.lock.json` records each enrolled repository's URL, commit and tree:

```json
{
  "spec": "autocatalog/lock-v1",
  "repositories": [
    {
      "name": "payments",
      "url": "https://github.com/acme/payments.git",
      "commit": "a4c68dc7ae8115f3b971b32bb00112db0a41b620",
      "tree": "8f27448fa2e2ab4753954d89dd595ac49d6486cc",
      "lockedAt": "2026-11-03T08:46:05.360Z"
    }
  ]
}
```

Commit it. While it exists, `ac site` builds exactly those commits. It checks
each tree against the lock and leaves out, by name, a repository whose locked
commit can't be checked out or whose tree differs. A repository enrolled since
the lock was written is reported and left out until you lock again.
`--unlocked` builds the latest commits instead, and `--lock <file>` names
another lock, which must exist.

To move one pin and keep the rest, pass `--only payments`. A repository that
moved to a new URL keeps its pin and takes the new URL. When no enrolled
repository can be cloned, `lock` fails and leaves the lock as it was.

### Pin releases

`lock` takes each repository's latest commit, which can hold a contract no
consumer has yet. Pin what teams released instead:

```bash
# Each repository's newest release tag
npx autocatalog federation lock --topic catalog --owner acme --latest-tag

# One tag, branch or commit
npx autocatalog federation lock --topic catalog --owner acme --only payments --ref v1.1.0
```

`--latest-tag` compares tags such as `v1.2.3` or `1.2.3` by number and skips
prereleases, so `v2.0.0-beta.1` never wins. A repository with no release tag is
named and pinned at its latest commit. `--ref` takes a tag, a branch or a full
commit SHA. A full SHA names that commit, whatever tags exist, and `lock` refuses
a name that is a tag and a branch at different commits. A repository without that ref keeps its pin, and `lock` fails when no
repository can pin it.

The lock records the commit and tree as usual, plus the tag:

```json
{
  "name": "payments",
  "url": "https://github.com/acme/payments.git",
  "commit": "a4c68dc7ae8115f3b971b32bb00112db0a41b620",
  "tree": "8f27448fa2e2ab4753954d89dd595ac49d6486cc",
  "tag": "v1.1.0",
  "lockedAt": "2026-11-03T08:46:05.360Z"
}
```

The tag follows the commit. Every `lock` records the tag `--ref` named, or else
the newest release tag on the pinned commit, so a plain `lock` of a released
commit keeps its label and a deleted tag loses it. Event pages show that release beside the event's own version, and
`federation status` shows it in place of the commit. A catalog inside a monorepo
shows the release of the repository that holds it, as `platform v1.0.0`. A moved
tag cannot change what the site builds: the commit stays pinned until you lock
again.

Private repositories need `GITHUB_TOKEN` or `GH_TOKEN`. The command sends the
token as a header, over HTTPS to `github.com` or the host in
`GITHUB_SERVER_URL`, and to no other host a lock or `--repo` names. It never
writes the token into a URL or `.git/config`, or prints it in an error.

## Who owns a service

A caller can say which fields of an API it reads, and drift then leaves it out
of a change to a field it does not read. Only the repository that owns the
service may say that, or any team could quiet another's drift gate. The lock is
where ownership is decided:

```json
"services": {
  "orders-api": "orders",
  "users-api": "users"
}
```

`ac federation lock` reads what each repository claims at the commit it pins:
the services its events produce and the services its OpenAPI specs name in
`x-autocatalog.service`. A service one repository claims is pinned to it. A pin
stays while its repository still claims the service, so a repository that
starts claiming it too does not take it over; the lock warns and keeps the pin.
A new service two repositories claim stops the lock until you choose:

```bash
ac federation lock --service orders-api=orders
```

The same flag moves a pin. Every change shows in the lock's diff, beside the
commits, where it is reviewed. A service the lock does not pin gets no narrowing,
and without a lock none does: its callers may read anything.

## Check the federation

```bash
npx autocatalog federation status
```

```text
source                     kind          pinned                 events commands services references
cart-and-checkout          eventcatalog  a4c68dc today               2        6        4        2/2
fulfillment                eventcatalog  a4c68dc today               7        3        7        2/2
payments                   eventcatalog  a4c68dc today               8        1        6        1/1
…

Every source composed, and every reference resolves.
```

It lists each source's pin and age (a project inside a pinned repository
carries that repository's pin), what it contributes, and how many of its
references resolve. It then lists sources left out and why, ids two
repositories both define, and references that don't resolve. It exits 1 when a
source is left out or an id has two owners. `--format json` gives the same
report for scripts.

## See who is behind

A consumer says which release it reads with `version` in
`autocatalog.consumes.json`. When that resolves to an earlier release than the
newest, `federation status` names it. Being behind doesn't change the exit
code:

```text
Behind the newest release:
  orders: OrderService reads payment.completed 1.1.0, and 2.0.0 is out
```

The event's Versions card shows the same thing on the release the service
reads: "Read by OrderService", with what upgrading to the newest release
changes. A prerelease ahead of a consumer leaves it current.

## Views and federations of federations

The same team repositories can feed several sites, such as a company view and
a business-unit view, each with its own topic or `--repo` list and its own lock.

A site can also join another site's graph without rebuilding its pages:

```bash
npx autocatalog site --topic payments-unit --owner acme \
  --index https://catalog.acme.dev/catalog.json
```

The other site's resources and relationships join this site's graph. They fill
in what this site lacks and never replace what it has. References here can
resolve to them, and maps can draw them.

## A worked example

[`examples/federation`](https://github.com/jagreehal/autocatalog/tree/main/examples/federation)
has five team repositories that use only autocatalog, a company site holding
the lock, a repository that duplicates another's event and one that doesn't
compile. `pnpm verify:federation` runs `lock`, `status`, `site`, `--index` and
`drift --consumers` against them.

## Compared with EventCatalog Federation

|                          | EventCatalog Federation     | autocatalog                                                                                                                               |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Licence                  | Enterprise (Scale)          | MIT                                                                                                                                       |
| Sources                  | EventCatalog projects       | autocatalog repositories and EventCatalog projects, side by side                                                                          |
| Enrolment                | `federation add` per source | a GitHub topic, `--repo`, or checkouts on disk; a monorepo's catalogs are found without paths                                             |
| Pinning                  | `ref` per source            | `autocatalog.lock.json`, at the latest commit, a tag, a branch or each repository's newest release, with each tree verified at build      |
| Consumer versions        | references by version       | the same, plus who reads an earlier release and what upgrading changes                                                                    |
| Cross-catalog references | by id, with versions        | by id or `domain/id`, with versions and ranges; events and commands                                                                       |
| Unresolved references    | reported                    | reported with what does exist; ambiguity named                                                                                            |
| Ownership conflicts      | block the build             | `federation status` exits 1 and names both repositories; the site still builds, and a repository that doesn't compile is left out by name |
| Graph-only sources       | `reference` mode            | `--index`: another site's `/catalog.json`                                                                                                 |
| After composition        | documentation site          | the same site, plus breaking-change gates, consumer impact and delivery checks across every federated catalog                             |
