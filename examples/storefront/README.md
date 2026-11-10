# Storefront

The fictional Acme storefront, a catalog of 46 events across eight domains.
Each of its eight teams is a repository of contracts, docs, entities and flows.
A handbook holds the platform docs and the directory. `ac site` joins the nine
into one site.

| Repository            | Events | Commands and queries | Services | Also                                              |
| --------------------- | -----: | -------------------: | -------: | ------------------------------------------------- |
| `ordering-platform`   |     11 |                    5 |        5 | Order Service's AsyncAPI, 4 flows                 |
| `fulfilment-platform` |     10 |                    4 |        8 | carrier SLAs, as a specification for Shipping API |
| `payments-platform`   |      7 |                    0 |        6 |                                                   |
| `customer-platform`   |      6 |                    4 |        4 | Customer API's OpenAPI                            |
| `reviews-platform`    |      6 |                    4 |        3 | the Reviews OpenAPI and AsyncAPI, 1 flow          |
| `product-platform`    |      3 |                    4 |        3 | Product API's OpenAPI, 1 flow                     |
| `shopping-platform`   |      3 |                    4 |        4 | Cart API's OpenAPI, the Marketing domain          |
| `search-platform`     |      0 |                    1 |        2 | Search API's OpenAPI, 1 flow                      |
| `handbook`            |        |                      |          | platform and operations docs, 8 teams, 1 person   |

Every team also has its entities, an overview for each of its domains, systems
and services, and its guides, runbooks and ADRs. Returns, Loyalty and
Notifications are subdomains, inside Fulfilment and Customer.

```bash
pnpm turbo run build --filter=autocatalog-cli...
pnpm --filter @autocatalog-example/storefront check   # ac docs check
pnpm --filter @autocatalog-example/storefront build   # ac site, into dist/
```

## Where each part lives

The content is adapted from the example catalog in EventCatalog's repository
(MIT; see [NOTICE](NOTICE)). For anyone coming from there, this is where each
part went:

| In EventCatalog                    | Here                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| events                             | `contracts/events/<id>.json`, JSON Schema with `x-autocatalog` for producers and transport        |
| commands and queries               | `commands/<id>/autocatalog.json`; a query is a command whose outcome is a `result`                |
| a service's `receives` and `sends` | the producing team's contract, or the consuming team's `autocatalog.consumes.json`                |
| services, systems, containers      | `.autocatalog/imports/services.json`, folded into `resources.json` by `ac resources scan`         |
| OpenAPI and AsyncAPI files         | `contracts/`                                                                                      |
| entities, flows                    | `entities/<id>.md`, `flows/<id>.md`                                                               |
| domain, system and service pages   | `overviews/domains/`, `overviews/systems/`, `overviews/services/`; a subdomain names its `parent` |
| ADRs, runbooks, guides             | `docs/adr/`, `docs/runbooks/`, `docs/guides/`; a domain's guides say `about: [domain/<id>]`       |
| a message's own page text          | `docs/messages/`, shown on the event's page and kept out of the sidebar                           |
| teams and users                    | `handbook/teams/`, `handbook/users/`                                                              |
| `[[service\|order-service]]` links | `[[service\|Order Service]]`, named as the catalog names it                                       |

On the handbook's platform pages, the source's diagram components (`NodeGraph`,
`ContextDiagram` and the like) became `<Map>`. Elsewhere they were dropped,
along with its tiles, message tables and schema viewers, because each domain,
service, event and entity page already draws them.

## Regenerate it

The repositories are generated from `examples/default` in EventCatalog's
repository, at the commit `scripts/regenerate.mjs` names:

```bash
git clone https://github.com/event-catalog/eventcatalog ~/eventcatalog
git -C ~/eventcatalog checkout 23b4bb0
pnpm turbo run build --filter=autocatalog-cli...
node scripts/regenerate.mjs ~/eventcatalog
```

It runs `ac from-eventcatalog`, then `scripts/convert.mjs`, then
`ac resources scan` on each repository, then Prettier. Run twice, it writes the
same files, so change the catalog by changing the converter and regenerating.

## What the build reports

The build warns 16 times about flows, and each warning is a real finding. A flow
says a service consumes or produces an event, and that service's own
declarations say otherwise. Loyalty Service is one: the order-to-doorstep flow
has it consuming Order Confirmed, while the service declares
`order-completed`.

## Left out

- Earlier versions of `OrderCreated`. A contract's history comes from git, and
  these contracts have only one commit.
- The source's Studio canvases and its custom home page.
- The customer support agent, which belongs in an Agents catalog.
- The source's one person is replaced by a fictional engineer.
