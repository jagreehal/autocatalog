# Federation

Five team repositories that use only autocatalog, composed into one company
site. Nothing here was imported from EventCatalog.

| Repository        | Publishes                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `payments`        | `payment.completed` (1.0.0, 1.1.0, then 2.0.0-beta.1 in git history), `refund-payment` command   |
| `orders`          | `order.placed`, `orders/status.changed`; receives `payment.completed@^1`, sends `refund-payment` |
| `shipping`        | `shipping/status.changed`; receives `orders/order.placed`                                        |
| `ledger`          | only `autocatalog.consumes.json` and docs: what LedgerService reads, from which queue            |
| `infra`           | the RabbitMQ definitions that route `payment.completed` to the ledger's queue                    |
| `company-site`    | the lock                                                                                         |
| `legacy-payments` | a second copy of `payments/payment.completed`: two owners of one id; a doc with no `owner`       |
| `notifications`   | a contract that does not parse                                                                   |

`ledger` also names `invoice.issued`, which nobody publishes, and a bare
`status.changed`, which two domains publish.

```bash
pnpm turbo run build --filter=autocatalog-cli...
pnpm verify:federation            # in a temporary folder
pnpm verify:federation ./work     # kept, to look at the sites it built
```

The script turns each folder into a git repository and enrols it over
`file://`. It then checks that:

1. `ac federation lock` pins each repository, and `--only orders` moves one pin.
2. `ac federation status` shows each pin and what each repository publishes. It
   lists the reference that names nothing and the ambiguous one, and exits 0.
3. `ac site` builds the pinned commits. `^1` and `latest` pick 1.1.0 from
   history, never the prerelease.
4. In payments, a renamed field fails `ac drift --consumers` and names
   LedgerService, which only ledger declares. So does a binding change in infra.
5. A business-unit site of payments and ledger, with `--index` pointing at the
   company's `catalog.json`, resolves ledger's reference to shipping. It is built
   twice at once, and both builds must match.
6. With `legacy-payments` and `notifications` enrolled, `ac federation status`
   exits 1 and names both. The site leaves out notifications and legacy-payments'
   documents, builds the rest,
   and drift in payments still names LedgerService.

See [Federation](../../docs/federation.md).
