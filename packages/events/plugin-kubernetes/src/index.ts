import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeNetworkFile,
  type NetworkFile,
  type NetworkPeer,
  type NetworkWorkload,
} from 'autocatalog-core';
import kleur from 'kleur';
import { parseAllDocuments } from 'yaml';
import { z } from 'zod';

// Who may reach whom, as Kubernetes says it: a NetworkPolicy selects pods in its
// namespace and lists the peers each direction allows. A pod no policy selects
// for a direction is open in that direction. Workloads are Deployments and
// StatefulSets, each a catalog service by name.

const labels = z.record(z.string(), z.string()).default({});

const metadata = z.object({ name: z.string(), namespace: z.string().optional(), labels });

const manifest = z.looseObject({ apiVersion: z.string(), kind: z.string(), metadata });

type Manifest = z.infer<typeof manifest>;

const selector = z.object({
  matchLabels: labels,
  matchExpressions: z
    .array(
      z.object({ key: z.string(), operator: z.string(), values: z.array(z.string()).default([]) }),
    )
    .default([]),
});

type Selector = z.infer<typeof selector>;

const policyPeer = z.object({
  podSelector: selector.optional(),
  namespaceSelector: selector.optional(),
  ipBlock: z.object({ cidr: z.string() }).optional(),
});

const networkPolicy = z.object({
  spec: z.object({
    podSelector: selector.default({ matchLabels: {}, matchExpressions: [] }),
    policyTypes: z.array(z.enum(['Ingress', 'Egress'])).optional(),
    ingress: z.array(z.object({ from: z.array(policyPeer).optional() })).optional(),
    egress: z.array(z.object({ to: z.array(policyPeer).optional() })).optional(),
  }),
});

const podTemplate = z.object({
  spec: z.object({
    template: z.object({ metadata: z.object({ labels }).default({ labels: {} }) }),
  }),
});

/** Kubernetes labels every namespace with its own name. */
const NAME_LABEL = 'kubernetes.io/metadata.name';

/** Kubernetes' selector operators: anything else selects nothing. */
const OPERATORS = new Set(['In', 'NotIn', 'Exists', 'DoesNotExist']);

/** Whether a label's value meets one selector expression. */
function holds(operator: string, value: string | undefined, values: string[]): boolean {
  switch (operator) {
    case 'In':
      return value !== undefined && values.includes(value);
    case 'NotIn':
      return value === undefined || !values.includes(value);
    case 'Exists':
      return value !== undefined;
    case 'DoesNotExist':
      return value === undefined;
    default:
      return false;
  }
}

/** Whether a selector picks a set of labels: every label it names, and every expression. */
const selects = (wanted: Selector | undefined, have: Record<string, string>) =>
  wanted === undefined ||
  (Object.entries(wanted.matchLabels).every(([key, value]) => have[key] === value) &&
    wanted.matchExpressions.every(({ key, operator, values }) =>
      holds(operator, have[key], values),
    ));

/** A selector that picks everything. */
const empty = (wanted: Selector | undefined) =>
  wanted === undefined ||
  (Object.keys(wanted.matchLabels).length === 0 && wanted.matchExpressions.length === 0);

export interface KubernetesNetworkRead {
  file: NetworkFile;
  /** What the manifests hold that the file cannot say, in words. */
  warnings: string[];
}

/** Who may reach each workload, and what it may reach. `services` maps a workload name to the catalog's. */
export function readNetwork(
  texts: string[],
  services: Record<string, string> = {},
): KubernetesNetworkRead {
  const resources = texts
    .flatMap((text) => parseAllDocuments(text).map((document) => document.toJS()))
    .flatMap((document) => {
      const parsed = manifest.safeParse(document);

      return parsed.success ? [parsed.data] : [];
    });

  const warnings: string[] = [];
  const namespaceOf = (resource: Manifest) => resource.metadata.namespace ?? 'default';

  const namespaceLabels = new Map(
    resources.flatMap((resource) =>
      resource.kind === 'Namespace'
        ? [[resource.metadata.name, resource.metadata.labels] as const]
        : [],
    ),
  );

  const labelsOfNamespace = (name: string) => ({
    ...namespaceLabels.get(name),
    [NAME_LABEL]: name,
  });

  const pods = resources.flatMap((resource) => {
    if (resource.kind !== 'Deployment' && resource.kind !== 'StatefulSet') return [];

    const parsed = podTemplate.safeParse(resource);

    return [
      {
        service: services[resource.metadata.name] ?? resource.metadata.name,
        namespace: namespaceOf(resource),
        labels: parsed.success ? parsed.data.spec.template.metadata.labels : {},
      },
    ];
  });

  const policies = resources.flatMap((resource) => {
    if (resource.kind !== 'NetworkPolicy') return [];

    const parsed = networkPolicy.safeParse(resource);

    if (!parsed.success) {
      warnings.push(`NetworkPolicy ${namespaceOf(resource)}/${resource.metadata.name}: not read`);

      return [];
    }

    return [
      { name: resource.metadata.name, namespace: namespaceOf(resource), ...parsed.data.spec },
    ];
  });

  /** The peers one `from` or `to` entry allows, from the policy in `namespace`. */
  const peersOf = (
    entry: z.infer<typeof policyPeer>,
    namespace: string,
    where: string,
  ): NetworkPeer[] | 'anyone' => {
    const unknown = [entry.podSelector, entry.namespaceSelector].flatMap(
      (wanted) => wanted?.matchExpressions.filter(({ operator }) => !OPERATORS.has(operator)) ?? [],
    );

    if (unknown.length > 0)
      warnings.push(
        `${where}: ${unknown.map(({ operator }) => operator).join(', ')} is not a selector operator, so that peer lets nothing through here`,
      );

    if (entry.ipBlock)
      return ['0.0.0.0/0', '::/0'].includes(entry.ipBlock.cidr) ? 'anyone' : [{ external: true }];

    // Every pod in every namespace: anyone in the cluster.
    if (entry.namespaceSelector && empty(entry.namespaceSelector) && empty(entry.podSelector))
      return 'anyone';

    // The namespaces this entry covers: its own without a namespace selector. One
    // these files do not declare, such as the gateway's, is known by its name label.
    const named = [
      entry.namespaceSelector?.matchLabels[NAME_LABEL],
      ...(entry.namespaceSelector?.matchExpressions.flatMap(({ key, operator, values }) =>
        key === NAME_LABEL && operator === 'In' ? values : [],
      ) ?? []),
    ].filter((name): name is string => name !== undefined);

    const namespaces = !entry.namespaceSelector
      ? [namespace]
      : [...new Set([...namespaceLabels.keys(), ...pods.map((p) => p.namespace), ...named])].filter(
          (candidate) => selects(entry.namespaceSelector, labelsOfNamespace(candidate)),
        );

    return namespaces.flatMap((candidate): NetworkPeer[] => {
      const inside = pods.filter((pod) => pod.namespace === candidate);

      // A whole namespace, or one whose workloads these files do not hold, such as the gateway's.
      if (empty(entry.podSelector)) return [{ namespace: candidate }];

      // Some pods of a namespace these files hold no workloads of, such as the
      // gateway's: which ones cannot be told, so never all of it.
      if (inside.length === 0) return [{ namespace: candidate, some: true }];

      return inside.flatMap((pod) =>
        selects(entry.podSelector, pod.labels) ? [{ service: pod.service }] : [],
      );
    });
  };

  const workloads: NetworkWorkload[] = pods.map((pod) => {
    const selecting = policies.filter(
      (policy) => policy.namespace === pod.namespace && selects(policy.podSelector, pod.labels),
    );

    const direction = (kind: 'Ingress' | 'Egress'): NetworkPeer[] | undefined => {
      // Without policyTypes, a policy restricts ingress, and egress too when it lists egress rules.
      const applying = selecting.filter((policy) =>
        (policy.policyTypes ?? ['Ingress', ...(policy.egress ? ['Egress'] : [])]).includes(kind),
      );

      if (applying.length === 0) return undefined;

      const rules = applying.flatMap((policy) =>
        (kind === 'Ingress' ? (policy.ingress ?? []) : (policy.egress ?? [])).map((rule) => ({
          peers: 'from' in rule ? rule.from : 'to' in rule ? rule.to : undefined,
          where: `NetworkPolicy ${policy.namespace}/${policy.name}`,
        })),
      );

      // A rule with no peers, missing or empty, lets everyone through.
      if (rules.some(({ peers }) => peers === undefined || peers.length === 0)) return undefined;

      const resolved = rules.flatMap(({ peers = [], where }) =>
        peers.map((entry) => peersOf(entry, pod.namespace, where)),
      );

      // Anyone, or the whole internet, opens the direction as surely as no policy does.
      if (resolved.some((peer) => peer === 'anyone')) return undefined;

      const peers = resolved.flatMap((peer) => (peer === 'anyone' ? [] : peer));

      return [...new Map(peers.map((p) => [JSON.stringify(p), p])).values()];
    };

    const ingress = direction('Ingress');
    const egress = direction('Egress');

    return {
      service: pod.service,
      namespace: pod.namespace,
      ...(ingress && { ingress }),
      ...(egress && { egress }),
    };
  });

  return { file: { workloads }, warnings };
}

/** A file as given, or every YAML file below a folder, in path order. */
async function manifestFiles(given: string): Promise<string[]> {
  if (!(await fs.stat(given)).isDirectory()) return [given];

  const entries = await fs.readdir(given, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

export async function runFromKubernetes(opts: {
  manifests: string[];
  root: string;
  service?: string[];
  check?: boolean;
}): Promise<number> {
  const services = Object.fromEntries(
    (opts.service ?? []).flatMap((pair) => {
      const [workload, catalog] = pair.split('=');

      return workload && catalog ? [[workload, catalog]] : [];
    }),
  );

  let read: KubernetesNetworkRead;

  try {
    const files = (await Promise.all(opts.manifests.map(manifestFiles))).flat();

    read = readNetwork(await Promise.all(files.map((file) => fs.readFile(file, 'utf8'))), services);
  } catch (error) {
    console.error(
      kleur.red(
        `✗ ${opts.manifests.join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

    return 1;
  }

  for (const warning of read.warnings) console.warn(kleur.yellow(`! ${warning}`));

  const root = path.resolve(opts.root);

  const source = opts.manifests
    .map((file) => path.relative(root, path.resolve(file)).split(path.sep).join('/'))
    .join(', ');

  const result = await writeNetworkFile(root, { ...read.file, source }, { check: opts.check });

  if (result === 'stale') {
    console.error(
      kleur.red('✗ autocatalog.network.json does not match the manifests: run ac from-kubernetes'),
    );

    return 1;
  }

  console.log(
    `${result === 'current' ? '✓ autocatalog.network.json is current' : '✓ wrote autocatalog.network.json'}: ${read.file.workloads.length} workloads`,
  );

  return 0;
}
