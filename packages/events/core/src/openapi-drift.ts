import { z } from 'zod';
import {
  adviseBreaking,
  assessEventChange,
  compatibilityViolations,
  findingPointer,
  placeFinding,
  type DriftFinding,
} from './drift';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { derefLocal } from './json-ref';
import { findOpenApiDocuments, METHODS } from './scan-openapi';
import { sourceLines } from './source-lines';

type Side = 'request' | 'response';

interface Operation {
  relFile: string;
  label: string;
  request: JsonObject;
  response: JsonObject;
  /** Where the operation sits in its document, as pointer steps. */
  at: string[];
  /** Where each synthesised property's schema sits in the document, per side. */
  fields: Record<Side, Record<string, string[]>>;
}

const objectAt = (doc: JsonObject, node: JsonValue | undefined): JsonObject => {
  const resolved = derefLocal<JsonValue | undefined>(doc, node);

  return isJsonObject(resolved) ? resolved : {};
};

/**
 * Point `#/components/...` at the `$defs` the synthesised schema carries, so
 * the schema diff resolves component refs the way it resolves any local ref.
 */
function rehome(node: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, rehomeValue(key, value)]),
  );
}

function rehomeValue(key: string, value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => rehomeValue('', item));

  if (isJsonObject(value)) return rehome(value);

  const ref = key === '$ref' ? z.string().safeParse(value) : undefined;

  return ref?.success ? ref.data.replace(/^#\/components\//, '#/$defs/components/') : value;
}

/**
 * The JSON schema of a content map; `{}` when it carries none, so presence
 * still counts. `at` is where that schema sits below the content map.
 */
function contentSchema(
  doc: JsonObject,
  content: JsonValue | undefined,
): { schema: JsonValue; at: string[] } {
  const media = objectAt(doc, content);

  const type =
    Object.keys(media).find((t) => t === 'application/json') ??
    Object.keys(media).find((t) => t.includes('json'));

  const schema = type && objectAt(doc, media[type]).schema;

  return schema === undefined || !type
    ? { schema: {}, at: [] }
    : { schema, at: ['content', type, 'schema'] };
}

/**
 * One operation as two payload schemas the event diff already understands: what
 * the client sends (parameters keyed `in:name`, plus `body`) and what it reads
 * back (one property per status code).
 */
function operationsOf(relFile: string, doc: JsonObject): Map<string, Operation> {
  const operations = new Map<string, Operation>();
  const $defs = { components: doc.components ?? {} };

  for (const [route, item] of Object.entries(objectAt(doc, doc.paths))) {
    const pathItem = objectAt(doc, item);

    for (const method of METHODS) {
      if (!isJsonObject(pathItem[method])) continue;
      const operation = pathItem[method];
      const at = ['paths', route, method];
      const properties: JsonObject = {};
      const required = new Set<string>();
      const fields: Operation['fields'] = { request: {}, response: {} };

      // Operation-level parameters override path-level ones with the same in+name.
      for (const [owner, list] of [
        [['paths', route], pathItem.parameters],
        [at, operation.parameters],
      ] as const) {
        for (const [index, raw] of (Array.isArray(list) ? list : []).entries()) {
          const param = objectAt(doc, raw);
          const key = `${String(param.in)}:${String(param.name)}`;
          const content = contentSchema(doc, param.content);
          properties[key] = param.schema ?? content.schema;
          fields.request[key] = [...owner, 'parameters', String(index), 'schema'];

          if (param.required === true) required.add(key);
          else required.delete(key);
        }
      }

      if (operation.requestBody !== undefined) {
        const body = objectAt(doc, operation.requestBody);
        const content = contentSchema(doc, body.content);
        properties.body = content.schema;
        fields.request.body = [...at, 'requestBody', ...content.at];

        if (body.required === true) required.add('body');
      }

      const responses = Object.fromEntries(
        Object.entries(objectAt(doc, operation.responses)).map(([status, response]) => {
          const content = contentSchema(doc, objectAt(doc, response).content);
          fields.response[status] = [...at, 'responses', status, ...content.at];

          return [status, content.schema];
        }),
      );

      const operationId = z.string().safeParse(operation.operationId);
      const id = operationId.success ? ` (${operationId.data})` : '';

      operations.set(`${relFile} ${method} ${route}`, {
        relFile,
        label: `${method.toUpperCase()} ${route}${id}`,
        request: rehome({ type: 'object', properties, required: [...required], $defs }),
        response: rehome({ type: 'object', properties: responses, $defs }),
        at,
        fields,
      });
    }
  }

  return operations;
}

/**
 * Re-grade an event finding for the side of the API it sits on, in API terms:
 * BACKWARD means the new API still serves existing clients, FORWARD that new
 * clients still work against the old API.
 *
 * The server reads the request, so the event schema's directions carry over
 * as they are. The client reads the response, so they swap: a response old
 * readers cannot parse breaks existing clients. A field that disappears breaks
 * existing clients either way — they stop getting it, or its value is dropped.
 */
function onSide(side: Side, finding: DriftFinding): DriftFinding {
  const schema = compatibilityViolations(finding);

  const api = new Set(
    side === 'request'
      ? schema
      : schema.map((mode) => (mode === 'backward' ? 'forward' : 'backward')),
  );

  if (finding.kind === 'field_removed' || finding.kind === 'field_renamed') api.add('backward');

  const compatibility = (['backward', 'forward'] as const).filter((mode) => api.has(mode));

  const severity =
    finding.kind === 'description_changed'
      ? 'info'
      : compatibility.includes('backward')
        ? 'breaking'
        : 'additive';

  return { ...finding, severity, compatibility, message: `${side}: ${finding.message}` };
}

/**
 * Compare the OpenAPI documents two source trees publish, per operation.
 *
 * Nothing in OpenAPI names an API's consumers, so these findings carry none.
 */
export async function driftOpenApi(
  baselineRoot: string,
  currentRoot: string,
  options: { exclude?: string[] } = {},
): Promise<DriftFinding[]> {
  const [baseScan, currScan] = await Promise.all([
    findOpenApiDocuments({ root: baselineRoot, exclude: options.exclude }),
    findOpenApiDocuments({ root: currentRoot, exclude: options.exclude }),
  ]);

  const errors = [...baseScan.errors, ...currScan.errors];

  if (errors.length > 0) throw new Error(`Could not read OpenAPI documents: ${errors.join('; ')}`);

  const operations = (scan: typeof baseScan) =>
    new Map(scan.documents.flatMap(({ relFile, doc }) => [...operationsOf(relFile, doc)]));

  const base = operations(baseScan);
  const curr = operations(currScan);

  // The API's version is `info.version`, read the way an event's version is:
  // a major bump acknowledges the breaking changes that come with it.
  const versions = (scan: typeof baseScan) =>
    new Map(
      scan.documents.map(({ relFile, doc }) => {
        const version = z.object({ version: z.coerce.string() }).safeParse(doc.info);

        return [relFile, version.success ? version.data.version : ''];
      }),
    );

  const baseVersions = versions(baseScan);
  const currVersions = versions(currScan);

  const lines = new Map(currScan.documents.map(({ relFile, raw }) => [relFile, sourceLines(raw)]));

  const advise = (op: Operation, changes: DriftFinding[]) =>
    adviseBreaking(changes, {
      from: baseVersions.get(op.relFile) ?? '',
      to: currVersions.get(op.relFile),
      field: 'info.version',
      readers: 'clients',
    });

  /** A synthesised payload path, back to where it is written in the document. */
  const place = (op: Operation, side: Side, f: DriftFinding): DriftFinding => {
    const [first, key, ...rest] = findingPointer(f) ?? [];
    const prefix = first === 'properties' && key !== undefined ? op.fields[side][key] : undefined;

    return placeFinding(f, lines.get(op.relFile), prefix ? [...prefix, ...rest] : op.at);
  };

  const findings: DriftFinding[] = [];

  const finding = (
    op: Operation,
    kind: DriftFinding['kind'],
    severity: DriftFinding['severity'],
    message: string,
  ): DriftFinding => ({
    domain: op.relFile,
    eventId: op.label,
    severity,
    kind,
    message,
    consumers: [],
    source: { file: op.relFile },
  });

  for (const [key, was] of base) {
    const now = curr.get(key);

    if (!now) {
      findings.push(
        ...advise(was, [finding(was, 'operation_removed', 'breaking', 'operation was removed')]),
      );
      continue;
    }

    for (const side of ['request', 'response'] as const) {
      const changes = assessEventChange({
        domain: now.relFile,
        eventId: now.label,
        consumers: [],
        source: { file: now.relFile },
        previous: was[side],
        proposed: now[side],
      });

      findings.push(
        ...advise(
          now,
          changes.map((change) => onSide(side, change)),
        ).map((change) => place(now, side, change)),
      );
    }
  }

  for (const [key, now] of curr) {
    if (!base.has(key)) {
      findings.push(
        placeFinding(
          finding(now, 'operation_added', 'additive', 'new operation'),
          lines.get(now.relFile),
          now.at,
        ),
      );
    }
  }

  return findings;
}
