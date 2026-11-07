import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { shownName } from './consumes';
import { readOptionalResourceJson, writeResourceFile } from './resource-files';
import { resourceKey, type ResourceGraph } from './resource-graph';

/**
 * Who may reach whom on the network, written by a plugin such as
 * `autocatalog-plugin-kubernetes` from the platform's own policy and committed,
 * so the site checks calls against it without the cluster.
 */
export const NETWORK_FILE = 'autocatalog.network.json';

const NAME = /^[A-Za-z0-9][\w.:-]{0,199}$/;

const SERVICE = /^[A-Za-z0-9][\w.-]{0,199}$/;

/**
 * One side a policy lets through: a service, everything in a namespace, some of
 * a namespace the policy files do not describe (`some`), or outside the cluster.
 */
const peer = z.union([
  z.strictObject({ service: z.string().regex(SERVICE, 'a service name') }),
  z.strictObject({ namespace: z.string().regex(NAME, 'a namespace') }),
  z.strictObject({ namespace: z.string().regex(NAME, 'a namespace'), some: z.literal(true) }),
  z.strictObject({ external: z.literal(true) }),
]);

export type NetworkPeer = z.infer<typeof peer>;

const workload = z.strictObject({
  service: z.string().regex(SERVICE, 'a service name'),
  namespace: z.string().regex(NAME, 'a namespace').optional(),
  /** Who may connect to it; absent when anyone may. */
  ingress: z.array(peer).optional(),
  /** What it may connect to; absent when anything. */
  egress: z.array(peer).optional(),
});

export type NetworkWorkload = z.infer<typeof workload>;

export const networkFileSchema = z.strictObject({
  $schema: z.string().optional(),
  /** The configuration it was read from, from the repository's root. */
  source: z.string().optional(),
  workloads: z.array(workload),
});

export type NetworkFile = z.infer<typeof networkFileSchema>;

/** The repository's {@link NETWORK_FILE}, or nothing when it has none. */
export async function readNetworkFile(root: string): Promise<NetworkFile | undefined> {
  const value = await readOptionalResourceJson(path.join(root, NETWORK_FILE), { root });

  if (value === undefined) return undefined;

  const parsed = networkFileSchema.safeParse(value);

  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];

  throw new Error(
    `${NETWORK_FILE}: ${issue?.path.length ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'invalid'}`,
  );
}

/** Writes the file a plugin read, workloads in name order. `check` compares instead of writing. */
export async function writeNetworkFile(
  root: string,
  input: NetworkFile,
  options: { check?: boolean | undefined } = {},
): Promise<'written' | 'current' | 'stale'> {
  const committed = await readNetworkFile(root).catch(() => undefined);

  const file = networkFileSchema.parse({
    ...(committed?.$schema && { $schema: committed.$schema }),
    ...input,
    workloads: [...input.workloads].sort((a, b) => a.service.localeCompare(b.service)),
  });

  const text = `${JSON.stringify(file, null, 2)}\n`;
  const out = path.join(root, NETWORK_FILE);

  if (options.check)
    return (await fs.readFile(out, 'utf8').catch(() => undefined)) === text ? 'current' : 'stale';

  await writeResourceFile(out, text);

  return 'written';
}

/** Whether a list of peers lets `other` through, or nothing when it cannot tell. */
function lets(peers: NetworkPeer[], other: NetworkWorkload | undefined): boolean | undefined {
  if (!other) return undefined;

  const inNamespace = (p: NetworkPeer) =>
    'namespace' in p && other.namespace !== undefined && p.namespace === other.namespace;

  if (
    peers.some(
      (p) => ('service' in p && p.service === other.service) || (inNamespace(p) && !('some' in p)),
    )
  )
    return true;

  // Some of its namespace may: whether this workload is among them cannot be told.
  return peers.some((p) => inNamespace(p) && 'some' in p) ? undefined : false;
}

/**
 * Calls checked against every repository's network policy. A call between two
 * services either policy does not let through is said, whether the call was
 * declared or traced: one was promised, the other happened. A service a
 * gateway exposes, but whose pods any workload may reach, is said too: a caller
 * can skip the gateway, and its authentication with it. A call involving a
 * service no policy file describes is not judged. A service two repositories
 * describe is said, and every description is checked, so a looser copy in
 * another repository can never hide what a stricter one finds.
 */
export async function withNetworkPolicies(
  composed: ResourceGraph,
  repositories: { repository: string; dir: string }[],
  onFinding: (message: string) => void,
): Promise<void> {
  const workloads = new Map<string, (NetworkWorkload & { repository: string })[]>();

  for (const { repository, dir } of repositories) {
    let file: NetworkFile | undefined;

    try {
      file = await readNetworkFile(dir);
    } catch (error) {
      onFinding(`${repository}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (const entry of file?.workloads ?? [])
      workloads.set(entry.service, [
        ...(workloads.get(entry.service) ?? []),
        { ...entry, repository },
      ]);
  }

  if (workloads.size === 0) return;

  for (const [service, described] of workloads) {
    const by = [...new Set(described.map(({ repository }) => repository))].sort();

    if (by.length > 1)
      onFinding(
        `${shownName(service)} is described by the network policy of ${by.join(' and ')}: each is checked`,
      );
  }

  const byKey = new Map(
    composed.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const said = new Set<string>();

  const say = (repository: string, message: string) => {
    const line = `${repository}: ${NETWORK_FILE}: ${message}`;

    if (!said.has(line)) onFinding(line);

    said.add(line);
  };

  // The service behind each endpoint, so a call to an operation is a call to its service.
  const serviceOf = new Map<string, string>();

  for (const { type, from, to } of composed.relationships)
    if (type === 'exposedBy' && from.kind === 'endpoint' && to.kind === 'service')
      serviceOf.set(resourceKey(from), to.id);

  for (const { type, from, to, provenance } of composed.relationships) {
    if (type !== 'calls' || from.kind !== 'service') continue;

    const callee = to.kind === 'service' ? to.id : serviceOf.get(resourceKey(to));

    if (!callee || callee === from.id) continue;

    const callers = workloads.get(from.id) ?? [];
    const targets = workloads.get(callee) ?? [];
    const how = provenance === 'observed' ? 'was seen calling' : 'calls';

    for (const target of targets)
      for (const caller of callers.length > 0 ? callers : [undefined])
        if (target.ingress && lets(target.ingress, caller) === false)
          say(
            target.repository,
            `${shownName(from.id)} ${how} ${shownName(callee)}, and ${shownName(callee)}'s network policy does not let ${shownName(from.id)} reach it`,
          );

    for (const caller of callers)
      for (const target of targets.length > 0 ? targets : [undefined])
        if (caller.egress && lets(caller.egress, target) === false)
          say(
            caller.repository,
            `${shownName(from.id)} ${how} ${shownName(callee)}, and ${shownName(from.id)}'s network policy does not let it reach ${shownName(callee)}`,
          );
  }

  for (const { type, from, to } of composed.relationships) {
    if (type !== 'exposedBy' || to.kind !== 'gateway' || from.kind !== 'endpoint') continue;

    const service = serviceOf.get(resourceKey(from));

    for (const target of service ? (workloads.get(service) ?? []) : [])
      if (!target.ingress && byKey.has(resourceKey(to)))
        say(
          target.repository,
          `${shownName(target.service)} is exposed through ${shownName(to.id)}, and its network policy lets any workload reach it directly`,
        );
  }
}
