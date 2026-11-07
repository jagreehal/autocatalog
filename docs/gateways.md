---
title: Gateways
owner: Maintainers
summary: Which operations a gateway puts in front of the public, and where it and the contracts disagree.
tags:
  - apis
related:
  - docs/drift-ci
  - docs/plugins
---

A gateway decides which of your operations the outside world reaches. Its
configuration already says so, route by route. A plugin reads that configuration
into `autocatalog.gateway.json`, you commit it, and the site joins each route to
the operations behind it.

## Kong

```bash
npm install -D autocatalog-plugin-kong
ac from-kong kong.yml
```

`ac from-kong` reads a decK declarative configuration, the file DB-less Kong
loads. Give it every file decK merges, and it reads them as one, so a platform
file's plugins apply to each team's routes:

```bash
ac from-kong platform.yml teams/*.yml --root gateway
```

It records each route's service, paths, methods, whether it strips the path, the
service's upstream path, and the plugins that authenticate a request. A
`${{ env "NAME" }}` template is left unread. When a Kong service is named
differently in the catalog, map it: `--service orders=orders-api`. In CI,
`--check` fails when the committed file no longer matches the configuration.

### Kong on Kubernetes

With the Kong Ingress Controller, point it at the manifests, files or folders:

```bash
ac from-kong k8s/ --root gateway
```

It reads Gateway API `HTTPRoute`s, each match with its method, and the plugins
Kong attaches: a `KongClusterPlugin` labelled `global: "true"` on every route,
and a `KongPlugin` or `KongClusterPlugin` named in `konghq.com/plugins` on a
route or its Service, the most specific winning as Kong runs them. A `disabled`
plugin, or one that lets an anonymous request through, authenticates nothing.

A route whose namespace the Gateway does not let attach, by its
`allowedRoutes`, never serves traffic, so it is left out and said. A path an
`URLRewrite` filter changes is said and not followed.

## What the site does with it

Each operation a route reaches is exposed by the gateway, at the path a client
uses, in `/catalog.json`. A regular expression path is matched the way Kong
anchors it, against the operation's path with a sample value for each parameter.

The build says where the gateway and the contracts disagree:

- a route that reaches no operation of its service, or a service the catalog has
  no API for
- an operation of a routed service that no route reaches
- a route that authenticates nothing, in front of an operation whose spec secures
  it

`ac federation status` lists the same, under its own heading. The MCP server's
`assess_impact` names the gateway beside the service that exposes an operation.

## Another gateway

The file is the contract, published at
`autocatalog-core/contracts/autocatalog.gateway.schema.json`. A plugin for
another gateway writes the same file, with `writeGatewayFile` from
`autocatalog-core`, and the site reads it the same way.
