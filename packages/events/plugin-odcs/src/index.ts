/**
 * ac from-odcs: Open Data Contract Standard contracts on the company site.
 *
 * Each `*.odcs.yaml` in the repository is linted, and each schema object that
 * is a table or view becomes a table model in `.autocatalog/models.json`
 * (adapter `odcs`), with the contract's JSON Schema: required columns,
 * types, valid values, and every quality rule under `x-odcs-quality`. The
 * scan then publishes them as table resources, where readers, writers and
 * owners already are. A contract is declared, so it replaces a schema the
 * scanner inferred from code for the same table.
 *
 * `--base <dir>` compares each contract with the one of the same id and
 * major version in a checkout of the base branch, wherever its file lives,
 * from the consumer's side. It fails when a breaking change is under-bumped,
 * or when a contract the base keeps is gone and was not retired there.
 * `--check` fails when the committed models differ. A run that fails writes
 * nothing, so the last good models stay.
 */
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { modelExports, readOptionalResourceJson, type ModelExport } from 'autocatalog-core';
import { readDomainModel } from 'autocatalog-docs-core';
import {
  diffContracts,
  formatDiff,
  lintContract,
  parseContract,
  satisfies,
  toJsonSchema,
  type DataContract,
} from 'autotel-datacontract';
import kleur from 'kleur';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export interface FromOdcsOptions {
  /** The repository: contracts are found below it and models written into it. */
  root: string;
  /** Files or folders to read instead of the whole repository. */
  contracts?: string[];
  datastore?: string;
  database?: string;
  /** A checkout of the base branch: each contract is diffed with its file there. */
  base?: string;
  /** Write nothing; fail when the committed models differ. */
  check?: boolean;
}

const CONTRACT = /\.odcs\.ya?ml$/;

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', 'coverage']);

const MODELS = path.join('.autocatalog', 'models.json');

/** `*.odcs.yaml` / `*.odcs.yml` files under the given paths, sorted. */
export async function findContracts(paths: string[]): Promise<string[]> {
  const out: string[] = [];

  const walk = async (p: string): Promise<void> => {
    const stat = await fs.lstat(p);

    if (stat.isSymbolicLink()) return;

    if (stat.isFile()) {
      if (CONTRACT.test(p)) out.push(p);

      return;
    }

    if (!stat.isDirectory()) return;

    for (const entry of await fs.readdir(p)) if (!SKIP.has(entry)) await walk(path.join(p, entry));
  };

  for (const p of paths) await walk(p);

  return out.sort();
}

/** A contract's identity across files and renames: its id and major version. */
const identity = (contract: DataContract) => `${contract.id}@${contract.version.split('.')[0]}`;

const named = z.string().min(1).optional().catch(undefined);

const serversSchema = z.array(z.object({ schema: named }).catch({ schema: undefined })).catch([]);

/** The contract identity a model's symbol (`customers@1.2.0#customers`) carries. */
function symbolIdentity(model: ModelExport): string {
  const [ref = ''] = (model.symbol ?? '').split('#');
  const at = ref.lastIndexOf('@');

  return `${ref.slice(0, at)}@${ref.slice(at + 1).split('.')[0]}`;
}

/** The schema the contract's first server names, which qualifies its tables. */
function serverSchema(contract: DataContract): string | undefined {
  return serversSchema.parse(contract.servers ?? []).find((s) => s.schema)?.schema;
}

/** An object the catalog can hold as a table: no physicalType, or a table or view. */
const isTable = (physicalType: string | undefined) =>
  physicalType === undefined || ['table', 'view'].includes(physicalType.toLowerCase());

/**
 * The table models one contract declares. The table id is its physical name,
 * the one code and traces see, qualified by the server's schema when the
 * contract names one: v1 and v2 can each keep a `customers` table in their
 * own schema.
 */
export function odcsModels(
  contract: DataContract,
  namespace: { datastore: string; database: string },
): ModelExport[] {
  const schema = serverSchema(contract);

  return (contract.schema ?? [])
    .filter((object) => isTable(object.physicalType))
    .map((object) => ({
      kind: 'table' as const,
      id: `${schema ? `${schema}.` : ''}${object.physicalName ?? object.name}`,
      ...namespace,
      adapter: 'odcs' as const,
      // JSON-safe: the catalog stores plain JSON.
      schema: JSON.parse(JSON.stringify(toJsonSchema(contract, object.name))),
      symbol: `${contract.id}@${contract.version}#${object.name}`,
    }));
}

const configSchema = z.object({ datastore: named, database: named }).catch({});

async function namespaceOf(root: string, options: FromOdcsOptions) {
  const config = configSchema.parse(
    (await readOptionalResourceJson(path.join(root, '.autocatalog', 'config.json'), { root })) ??
      {},
  );

  return {
    datastore: options.datastore ?? config.datastore ?? 'default',
    database: options.database ?? config.database ?? 'default',
  };
}

const stable = (models: ModelExport[]) => `${JSON.stringify(models, null, 2)}\n`;

export async function runFromOdcs(options: FromOdcsOptions): Promise<number> {
  const root = path.resolve(options.root);

  const files = await findContracts(
    (options.contracts ?? [root]).map((p) => path.resolve(root, p)),
  );

  if (options.base && !(await fs.stat(options.base).catch(() => undefined))?.isDirectory()) {
    console.error(kleur.red(`✗ --base ${options.base} is not a checkout; nothing compared`));

    return 1;
  }

  const file = path.join(root, MODELS);
  const existing = modelExports.parse((await readOptionalResourceJson(file, { root })) ?? []);

  // With none left, a run still checks the last one was retired and clears its tables.
  if (files.length === 0 && !options.base && !existing.some((m) => m.adapter === 'odcs')) {
    console.error(kleur.red('✗ no *.odcs.yaml contracts found'));

    return 1;
  }

  const namespace = await namespaceOf(root, options);
  let failed = false;
  const models: ModelExport[] = [];
  const tables = new Map<string, string>();
  const current = new Map<string, { file: string; contract: DataContract }>();

  for (const file of files) {
    const relative = path.relative(root, file);
    const text = await fs.readFile(file, 'utf8');
    const issues = lintContract(parseYaml(text), relative);

    for (const issue of issues)
      (issue.severity === 'error' ? console.error : console.warn)(
        (issue.severity === 'error' ? kleur.red : kleur.yellow)(
          `${issue.severity === 'error' ? '✗' : '!'} ${relative} ${issue.path}: ${issue.message}`,
        ),
      );

    if (issues.some((i) => i.severity === 'error')) {
      failed = true;
      continue;
    }

    const { contract } = parseContract(text);
    const key = identity(contract);
    const same = current.get(key);

    if (same) {
      console.error(kleur.red(`✗ ${relative}: ${key} is also declared in ${same.file}`));
      failed = true;
      continue;
    }

    current.set(key, { file: relative, contract });

    for (const model of odcsModels(contract, namespace)) {
      const other = tables.get(model.id);

      if (other) {
        console.error(kleur.red(`✗ ${relative}: table ${model.id} is also declared in ${other}`));
        failed = true;
        continue;
      }

      tables.set(model.id, relative);
      models.push(model);
    }
  }

  // A selection must not hide a second file declaring the same contract: the full run rejects it.
  if (options.contracts) {
    const selected = new Set(files);

    for (const other of await findContracts([root])) {
      if (selected.has(other)) continue;

      const key = await fs
        .readFile(other, 'utf8')
        .then((text) => identity(parseContract(text).contract))
        .catch(() => undefined);

      const same = key && current.get(key);

      if (same) {
        console.error(
          kleur.red(`✗ ${path.relative(root, other)}: ${key} is also declared in ${same.file}`),
        );
        failed = true;
      }
    }
  }

  const compared = options.base ? await compareWithBase(root, options, current) : undefined;

  if (compared && !compared.ok) failed = true;

  // Other exporters' models stay; this plugin owns only the `odcs` ones. A
  // selection replaces the selected contracts' models and keeps the rest.
  const kept = existing.filter(
    (m) =>
      m.adapter !== 'odcs' ||
      (options.contracts !== undefined &&
        !current.has(symbolIdentity(m)) &&
        !compared?.removed.has(symbolIdentity(m))),
  );

  for (const model of models) {
    const other = kept.find((m) => m.adapter === 'odcs' && m.id === model.id);

    if (other) {
      console.error(
        kleur.red(`✗ table ${model.id} is also declared by ${other.symbol ?? 'another contract'}`),
      );
      failed = true;
    }
  }

  // ODCS models in one order, whichever contracts a run read, so a scoped --check compares like with like.
  const byId = (a: ModelExport, b: ModelExport) =>
    a.id.localeCompare(b.id) || (a.symbol ?? '').localeCompare(b.symbol ?? '');

  const next = [
    ...kept.filter((m) => m.adapter !== 'odcs'),
    ...[...kept.filter((m) => m.adapter === 'odcs'), ...models].sort(byId),
  ];

  const text = stable(next);

  if (options.check) {
    if (stable(existing) !== text) {
      console.error(kleur.red(`✗ ${MODELS} does not match the contracts; run ac from-odcs`));

      return 1;
    }

    console.log(`✓ ${MODELS} matches ${files.length} contract(s)`);

    return failed ? 1 : 0;
  }

  if (failed) {
    console.error(kleur.red(`✗ ${MODELS} left as it was; fix the contracts above`));

    return 1;
  }

  await fs.mkdir(path.dirname(file), { recursive: true });

  if ((await fs.lstat(file).catch(() => undefined))?.isSymbolicLink())
    throw new Error(`${MODELS} is a link`);
  await fs.writeFile(file, text);
  console.log(
    `✓ ${models.length} table(s) from ${files.length} contract(s) → ${MODELS} (${namespace.datastore}/${namespace.database}); commit it`,
  );

  return 0;
}

/**
 * Each base contract against the current one of the same id and major
 * version, so a moved or renamed file is still compared. A base contract with
 * no current counterpart must have been retired in the base first. `ok` when
 * every change is bumped as it should be; `removed`, the retired contracts
 * gone since, whose tables go too.
 */
async function compareWithBase(
  root: string,
  options: FromOdcsOptions,
  current: Map<string, { file: string; contract: DataContract }>,
): Promise<{ ok: boolean; removed: Set<string> }> {
  const baseRoot = path.resolve(options.base!);
  // The whole base is read, so a selected contract meets its old self wherever that file was.
  const selected = options.contracts?.map((p) => path.relative(root, path.resolve(root, p)));

  const isSelected = (file: string) =>
    !selected || selected.some((s) => s === '' || file === s || file.startsWith(`${s}${path.sep}`));

  const before = new Map<string, { file: string; contract: DataContract }>();

  // A baseline that cannot be read, or holds one identity twice, would compare
  // against the wrong contract or none, so it fails where it matters.
  let ok = true;

  for (const full of await findContracts([baseRoot])) {
    const file = path.relative(baseRoot, full);
    let contract: DataContract;

    try {
      ({ contract } = parseContract(await fs.readFile(full, 'utf8')));
    } catch {
      if (isSelected(file)) {
        console.error(
          kleur.red(`✗ base ${file} does not read as ODCS; nothing to compare it with`),
        );
        ok = false;
      } else console.warn(kleur.yellow(`! base ${file} does not read as ODCS; not compared`));

      continue;
    }

    const key = identity(contract);
    const twice = before.get(key);

    // Ambiguous wherever this run compares it: a selected file, or a contract being checked.
    if (twice && (current.has(key) || isSelected(twice.file) || isSelected(file))) {
      console.error(kleur.red(`✗ base ${file}: ${key} is also declared in ${twice.file}`));
      ok = false;
      continue;
    }

    before.set(key, { file, contract });
  }

  const removed = new Set<string>();

  for (const [key, was] of before) {
    const now = current.get(key);

    if (!now) {
      // A contract left out of the selection is not gone, only not read.
      if (!isSelected(was.file)) continue;

      if (was.contract.status === 'retired') {
        console.log(`- ${was.file}: ${key} removed after it was retired`);
        removed.add(key);
        continue;
      }

      console.error(
        kleur.red(
          `✗ ${was.file}: ${key} is gone; its consumers lose it. Set status: retired in a release first, or keep it`,
        ),
      );
      ok = false;
      continue;
    }

    const diff = diffContracts(was.contract, now.contract);
    const moved = was.file === now.file ? now.file : `${was.file} → ${now.file}`;

    if (diff.changes.length || diff.versionError) {
      console.log(`${diff.ok ? '·' : kleur.red('✗')} ${moved}`);
      console.log(formatDiff(diff).replace(/^/gm, '  '));
    }

    if (!diff.ok) ok = false;
  }

  for (const [key, now] of current)
    if (!before.has(key)) console.log(`+ ${now.file}: ${key}, new contract`);

  return { ok, removed };
}

export interface ConsumerResult {
  /** The consuming data product, and where it is declared. */
  consumer: { id: string; name: string; repository: string; file: string };
  /** The data product it reads. */
  provider: { id: string; name: string; repository: string };
  /** The consumer's expectation file. */
  expectation: string;
  /** The provider output contract that meets it; absent when none does. */
  metBy?: string | undefined;
  /** When none does: what the closest output contract lacks. */
  unmet: Array<{ path: string; message: string }>;
  closest?: string | undefined;
}

/**
 * Consumer-driven contracts across repositories. A data product's input can
 * name the contract it expects of another data product
 * (`inputs: [{ ref: data-product/customers, contract: expectations/x.odcs.yaml }]`).
 * Each expectation is checked against every ODCS output contract of the
 * product it reads, with autotel-datacontract's `satisfies`: it is met when
 * one of them promises at least as much (a consumer reads one output), and
 * otherwise the closest one's gaps are named.
 */
export interface ConsumerCheck {
  results: ConsumerResult[];
  /** Data products that did not read, and inputs pinned to a contract no repository keeps. */
  failures: string[];
}

export function checkConsumers(
  repositories: Array<{ repository: string; dir: string }>,
): ConsumerCheck {
  const model = readDomainModel(
    repositories,
    { resources: [] },
    { deferMissing: true, deferUnpublished: false },
  );

  const dirOf = new Map(repositories.map((r) => [r.repository, r.dir]));

  const load = (repository: string, file: string) =>
    parseContract(readFileSync(path.join(dirOf.get(repository)!, file), 'utf8')).contract;

  const products = new Map(model.dataProducts.map((p) => [p.id, p]));
  const results: ConsumerResult[] = [];
  const failures = [...model.failures];

  for (const consumer of model.dataProducts)
    for (const input of consumer.inputs) {
      if (!input.odcs || !input.contract || !input.reference.startsWith('data-product/')) continue;
      const provider = products.get(input.reference.slice('data-product/'.length));

      if (!provider) continue;
      const expectation = load(input.contractRepository ?? consumer.repository, input.contract);

      // An ODPS input names the one output it reads; a Markdown expectation takes any that meets it.
      const checked = provider.outputs
        .filter((o) => o.odcs && o.contract && (!input.pin || o.contract === input.contract))
        .map((o) => ({
          file: o.contract!,
          result: satisfies(load(provider.repository, o.contract!), expectation),
        }))
        .sort((a, b) => a.result.unmet.length - b.result.unmet.length);

      const met = checked.find((c) => c.result.ok);
      const closest = checked[0];
      results.push({
        consumer: {
          id: consumer.id,
          name: consumer.name,
          repository: consumer.repository,
          file: consumer.file,
        },
        provider: { id: provider.id, name: provider.name, repository: provider.repository },
        expectation: input.contract,
        metBy: met?.file,
        unmet: met
          ? []
          : (closest?.result.unmet.map(({ path: at, message }) => ({ path: at, message })) ?? [
              { path: provider.id, message: 'the provider publishes no ODCS contract' },
            ]),
        closest: met ? undefined : closest?.file,
      });
    }

  return { results, failures };
}

/** `ac from-odcs --consumers <checkouts...>`: exit 1 when a consumer's expectation is no longer met, or a data product does not read. */
export function runConsumers(root: string, checkouts: string[]): number {
  const dirs = [path.resolve(root), ...checkouts.map((c) => path.resolve(root, c))];
  const repositories = [...new Set(dirs)].map((dir) => ({ repository: path.basename(dir), dir }));
  const { results, failures } = checkConsumers(repositories);

  // A data product that fails to read drops out of the check, so it fails the run.
  for (const failure of failures) console.error(kleur.red(`✗ ${failure}`));

  if (results.length === 0) {
    if (failures.length === 0)
      console.log('No data product names an ODCS contract it expects of another.');

    return failures.length ? 1 : 0;
  }

  for (const r of results) {
    const who = `${r.consumer.name} (${r.consumer.repository}/${r.consumer.file})`;

    if (r.metBy) {
      console.log(`✓ ${who}: ${r.provider.name} meets ${r.expectation} with ${r.metBy}`);
      continue;
    }

    console.error(
      kleur.red(
        `✗ breaks ${who}: no output of ${r.provider.name} (${r.provider.repository}) meets ${r.expectation}${r.closest ? `; closest is ${r.closest}` : ''}`,
      ),
    );

    for (const u of r.unmet) console.error(kleur.red(`    ${u.path}: ${u.message}`));
  }

  return failures.length === 0 && results.every((r) => r.metBy) ? 0 : 1;
}
