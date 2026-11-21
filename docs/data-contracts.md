---
title: Data contracts
owner: Maintainers
summary: Put ODCS data contracts on the site with their track record and AI context, and fail a change that breaks a consumer in another repository.
tags:
  - data
related:
  - docs/site
  - docs/plugins
  - docs/mcp
---

A data contract describes a dataset as an API description describes an API:
its schema, quality rules, service levels, terms of use and owner, in the
[Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/)
(ODCS). autocatalog reads ODCS contracts where a data product names them, and
[`autocatalog-plugin-odcs`](https://github.com/jagreehal/autocatalog/tree/main/packages/events/plugin-odcs)
checks them with [`autotel-datacontract`](https://github.com/jagreehal/autotel/tree/main/packages/autotel-datacontract).

## On the data product page

Name the contract each output keeps, and what an input expects:

```yaml
# data-products/customers.md, in the crm repository
name: Customers
outputs:
  - { ref: data-product/cross-sell, contract: datacontracts/customers_v1.odcs.yaml }
```

```yaml
# data-products/cross-sell.md, in the analytics repository
name: Cross-sell
inputs:
  - { ref: data-product/customers, contract: expectations/cross-sell.odcs.yaml }
```

Or describe the product in the
[Open Data Product Standard](https://bitol-io.github.io/open-data-product-standard/)
(ODPS v1) as `<id>.odps.yaml`, at the repository's root or in
`data-products/`. Its ports name contracts by `contractId` and `version`, so a
product can publish v1 and v2 side by side:

```yaml
# data-products/customers.odps.yaml, in the crm repository
apiVersion: v1.1.0
kind: DataProduct
id: customers
name: Customers
status: active
outputPorts:
  - { name: customers, version: 1.0.0, contractId: customers }
  - { name: customers, version: 2.0.0, contractId: customers }
```

An output port reads the contract of that id and exactly that version in its
own repository. An input port reads the version a data product publishes, in
any repository the site reads, and links to that product. A site build fails an input whose contract no data product
publishes; `ac docs check`, which reads one repository, leaves it to the site. An input port with no
`version` reads the newest version a data product publishes, an output port
the newest file, and a port with only a `name` names no contract.

A contract file ending in `.odcs.yaml` is read, and the page shows it as the
data's product details page: terms of use, service levels, each object's
columns with their type, whether they are required and how they are
classified, the owner and support channels, servers, roles and price, and the
AI context: instructions, constraints, and verified statements with their
queries. An input's contract is shown as what the product expects. A file that
is not ODCS v3 fails `ac docs check`, naming the field; a missing
`apiVersion` or a malformed `schema` fails too. Each contract version has its
own card and anchor.

## The track record

A scheduled check appends its results beside the contract, one line per
object per run, in `customers_v1.results.ndjson` for
`customers_v1.odcs.yaml`:

```bash
autotel-datacontract verify datacontracts/customers_v1.odcs.yaml export.ndjson \
  --object customers --record datacontracts/customers_v1.results.ndjson
```

A database audit writes the same lines with `resultLines(await auditDatabase(contract, db))`.
The lines carry outcomes, never values. The page shows how many of the last 30
runs kept every promise, and each service level as "kept 29 of the last 30".
Only lines for the contract's own id and version count, and only the service
levels it promises, so results for an earlier promise never credit a new one.
Reports sharing a time are one run; a run that leaves one of the contract's
objects, quality rules or service levels unchecked, a `not-executable` one
included, is incomplete, and an `unknown` outcome counts as not kept.

## For agents

`llms.txt` lists each data product's contracts under it, with service levels
and their record, limitations, instructions, constraints and the questions it
answers. The MCP server's `data_contract` tool returns the whole contract as written,
under `document`: relationships, authoritative definitions, every quality
rule, each server's connection details, and each verified statement's query, so an agent reuses the provider's
query instead of writing its own.

## In CI

```bash
npm install -D autocatalog-plugin-odcs
ac from-odcs                         # tables into .autocatalog/models.json; commit it
ac from-odcs --check --base ../base  # stale models, a breaking change under a minor bump, or a contract removed before it was retired
ac from-odcs --consumers ../analytics ../finance
```

`--consumers` reads the data products of the repositories named, alongside
this one, and checks each input's expected contract against the ODCS
contracts of the product it reads. It is met when one output promises at
least as much, so a consumer still reading v1 is not broken by v2. A change
that breaks one names it, and what it no longer gets:

```text
✗ breaks Cross-sell (analytics/data-products/cross-sell.md): no output of Customers (crm) meets expectations/cross-sell.odcs.yaml; closest is datacontracts/customers_v1.odcs.yaml
    sla.freshness:customers.last_updated_at: 2 day → 72 hours
```

`--base` pairs contracts by `id` and major version, so a renamed file is
still compared, and fails a contract removed before the base set it to
`status: retired`, including the last one. A `--base` that is not a
directory fails, and the whole base is read, so naming one contract still
compares it with its old file. A failed run writes nothing. `--consumers` also
fails when a data product does not read, or when an ODPS input pins a contract
version that no repository keeps or no data product publishes.

Pass the checkouts a company site already caches for federation, or check out
the consuming repositories in the job.
