---
title: Network policy
owner: Maintainers
summary: Check the calls the catalog knows against who the network lets reach whom.
tags:
  - apis
related:
  - docs/gateways
  - docs/drift-ci
---

A call can be declared in `autocatalog.consumes.json` or seen in traces. The
network can still refuse it. A plugin reads the platform's policy into
`autocatalog.network.json`, you commit it, and the site checks every call
against it.

## Kubernetes

```bash
npm install -D autocatalog-plugin-kubernetes
ac from-kubernetes k8s/ --root cluster
```

`ac from-kubernetes` reads Deployments, StatefulSets, Namespaces and
NetworkPolicies, files or folders. Each workload is a catalog service by its
name; map one that differs with `--service users=users-api`. For each it
records who may connect to it and what it may connect to, as services, whole
namespaces, or outside the cluster. A workload no policy selects for a
direction is open in that direction, as Kubernetes has it. In CI, `--check`
fails when the committed file no longer matches the manifests.

## What the site says

- a call, declared or traced, that the callee's policy does not let in, or the
  caller's policy does not let out
- a service a gateway exposes whose pods any workload may reach, so a caller
  can skip the gateway and its authentication

A call involving a service no policy file describes is not judged.
`ac federation status` lists the same, under its own heading.

## Two configurations of one gateway

When a gateway runs from two configurations, such as Compose and Kubernetes,
`ac from-kong` checks they let through the same routes:

```bash
ac from-kong compose/platform.yml compose/teams/*.yml --same-as k8s/
```

It compares method by method and path by path, whatever the routes are named,
and writes nothing.
