import { z } from 'zod';

/** One MCP tool call where the trace also says which server it went to. */
export type McpCall = {
  /** Absent when a gateway made the call and the trace does not say for whom. */
  agent?: string | undefined;
  server: string;
  tool: string;
};

export type Observations = {
  agents: Set<string>;
  modelUsage: Map<string, Set<string>>;
  toolUsage: Map<string, Set<string>>;
  mcpCalls: McpCall[];
  spanCount: number;
};

// Only the fields drift detection reads; unknown keys are stripped. The
// document's structure must be right, but one attribute value of a type we do
// not read is that attribute absent, not the whole file rejected: exporters
// disagree on value encodings, and one odd span says nothing about the rest.
const OtlpAttributeSchema = z.object({
  key: z.string().optional(),
  value: z
    .object({
      stringValue: z.string().optional().catch(undefined),
      intValue: z.union([z.string(), z.number()]).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const OtlpSpanSchema = z.object({
  name: z.string().optional(),
  attributes: z.array(OtlpAttributeSchema).optional(),
});

const OtlpDocumentSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        resource: z.object({ attributes: z.array(OtlpAttributeSchema).optional() }).optional(),
        scopeSpans: z.array(z.object({ spans: z.array(OtlpSpanSchema).optional() })).optional(),
      }),
    )
    .optional(),
});

type OtlpAttribute = z.infer<typeof OtlpAttributeSchema>;

type OtlpSpan = z.infer<typeof OtlpSpanSchema>;

const findAttr = (attrs: OtlpAttribute[] | undefined, key: string): string | undefined => {
  if (!attrs) return undefined;
  const found = attrs.find((a) => a.key === key);
  const v = found?.value;

  if (!v) return undefined;

  if (v.stringValue !== undefined) return v.stringValue;

  if (v.intValue !== undefined) return String(v.intValue);

  return undefined;
};

const addToSet = <T>(map: Map<string, Set<T>>, key: string, value: T): void => {
  const set = map.get(key) ?? new Set<T>();
  set.add(value);
  map.set(key, set);
};

const DECLARED_AGENT_KEYS = ['agent.id', 'gen_ai.agent.id'] as const;

const AGENT_ID_KEYS = [...DECLARED_AGENT_KEYS, 'service.name'] as const;

const MODEL_KEYS = [
  'gen_ai.request.model',
  'gen_ai.response.model',
  'llm.request.model',
  'model',
] as const;

const TOOL_KEYS = ['tool.name', 'gen_ai.tool.name', 'mcp.tool.name', 'function.name'] as const;

const SERVER_KEYS = ['mcp.tool.integration', 'mcp.server.name', 'server.address'] as const;

/** Executor names a tool by its full address: `tools.<integration>.<owner>.<connection>.<tool>`. */
const ADDRESS = /^tools\.([^.]+)\.[^.]+\.[^.]+\.(.+)$/;

/** Marks a span from a gateway, whose `service.name` is the gateway, never an agent. */
const GATEWAY_KEY = 'executor.tenant';

type McpToolRef = Pick<McpCall, 'tool'> & { server: string | undefined };

/** The server and bare tool name a span records, from its address or its attributes. */
const mcpCallOf = (span: OtlpSpan, raw: string): McpToolRef => {
  const [, integration, name] = ADDRESS.exec(raw) ?? [];

  if (integration && name) return { server: integration, tool: name };

  const server = firstAttr(span.attributes, SERVER_KEYS);

  return {
    server,
    tool: server && raw.startsWith(`${server}.`) ? raw.slice(server.length + 1) : raw,
  };
};

const firstAttr = (
  attrs: OtlpAttribute[] | undefined,
  keys: readonly string[],
): string | undefined => {
  for (const k of keys) {
    const v = findAttr(attrs, k);

    if (v) return v;
  }

  return undefined;
};

const looksLikeLlmSpan = (span: OtlpSpan): boolean => {
  const name = (span.name ?? '').toLowerCase();

  if (/\b(llm|gen_ai|chat\.completion|completion|inference)\b/.test(name)) return true;

  return firstAttr(span.attributes, MODEL_KEYS) !== undefined;
};

const looksLikeToolSpan = (span: OtlpSpan): boolean => {
  const name = (span.name ?? '').toLowerCase();

  if (/\b(tool|function|call)\b/.test(name)) return true;

  return firstAttr(span.attributes, TOOL_KEYS) !== undefined;
};

export const parseOtlpJson = (raw: string): Observations => {
  const data = OtlpDocumentSchema.parse(JSON.parse(raw));

  const obs: Observations = {
    agents: new Set(),
    modelUsage: new Map(),
    toolUsage: new Map(),
    mcpCalls: [],
    spanCount: 0,
  };

  const calls = new Map<string, McpCall>();

  for (const rs of data.resourceSpans ?? []) {
    const spans = (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []);
    const gateway = spans.some((span) => findAttr(span.attributes, GATEWAY_KEY) !== undefined);
    const agentKeys = gateway ? DECLARED_AGENT_KEYS : AGENT_ID_KEYS;
    const resourceAgentId = firstAttr(rs.resource?.attributes, agentKeys);

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const spanAttrs = span.attributes;
        const agentId = firstAttr(spanAttrs, agentKeys) ?? resourceAgentId;

        if (looksLikeToolSpan(span)) {
          const raw = firstAttr(spanAttrs, TOOL_KEYS);
          const call = raw ? mcpCallOf(span, raw) : undefined;

          if (call?.server) {
            const entry = { agent: agentId, server: call.server, tool: call.tool };
            calls.set(JSON.stringify(entry), entry);
          }
        }

        if (!agentId) continue;

        obs.agents.add(agentId);
        obs.spanCount += 1;

        if (looksLikeLlmSpan(span)) {
          const modelId = firstAttr(spanAttrs, MODEL_KEYS);

          if (modelId) addToSet(obs.modelUsage, agentId, modelId);
        }

        if (looksLikeToolSpan(span)) {
          const raw = firstAttr(spanAttrs, TOOL_KEYS);

          if (raw) addToSet(obs.toolUsage, agentId, mcpCallOf(span, raw).tool);
        }
      }
    }
  }

  obs.mcpCalls = [...calls.values()];

  return obs;
};
