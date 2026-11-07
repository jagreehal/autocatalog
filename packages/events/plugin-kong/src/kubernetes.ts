import type { GatewayRoute } from 'autocatalog-core';
import { z } from 'zod';
import { AUTHENTICATION, authenticates } from './authentication';

// Kong on Kubernetes: routes are Gateway API HTTPRoutes, which any controller
// reads, and Kong adds its plugins as KongPlugin and KongClusterPlugin resources,
// attached by the `konghq.com/plugins` annotation on a route or a Service, or to
// every route by the label `global: "true"`.

const metadata = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
});

const manifest = z.looseObject({ apiVersion: z.string(), kind: z.string(), metadata });

type Manifest = z.infer<typeof manifest>;

const kongPlugin = z.looseObject({
  plugin: z.string(),
  disabled: z.boolean().default(false),
  config: z.looseObject({ anonymous: z.unknown().optional() }).optional(),
});

const match = z.object({
  path: z
    .object({
      type: z.enum(['Exact', 'PathPrefix', 'RegularExpression']).default('PathPrefix'),
      value: z.string().default('/'),
    })
    .default({ type: 'PathPrefix', value: '/' }),
  method: z.string().optional(),
});

const httpRoute = z.object({
  spec: z.object({
    parentRefs: z
      .array(z.object({ name: z.string(), namespace: z.string().optional() }))
      .default([]),
    rules: z
      .array(
        z.object({
          matches: z.array(match).default([{ path: { type: 'PathPrefix', value: '/' } }]),
          filters: z.array(z.object({ type: z.string() })).default([]),
          backendRefs: z
            .array(z.object({ name: z.string(), namespace: z.string().optional() }))
            .default([]),
        }),
      )
      .default([]),
  }),
});

const gateway = z.object({
  spec: z.object({
    listeners: z.array(
      z.object({
        allowedRoutes: z
          .object({
            namespaces: z
              .object({
                from: z.enum(['All', 'Same', 'Selector']).default('Same'),
                selector: z
                  .object({ matchLabels: z.record(z.string(), z.string()).default({}) })
                  .optional(),
              })
              .default({ from: 'Same' }),
          })
          .default({ namespaces: { from: 'Same' } }),
      }),
    ),
  }),
});

/** Whether parsed YAML documents are Kubernetes manifests rather than a decK file. */
export function isKubernetes(documents: unknown[]): boolean {
  return documents.some((document) => manifest.safeParse(document).success);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const METHODS = new Set<string>([
  'GET',
  'PUT',
  'POST',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
  'TRACE',
]);

type Method = NonNullable<GatewayRoute['methods']>[number];

const isMethod = (value: string): value is Method => METHODS.has(value);

const pluginNames = (resource: Manifest) =>
  (resource.metadata.annotations['konghq.com/plugins'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

/** {@link readKubernetes}'s answer. */
export interface KubernetesRead {
  routes: GatewayRoute[];
  /** What the manifests hold that the file cannot say, in words. */
  warnings: string[];
}

/**
 * The routes Kong serves from these manifests, and what they hold that the file
 * cannot say. `services` maps a Kubernetes Service name to the catalog's.
 */
export function readKubernetes(
  documents: unknown[],
  services: Record<string, string>,
): KubernetesRead {
  const resources = documents.flatMap((document) => {
    const parsed = manifest.safeParse(document);

    return parsed.success ? [parsed.data] : [];
  });

  const warnings: string[] = [];
  const of = (kind: string) => resources.filter((resource) => resource.kind === kind);
  const namespaceOf = (resource: Manifest) => resource.metadata.namespace ?? 'default';

  // A KongPlugin is found in the namespace of what names it; a KongClusterPlugin anywhere.
  const instance = (name: string, namespace: string) => {
    const found =
      of('KongPlugin').find((p) => p.metadata.name === name && namespaceOf(p) === namespace) ??
      of('KongClusterPlugin').find((p) => p.metadata.name === name);

    const parsed = found && kongPlugin.safeParse(found);

    return parsed?.success ? parsed.data : undefined;
  };

  const authenticating = (names: string[], namespace: string) =>
    names.flatMap((name) => {
      const plugin = instance(name, namespace);

      return plugin && AUTHENTICATION.has(plugin.plugin) ? [plugin] : [];
    });

  const global = of('KongClusterPlugin').flatMap((resource) => {
    const parsed = kongPlugin.safeParse(resource);

    return parsed.success &&
      resource.metadata.labels.global === 'true' &&
      AUTHENTICATION.has(parsed.data.plugin)
      ? [parsed.data]
      : [];
  });

  const namespaceLabels = new Map(
    of('Namespace').map((resource) => [resource.metadata.name, resource.metadata.labels]),
  );

  const gateways = new Map(
    of('Gateway').flatMap((resource) => {
      const parsed = gateway.safeParse(resource);

      return parsed.success
        ? [[`${namespaceOf(resource)}/${resource.metadata.name}`, parsed.data]]
        : [];
    }),
  );

  /** Why a route's namespace may not attach to its Gateway, or nothing when it may. */
  const refused = (namespace: string, ref: { name: string; namespace?: string | undefined }) => {
    const gatewayNamespace = ref.namespace ?? namespace;
    const parent = gateways.get(`${gatewayNamespace}/${ref.name}`);

    // Without the Gateway in these files there is nothing to check against.
    if (!parent)
      return gateways.size > 0
        ? `its Gateway ${gatewayNamespace}/${ref.name} is not in these files`
        : undefined;

    const allowed = parent.spec.listeners.some(({ allowedRoutes: { namespaces } }) => {
      if (namespaces.from === 'All') return true;

      if (namespaces.from === 'Same') return namespace === gatewayNamespace;

      const labels = namespaceLabels.get(namespace);

      return (
        labels !== undefined &&
        Object.entries(namespaces.selector?.matchLabels ?? {}).every(
          ([key, value]) => labels[key] === value,
        )
      );
    });

    return allowed
      ? undefined
      : `namespace ${namespace} may not attach routes to the Gateway ${gatewayNamespace}/${ref.name}`;
  };

  const routes: GatewayRoute[] = [];
  const taken = new Set<string>();

  for (const resource of of('HTTPRoute')) {
    const parsed = httpRoute.safeParse(resource);
    const namespace = namespaceOf(resource);
    const name = resource.metadata.name;

    if (!parsed.success) {
      warnings.push(
        `HTTPRoute ${namespace}/${name}: not read (${parsed.error.issues[0]?.message ?? 'invalid'})`,
      );
      continue;
    }

    const reasons = parsed.data.spec.parentRefs.flatMap((ref) => refused(namespace, ref) ?? []);

    if (
      parsed.data.spec.parentRefs.length > 0 &&
      reasons.length === parsed.data.spec.parentRefs.length
    ) {
      warnings.push(
        `HTTPRoute ${namespace}/${name} is not attached, so it was left out: ${reasons.join('; ')}`,
      );
      continue;
    }

    for (const [index, rule] of parsed.data.spec.rules.entries()) {
      const [backend, ...more] = rule.backendRefs;

      if (!backend) continue;

      if (more.length)
        warnings.push(
          `HTTPRoute ${namespace}/${name}: only its first backend, ${backend.name}, was read`,
        );

      const rewrites = rule.filters.filter((filter) => filter.type === 'URLRewrite');

      if (rewrites.length)
        warnings.push(
          `HTTPRoute ${namespace}/${name}: a URLRewrite filter changes the path, which the catalog does not follow`,
        );

      const backendNamespace = backend.namespace ?? namespace;

      const service = of('Service').find(
        (s) => s.metadata.name === backend.name && namespaceOf(s) === backendNamespace,
      );

      // Kong runs the most specific instance of each plugin: the route's, then the Service's, then the global one.
      const levels = [
        authenticating(pluginNames(resource), namespace),
        service ? authenticating(pluginNames(service), backendNamespace) : [],
        global,
      ];

      const auth = [...AUTHENTICATION].filter((plugin) => {
        const chosen = levels.map((level) => level.find((p) => p.plugin === plugin)).find(Boolean);

        return (
          chosen !== undefined &&
          authenticates({ enabled: !chosen.disabled, config: chosen.config })
        );
      });

      // One gateway route per method: each match carries its own.
      const byMethod = new Map<string, z.infer<typeof match>[]>();

      for (const entry of rule.matches) {
        const method = entry.method?.toUpperCase() ?? '*';

        byMethod.set(method, [...(byMethod.get(method) ?? []), entry]);
      }

      for (const [method, entries] of byMethod) {
        const paths = entries.flatMap(({ path }) =>
          path.type === 'PathPrefix' ? [path.value] : [],
        );

        // Kong matches a Gateway API regular expression against the whole path.
        const patterns = entries.flatMap(({ path }) =>
          path.type === 'Exact'
            ? [`${escape(path.value)}$`]
            : path.type === 'RegularExpression'
              ? [path.value.endsWith('$') ? path.value : `${path.value}$`]
              : [],
        );

        const base = [
          name,
          parsed.data.spec.rules.length > 1 ? String(index + 1) : '',
          byMethod.size > 1 ? method.toLowerCase() : '',
        ]
          .filter(Boolean)
          .join('-');

        const routeName = taken.has(base) ? `${namespace}.${base}` : base;

        taken.add(routeName);
        routes.push({
          name: routeName,
          service: services[backend.name] ?? backend.name,
          ...(paths.length > 0 && { paths }),
          ...(patterns.length > 0 && { patterns }),
          ...(isMethod(method) && { methods: [method] }),
          stripPath: resource.metadata.annotations['konghq.com/strip-path'] === 'true',
          auth,
        });
      }
    }
  }

  return { routes, warnings };
}
