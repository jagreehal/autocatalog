import fs from 'node:fs/promises';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonObjectSchema } from 'autocatalog-core';
import { z } from 'zod';
import {
  type CatalogSnapshot,
  listEvents,
  describeEvent,
  getSchema,
  getExamples,
  searchEvents,
  findEventsBy,
  getLlmText,
  askArchitecture,
  searchFieldsInCatalog,
  assessImpact,
  catalogStatus,
  checkChange,
  investigationBundle,
  taskContextFor,
  type CompanySite,
} from './tools.js';
import { designSchema } from 'autocatalog-docs-core';
import { catalogMap, describeMap, draftMap } from './map.js';
import { define } from './model.js';

/** The view a host draws `show_map` in: built beside the server as one HTML file. */
const MAP_VIEW = 'ui://autocatalog/map.html';

const asText = <T>(data: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});

const asError = (cause: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: cause instanceof Error ? cause.message : String(cause) },
  ],
});

export function createServer(catalog: CatalogSnapshot, site?: CompanySite): McpServer {
  const server = new McpServer({ name: 'autocatalog', version: '0.0.1' });

  server.registerTool(
    'task_context',
    {
      title: 'Context for a task',
      description:
        'Call this before planning a change or answering how something works. Describe the task in the words the team uses ("add partial refunds", "how does KYC work"): glossary terms and their aliases lead to what implements them. Returns the vocabulary it matched, the services, contracts, decision records, runbooks and owners connected to it, how each relationship is known (declared, observed in traces, or inferred), and gaps: what the catalog could not establish. Cite the items you rely on, and say the gaps out loud instead of filling them in.',
      inputSchema: {
        task: z.string().min(1),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Most items per list (default 12). When the answer has `omitted`, call again with a higher limit.',
          ),
      },
    },
    async ({ task, limit }) => {
      try {
        return asText(await taskContextFor(catalog, task, site, limit ? { limit } : {}));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'list_events',
    {
      title: 'List events in the catalog',
      description: 'List all events in the catalog. Optionally filter by domain.',
      inputSchema: { domain: z.string().optional() },
    },
    async ({ domain }) => {
      try {
        return asText(listEvents(catalog, domain));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'describe_event',
    {
      title: 'Describe an event',
      description:
        'Return the full record for a single event including schema and examples. Pass the event id (e.g. "payment.completed") or "domain/id" (e.g. "payments/payment.completed").',
      inputSchema: { ref: z.string().min(1) },
    },
    async ({ ref }) => {
      try {
        return asText(describeEvent(catalog, ref));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Search events',
      description:
        'Full-text search across event ids, names, summaries, domains, producers, consumers, tags, and descriptions.',
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      try {
        return asText(searchEvents(catalog, query));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'find_by',
    {
      title: 'Find events by attribute',
      description:
        'Find events where a top-level attribute equals (or array-includes) the given value. Examples: attribute=domain value=payments; attribute=status value=deprecated; attribute=producers value=PaymentService; attribute=tags value=critical.',
      inputSchema: {
        attribute: z.string().min(1),
        value: z.string().min(1),
      },
    },
    async ({ attribute, value }) => {
      try {
        return asText(findEventsBy(catalog, attribute, value));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Get the JSON Schema for an event',
      description: 'Return the JSON Schema (properties, types, required fields) for an event.',
      inputSchema: { ref: z.string().min(1) },
    },
    async ({ ref }) => {
      try {
        return asText(getSchema(catalog, ref));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'get_examples',
    {
      title: 'Get example payloads for an event',
      description: 'Return example JSON payloads for an event. Optionally filter by example name.',
      inputSchema: {
        ref: z.string().min(1),
        name: z.string().optional(),
      },
    },
    async ({ ref, name }) => {
      try {
        return asText(getExamples(catalog, ref, name));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'get_llm_text',
    {
      title: 'Get LLM-friendly event text',
      description:
        'Return event(s) formatted as markdown text suitable for LLM context windows. Pass an event ref for a single event, or omit for a catalog-level summary.',
      inputSchema: { ref: z.string().optional() },
    },
    async ({ ref }) => {
      try {
        return asText(getLlmText(catalog, ref));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'ask_architecture',
    {
      title: 'Ask the architecture',
      description:
        'Answer from the catalog and point at the same material the site serves: /llms.txt, markdown twins, and /catalog.json. Optional query narrows the matches.',
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }) => {
      try {
        return asText(askArchitecture(catalog, query));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'search_fields',
    {
      title: 'Search schema fields across events',
      description:
        'Find which events carry a field path and which consumers it reaches. Omit query to list every indexed field (most-used first). Set conflictsOnly to surface fields whose type or requiredness disagrees between events.',
      inputSchema: {
        query: z.string().optional(),
        conflictsOnly: z.boolean().optional(),
      },
    },
    async ({ query, conflictsOnly }) => {
      try {
        return asText(searchFieldsInCatalog(catalog, query, conflictsOnly));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'assess_impact',
    {
      title: 'Who a change to this event reaches',
      description:
        'Before editing a contract, find out who receives this event, whether the field travels through other events to other consumers, whether any of those events disagree about its type, and whether the catalog is guessing. Pass a field path to narrow to one field. Returns a deduplicated notify list.',
      inputSchema: {
        ref: z.string().min(1),
        field: z.string().optional(),
      },
    },
    async ({ ref, field }) => {
      try {
        return asText(assessImpact(catalog, ref, field));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'check_change',
    {
      title: 'What a proposed schema breaks',
      description:
        'Classify a proposed JSON Schema for an event against the one the catalog holds. Returns findings by severity (breaking, suspicious, additive, info), the consumers each breaking change reaches, and a notify list. This is the same classifier the CI drift gate runs, so the answer matches what the pull request would say.',
      inputSchema: {
        ref: z.string().min(1),
        schema: jsonObjectSchema,
      },
    },
    async ({ ref, schema }) => {
      try {
        return asText(checkChange(catalog, ref, schema));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'catalog_status',
    {
      title: 'What this catalog is, and whether it can still be believed',
      description:
        'Return the size and shape of the catalog plus its freshness: the revision it was generated from, the revision the working tree is on now, and whether either has moved. Call this first when the answer will be acted on. A stale catalog describes code that is no longer there.',
      inputSchema: {},
    },
    async () => {
      try {
        return asText(catalogStatus(catalog));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'get_investigation_bundle',
    {
      title: 'Investigate an event with autotel-mcp',
      description:
        'Return a bounded catalog and runtime evidence bundle with impact, optional proposed-schema compatibility, and capability-aware handoff queries for a connected autotel-mcp server. Does not query telemetry itself. Confirm backend, environment, release and service mappings before using trace references.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        ref: z.string().min(1),
        field: z.string().optional(),
        schema: jsonObjectSchema.optional(),
      },
    },
    async ({ ref, field, schema }) => {
      try {
        return asText(investigationBundle(catalog, ref, field, schema));
      } catch (e) {
        return asError(e);
      }
    },
  );

  server.registerTool(
    'define',
    {
      title: 'What a word means in this domain',
      description:
        'Look up a word in the ubiquitous language this checkout keeps: the glossary terms under glossary/<domain>.md that match it, and the entities under entities/ named for it, with their properties, identifier and the events whose schema carries that identifier. Use it before naming a field, an event or a service, so the name means what the domain already means by it.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      try {
        return asText(define(catalog, query));
      } catch (e) {
        return asError(e);
      }
    },
  );

  registerAppTool(
    server,
    'show_map',
    {
      title: 'Show a map of the catalog',
      description:
        'Draw the catalog, or the part around one resource, as an interactive diagram in the conversation, with runtime evidence on each edge where a snapshot covers it. focus is a reference as `about:` writes one: "service/PaymentService", "event/payments/payment.captured", "domain/payments", "flow/<id>" for a flow under flows/, "design/<id>" for a design under designs/, or "data-product/<id>" for a data product under data-products/. Omit it for the whole catalog. ' +
        'To sketch architecture that does not exist yet, pass design instead: { title, summary?, status?: draft|proposed, resources: [{ id, type: domain|system|service|agent|event|command|query|channel|actor|external-system|container|team, name?, summary?, parent? } or { ref: "service/PaymentService" } for one the catalog has], relations: [{ from, to, kind: sends|receives|routes-through|reads|writes|connects, label? }] (sends and receives go from the service to the message), notes?: [{ text, resource? }] }. Parts the catalog does not have are drawn as new. ' +
        'The text result lists every edge, so you can explain the map; for a design it also gives the file to save as designs/<id>.md to propose it.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        focus: z.string().min(1).optional(),
        design: designSchema.optional(),
      },
      _meta: { ui: { resourceUri: MAP_VIEW } },
    },
    async ({ focus, design }) => {
      // Every answer names why the agents are missing, so a reader can tell them
      // apart from agents the catalog does not have.
      const missing = catalog.mapGraphFailure
        ? `\n\nThe agent catalog is not on this map: ${catalog.mapGraphFailure}`
        : '';

      try {
        const map = design ? draftMap(catalog, design) : catalogMap(catalog, focus);

        // JSON is YAML, so the design as given is frontmatter a reader can commit.
        const save = design
          ? `\n\nTo propose it, save as designs/<id>.md:\n---\n${JSON.stringify(design, null, 2)}\n---\n`
          : '';

        return {
          content: [{ type: 'text' as const, text: describeMap(map) + save + missing }],
          structuredContent: { ...map },
        };
      } catch (e) {
        return asError(new Error(`${e instanceof Error ? e.message : String(e)}${missing}`));
      }
    },
  );

  registerAppResource(
    server,
    'Catalog map',
    MAP_VIEW,
    { description: 'The catalog as a diagram' },
    async () => ({
      contents: [
        {
          uri: MAP_VIEW,
          mimeType: RESOURCE_MIME_TYPE,
          // From src in tests and dist when built, the view sits in dist.
          text: await fs.readFile(new URL('../dist/map.html', import.meta.url), 'utf8'),
        },
      ],
    }),
  );

  return server;
}
