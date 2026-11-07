# autocatalog-plugin-kong

Put what a Kong gateway exposes on the company site.

```bash
npm install -D autocatalog-plugin-kong
ac from-kong kong.yml
```

It reads a decK declarative configuration, several files as one when decK merges
them, or the Kubernetes manifests of the Kong Ingress Controller (Gateway API
`HTTPRoute`s and Kong's plugin resources), and writes `autocatalog.gateway.json`. Commit it: the site joins each
route to the operations behind it, and says where the gateway and the contracts
disagree. See [Gateways](https://jagreehal.github.io/autocatalog/docs/gateways).

| Option                     | Does                                                   |
| -------------------------- | ------------------------------------------------------ |
| `--root <dir>`             | the repository to write into                           |
| `--gateway <name>`         | the gateway's name in the catalog, `kong` by default   |
| `--service <kong=catalog>` | a Kong service whose catalog name differs, repeatable  |
| `--check`                  | fail when the committed file does not match the config |
