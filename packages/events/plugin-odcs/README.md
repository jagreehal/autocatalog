# autocatalog-plugin-odcs

Put [Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/) (ODCS) contracts on the company site, and fail a pull request that breaks one.

```bash
npm install -D autocatalog-plugin-odcs
ac from-odcs
```

It finds every `*.odcs.yaml` in the repository, lints it with [`autotel-datacontract`](https://github.com/jagreehal/autotel/tree/main/packages/autotel-datacontract), and writes each table or view it declares into `.autocatalog/models.json` with the contract's JSON Schema: required columns, types, valid values, and each quality rule under `x-odcs-quality`. Commit it. The scan publishes them as table resources, beside the readers, writers and owners it already knows. A contract is declared, so it takes the place of a schema the scanner inferred from code for the same table. Models from other exporters in the file are kept.

A table's id is its `physicalName`, else its name, so it meets the same table seen in code and traces. When the contract's server names a `schema`, the id carries it (`crm_v2.customers`), so v1 and v2 of a contract can each keep their own `customers` table. Its namespace is `.autocatalog/config.json`'s `datastore` and `database`, as the scanner's is. Objects of another `physicalType` (a topic, a file) are not tables and are left out.

| Option               | Does                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `[contracts...]`     | contract files or folders to read, the whole repository by default                                                       |
| `--root <dir>`       | the repository to write into                                                                                             |
| `--datastore <name>` | the logical datastore, else `.autocatalog/config.json`, else `default`                                                   |
| `--database <name>`  | the database, else `.autocatalog/config.json`, else `default`                                                            |
| `--base <dir>`       | a checkout of the base branch: fail on a breaking change under a minor or patch bump, or a contract removed unretired    |
| `--check`            | fail when the committed models do not match the contracts; writes nothing                                                |
| `--consumers <dirs>` | other repositories' checkouts: fail when a data product's expected contract is no longer met (see below); writes nothing |

In CI:

```bash
git worktree add ../base origin/main
ac from-odcs --check --base ../base
```

`--base` pairs each contract with the base contract of the same `id` and major version, wherever its file now lives, so a moved or renamed file is still compared. The whole base is read, so naming one contract still compares it with its old file. A base contract with no counterpart fails unless the base had set it to `status: retired`; removing the last contract clears its tables once it was. A `--base` that is not a directory fails, as does a base contract that does not read, or one id and major version declared twice. A new major goes beside the old one, in its own file. A run that fails writes nothing, so the last good `models.json` stays. Naming contracts replaces only their models; the other contracts' tables stay, and with `--base`, a retired contract removed from the named paths takes its tables with it.

Breaking changes are read from the consumer's side: a removed or retyped column, required to optional, a wider set of valid values, a looser SLA, a dropped server, or a column linked to a different ontology concept. `lint` also checks the `<id>_v<major>.odcs.yaml` file-name convention.

## Consumers in other repositories

A data product's input can name the contract it expects of another data product (`inputs: [{ ref: data-product/customers, contract: expectations/cross-sell.odcs.yaml }]`). `ac from-odcs --consumers ../analytics ../finance` reads the data products of this repository and those, and checks each expectation against the ODCS output contracts of the product it reads, with `satisfies` from `autotel-datacontract`. It is met when one output promises at least as much; otherwise it names the consumer, its repository, and what the closest output lacks, and exits 1. An [ODPS](https://bitol-io.github.io/open-data-product-standard/) data product's input port pins a contract by `contractId` and exact `version`, and fails when no repository keeps that version or no data product publishes it. A data product that does not read also exits 1. See [Data contracts](https://jagreehal.github.io/autocatalog/docs/data-contracts).
