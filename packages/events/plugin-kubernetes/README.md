# autocatalog-plugin-kubernetes

Check the calls the catalog knows against who a cluster lets reach whom.

```bash
npm install -D autocatalog-plugin-kubernetes
ac from-kubernetes k8s/
```

It reads Deployments, StatefulSets, Namespaces and NetworkPolicies and writes
`autocatalog.network.json`. Commit it: the site says where a call, declared or
traced, is one the network refuses, and where a service a gateway exposes can be
reached around it. See [Network policy](https://jagreehal.github.io/autocatalog/docs/network).

| Option                         | Does                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `--root <dir>`                 | the repository to write into                              |
| `--service <workload=catalog>` | a workload whose catalog name differs, repeatable         |
| `--check`                      | fail when the committed file does not match the manifests |
