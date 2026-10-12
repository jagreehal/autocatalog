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
  produces: EventRefs,
  consumes: ConsumedEvents,
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

export type Model = z.infer<typeof ModelSchema>;

export type Workflow = z.infer<typeof WorkflowSchema>;

export type Domain = z.infer<typeof DomainSchema>;

export type Eval = z.infer<typeof EvalSchema>;

export type Policy = z.infer<typeof PolicySchema>;

export const EntityKindSchema = z.enum([
  'agent',
  'tool',
  'model',
  'workflow',
  'domain',
  'eval',
  'policy',
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

export type Entity = Agent | Tool | Model | Workflow | Domain | Eval | Policy;

export const ENTITY_KINDS: readonly EntityKind[] = EntityKindSchema.options;

export const SCHEMA_BY_KIND = {
  agent: AgentSchema,
  tool: ToolSchema,
  model: ModelSchema,
  workflow: WorkflowSchema,
  domain: DomainSchema,
  eval: EvalSchema,
  policy: PolicySchema,
} as const;

export const DIR_BY_KIND: Record<EntityKind, string> = {
  agent: 'agents',
  tool: 'tools',
  model: 'models',
  workflow: 'workflows',
  domain: 'domains',
  eval: 'evals',
  policy: 'policies',
};
