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
  searchFieldsInCatalog,
  assessImpact,
  catalogStatus,
  checkChange,
  investigationBundle,
} from './tools.js';

const asText = <T>(data: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const asError = (cause: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: cause instanceof Error ? cause.message : String(cause) },
  ],
});

export function createServer(catalog: CatalogSnapshot): McpServer {
  const server = new McpServer({ name: 'autocatalog', version: '0.0.1' });

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

  return server;
}
