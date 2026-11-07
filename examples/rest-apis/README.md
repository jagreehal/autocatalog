# REST APIs

One API and the services that call it, published as one company site.

| Repository     | Publishes                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- |
| `customers`    | the Customers Service API, `customer.created`, and an OTLP export                             |
| `checkout`     | `checkout.completed`; declares it reads `email` from `GET /customers/{id}`                    |
| `billing`      | `invoice.issued`; declares nothing, but traces show it calling that operation                 |
| `gateway`      | a Kong configuration, and the `autocatalog.gateway.json` `ac from-kong` wrote from it         |
| `cluster`      | Kubernetes manifests, and the `autocatalog.network.json` `ac from-kubernetes` wrote from them |
| `company-site` | the lock                                                                                      |

```bash
pnpm turbo run build --filter=autocatalog-cli... --filter=autocatalog-plugin-kong --filter=autocatalog-plugin-kubernetes
pnpm verify:rest-apis           # in a temporary folder
pnpm verify:rest-apis ./work    # kept, to look at the site it built
```

The script turns each folder into a git repository and enrols it over
`file://`. It then checks that:

1. `ac scan --traces` reads `customers/traces/otlp.json` into observed `calls`
   relationships, with the `http.route` each server span saw.
2. The committed `gateway/autocatalog.gateway.json` matches `gateway/kong.yml`,
   and `cluster/autocatalog.network.json` matches `cluster/k8s.yaml`.
3. `ac federation lock` pins each service to the repository that owns it, and
   `ac site` publishes the API at `/apis/customers/customers-api/` and an
   `endpoint` for each operation, exposed by the service the spec names in
   `x-autocatalog.service`. `GET /customers/{id}` is called by `checkout-service`
   (declared) and `billing-service` (observed), and exposed by `kong` at
   `/customers/{id}`. `POST /customers` has no route, and the build says so. The
   cluster lets only the gateway and `checkout-service` reach `customers-service`,
   so the build says the network blocks `billing-service`'s traced calls.
4. Removing `tier` from the `Customer` schema fails `ac drift`, which names
   `billing-service`: traces say it calls the operation and nothing says what it
   reads, so it may read anything. `checkout-service` says it reads `email`, so
   the change does not reach it.
