import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EntityKindSchema, type Catalog } from 'autocatalog-agents-core';
import {
  audit,
  cost,
  describeEntity,
  drift,
  findBy,
  impactEntity,
  listEntities,
  searchEntities,
} from './tools.js';

const RefSchema = z
  .string()
  .min(3)
  .regex(/^[a-z]+\/[a-zA-Z0-9_-]+$/, 'expected <kind>/<id>');

const asText = <T>(data: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const asError = (cause: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: cause instanceof Error ? cause.message : String(cause) },
  ],
});

export const createServer = (catalog: Catalog): McpServer => {
  const server = new McpServer({ name: 'autocatalog-agents', version: '0.0.0' });

  server.registerTool(
    'list',
    {
      title: 'List entities of a kind',
      description:
        'Enumerate every entity of a given kind (agent, tool, model, workflow, domain, eval, policy).',
      inputSchema: { kind: EntityKindSchema },
    },
    async ({ kind }) => {
      try {
        return asText(listEntities(catalog, kind));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'describe',
    {
      title: 'Describe one entity',
      description:
        'Return the full record (frontmatter + edges) for a single entity by "<kind>/<id>" ref.',
      inputSchema: { ref: RefSchema },
    },
    async ({ ref }) => {
      try {
        return asText(describeEntity(catalog, ref));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'impact',
    {
      title: 'Impact analysis',
      description:
        'Show what an entity depends on and what depends on it, and for an agent or tool the events it produces and consumes. Use this before changing a prompt, tool, model, or policy. For who consumes an event, ask the event catalog MCP server (assess_impact): it includes agents.',
      inputSchema: { ref: RefSchema },
    },
    async ({ ref }) => {
      try {
        return asText(impactEntity(catalog, ref));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Full-text search',
      description:
        "Substring match across every entity's id, name, description, and owner. Returns summarised hits.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      try {
        return asText(searchEntities(catalog, query));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'find_by',
    {
      title: 'Find entities by attribute',
      description:
        'Return entities where a top-level attribute equals (or array-includes) the given value. Examples: attribute=owner value=support-platform; attribute=tools value=issue-refund; attribute=risk value=high.',
      inputSchema: { attribute: z.string().min(1), value: z.string().min(1) },
    },
    async ({ attribute, value }) => {
      try {
        return asText(findBy(catalog, attribute, value));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'cost',
    {
      title: 'Cost estimate / rollup',
      description:
        "Estimated monthly cost for one Agent (pass `agent`), or a rollup across the catalog by domain/owner/model (pass `by`). With neither, returns just the catalog total. Uses each Agent's declared `expected_traffic` and the referenced Model's `cost_per_million_*` rates.",
      inputSchema: {
        agent: z.string().optional(),
        by: z.enum(['domain', 'owner', 'model']).optional(),
      },
    },
    async ({ agent, by }) => {
      try {
        return asText(cost(catalog, { agent, by }));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'audit',
    {
      title: 'Run the catalog audit',
      description:
        'Run the built-in audit ruleset (high-risk agents without evals, agents using destructive tools without policies, cost-unestimated agents, orphan tools/models/policies, missing prompts, missing domains). Optionally filter to findings at or above a minimum severity (P0 strictest). Returns counts and a sorted finding list.',
      inputSchema: {
        minSeverity: z.enum(['P0', 'P1', 'P2']).optional(),
      },
    },
    async ({ minSeverity }) => {
      try {
        return asText(audit(catalog, { minSeverity }));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'drift',
    {
      title: 'Detect drift between observed traces and the declared catalog',
      description:
        'Load an OTLP JSON file (from autotel, OpenLLMetry, or any OTel emitter), extract observed agent → tool / agent → model edges, and diff against the declared catalog. Returns drifts: undeclared tools called in production, model mismatches, agents that emit traces but are not in the catalog, declared tools never observed.',
      inputSchema: {
        file: z.string().min(1),
      },
    },
    async ({ file }) => {
      try {
        return asText(await drift(catalog, { file }));
      } catch (e) {
        return asError(e);
      }
    },
  );

  return server;
};
