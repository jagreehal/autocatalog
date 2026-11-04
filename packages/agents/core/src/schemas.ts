import { z } from 'zod';

export const AUTOCATALOG_ENTITY_FILE = 'autocatalog.json';

export const Status = z.enum(['proposed', 'active', 'deprecated', 'retired']);

export const Risk = z.enum(['low', 'medium', 'high']);

export const SideEffect = z.enum([
  'unknown',
  'read-only',
  'mutating',
  'destructive',
  'external-write',
]);

const Base = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  /** Additional co-owners beyond the primary `owner`. */
  owners: z.array(z.string().min(1)).optional(),
  status: Status.default('active'),
  description: z.string().optional(),
  version: z.string().optional(),
  discovery: z
    .object({
      confidence: z.enum(['inferred', 'reviewed']).default('inferred'),
      adapter: z.string().min(1),
      sources: z
        .array(
          z.object({
            file: z.string().min(1),
            line: z.number().int().positive(),
            symbol: z.string().min(1).optional(),
          }),
        )
        .default([]),
      needs_review: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

/** The full owner list for an entity: primary owner first, co-owners after, de-duplicated. */
export const ownersOf = (e: { owner: string; owners?: string[] }): string[] => [
  ...new Set([e.owner, ...(e.owners ?? [])]),
];

export const Protocol = z.enum(['mcp', 'http', 'function']);

/** Whether the company wrote the server or runs someone else's. */
export const McpServerOrigin = z.enum(['built', 'third-party', 'unknown']);

export const McpTransport = z.enum(['stdio', 'http']);

/** A value read from the environment when a snapshot runs, so the file holds only its name. */
const EnvReference = z
  .string()
  .regex(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/, 'name an environment variable as ${NAME}');

/** How `ac agents snapshot` reaches this server. */
export const McpSnapshotConfigSchema = z.object({
  /** The identity the snapshot is taken as. */
  connection: z.string().min(1).optional(),
  /** This server's integration in Executor, when its name differs. */
  integration: z.string().min(1).optional(),
  headers: z.record(z.string(), EnvReference).optional(),
  env: z.record(z.string(), EnvReference).optional(),
  /** The program to start, for a stdio server of your own. Runs with `--allow-stdio`. */
  command: z.array(z.string().min(1)).min(1).optional(),
});

export const McpPackageSchema = z.object({
  registry: z.enum(['npm', 'pypi', 'oci']),
  name: z.string().min(1),
  /** Absent when the config runs whatever is newest. */
  version: z.string().min(1).optional(),
});

const RepositorySchema = z.object({
  /** Stable graph identity. Defaults to the URL repository name when omitted. */
  id: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  url: z.string().url().optional(),
});

export const ExpectedTrafficSchema = z.object({
  invocations_per_day: z.number().nonnegative(),
  avg_input_tokens: z.number().int().nonnegative(),
  avg_output_tokens: z.number().int().nonnegative(),
});

/**
 * Events an Agent or Tool publishes, as the event catalog names them:
 * `domain/id` (e.g. `payments/payment.completed`), or a bare id when it is
 * unique. A producer emits the whole payload, so there are no fields to name.
 */
const EventRefs = z.array(z.string().min(1)).optional();

/**
 * Events an Agent or Tool reacts to, each named as `produces` names one, with
 * the payload fields it reads (dotted, `[]` for array items: `items[].sku`)
 * when it says. Without `fields`, drift assumes every change reaches it.
 */
const ConsumedEvents = z
  .array(
    z.object({
      event: z.string().min(1),
      fields: z.array(z.string().min(1)).optional(),
    }),
  )
  .optional();

export const AgentSchema = Base.extend({
  kind: z.literal('agent').default('agent'),
  model: z.string().min(1),
  tools: z.array(z.string()).default([]),
  /** MCP servers this agent can call in full, for when naming each tool is not worth it. */
  servers: z.array(z.string()).default([]),
  policies: z.array(z.string()).default([]),
  domain: z.string().optional(),
  risk: Risk.default('medium'),
  repository: RepositorySchema.optional(),
  prompts: z
    .object({
      system: z.string().min(1),
    })
    .optional(),
  expected_traffic: ExpectedTrafficSchema.optional(),
  produces: EventRefs,
  consumes: ConsumedEvents,
});

export type ExpectedTraffic = z.infer<typeof ExpectedTrafficSchema>;

export const ToolSchema = Base.extend({
  kind: z.literal('tool').default('tool'),
  side_effects: SideEffect.default('read-only'),
  risk: Risk.default('low'),
  protocol: Protocol.optional(),
  schema: z.string().optional(),
  domain: z.string().optional(),
  /** The `mcp-server` that exposes this tool. */
  server: z.string().min(1).optional(),
  /** The name the server calls this tool, when the id differs. */
  mcp_name: z.string().min(1).optional(),
  produces: EventRefs,
  consumes: ConsumedEvents,
});

/**
 * An MCP server the company builds or uses. Its id comes from its endpoint, so
 * repositories that name one server differently still share one entry. Holds
 * the address and package only: arguments, headers and environment values stay
 * in the config they came from.
 */
export const McpServerSchema = Base.extend({
  kind: z.literal('mcp-server').default('mcp-server'),
  origin: McpServerOrigin.default('unknown'),
  transport: McpTransport,
  url: z.string().url().optional(),
  package: McpPackageSchema.optional(),
  command: z.string().min(1).optional(),
  repository: RepositorySchema.optional(),
  /** Every version configs run, when they disagree. */
  versions: z.array(z.string().min(1)).optional(),
  /** The repositories that configure it, when one catalog covers many. */
  used_by: z.array(z.string().min(1)).optional(),
  snapshot: McpSnapshotConfigSchema.optional(),
});

export const ModelSchema = Base.extend({
  kind: z.literal('model').default('model'),
  provider: z.string().min(1),
  model_id: z.string().min(1),
  context_window: z.number().int().positive().optional(),
  cost_per_million_input_tokens: z.number().nonnegative().optional(),
  cost_per_million_output_tokens: z.number().nonnegative().optional(),
});

export const WorkflowStep = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  on: z.string().optional(),
});

export const WorkflowSchema = Base.extend({
  kind: z.literal('workflow').default('workflow'),
  agents: z.array(z.string()).min(1),
  flow: z.array(WorkflowStep).default([]),
  domain: z.string().optional(),
});

export const DomainSchema = Base.extend({
  kind: z.literal('domain').default('domain'),
});

export const EvalSchema = Base.extend({
  kind: z.literal('eval').default('eval'),
  target: z.string().min(1),
  cases: z.string().optional(),
});

export const PolicySchema = Base.extend({
  kind: z.literal('policy').default('policy'),
  scope: z.string().optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export type Tool = z.infer<typeof ToolSchema>;

export type McpServer = z.infer<typeof McpServerSchema>;

export type McpPackage = z.infer<typeof McpPackageSchema>;

export type SideEffect = z.infer<typeof SideEffect>;

export type Risk = z.infer<typeof Risk>;

export type Model = z.infer<typeof ModelSchema>;

export type Workflow = z.infer<typeof WorkflowSchema>;

export type Domain = z.infer<typeof DomainSchema>;

export type Eval = z.infer<typeof EvalSchema>;

export type Policy = z.infer<typeof PolicySchema>;

export const EntityKindSchema = z.enum([
  'agent',
  'tool',
  'mcp-server',
  'model',
  'workflow',
  'domain',
  'eval',
  'policy',
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

export type Entity = Agent | Tool | McpServer | Model | Workflow | Domain | Eval | Policy;

export const ENTITY_KINDS: readonly EntityKind[] = EntityKindSchema.options;

export const SCHEMA_BY_KIND = {
  agent: AgentSchema,
  tool: ToolSchema,
  'mcp-server': McpServerSchema,
  model: ModelSchema,
  workflow: WorkflowSchema,
  domain: DomainSchema,
  eval: EvalSchema,
  policy: PolicySchema,
} as const;

export const DIR_BY_KIND: Record<EntityKind, string> = {
  agent: 'agents',
  tool: 'tools',
  'mcp-server': 'mcp-servers',
  model: 'models',
  workflow: 'workflows',
  domain: 'domains',
  eval: 'evals',
  policy: 'policies',
};
