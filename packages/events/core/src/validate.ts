import type Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { jsonSchemaAjv, jsonSchemaDialect, type JsonSchemaDialect } from './json-schema-dialect';
import { fieldPaths, guaranteedFieldPaths } from './fields';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { validateCloudEvent } from './cloudevents';
import { loadCatalogSnapshot, type LoadedEvent } from './load';

/**
 * Where a project keeps its own rules for Event manifests, beside the docs
 * frontmatter contract: one `contracts/` root for everything it agrees to.
 */
export const EVENT_MANIFEST_CONTRACT_PATH = 'contracts/event-manifest.json';

export type ValidationCode =
  | 'frontmatter_invalid'
  | 'schema_invalid_json_schema'
  | 'example_does_not_match_schema'
  | 'duplicate_event'
  | 'unresolved_replaced_by'
  | 'unsupported_spec'
  | 'versioned_id_mismatch'
  | 'events_directory_missing'
  | 'policy_violation'
  | 'delivery_key_unknown'
  | 'invalid_example_is_valid';

export type ValidationWarningCode =
  | 'version_not_semver'
  | 'consumer_field_unknown'
  | 'delivery_key_optional'
  | 'duplicate_example_unmatched';

export interface ValidationError {
  code: ValidationCode;
  message: string;
  path?: string;
}

export interface ValidationWarning {
  code: ValidationWarningCode;
  message: string;
  path?: string;
}

export interface ValidationResult {
  events: LoadedEvent[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const SUPPORTED_SPEC = 'autocatalog/v2';

// Semver, or EventCatalog's bare integer versions (1, V2); either may carry a v.
const VERSION_RE = /^[vV]?\d+(?:\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?)?$/;

/** The value at a dotted payload path, or undefined where the payload has none. */
function valueAt(data: JsonValue, path: string): JsonValue | undefined {
  let node: JsonValue | undefined = data;

  for (const key of path.split('.')) node = isJsonObject(node) ? node[key] : undefined;

  return node;
}

/**
 * A duplicate example is a repeat of another one, which a consumer recognises
 * by the idempotency key. Without a key, or with a value no other example has,
 * it shows a consumer nothing it could deduplicate.
 */
function duplicateExampleWarnings(evt: LoadedEvent): ValidationWarning[] {
  const key = evt.frontmatter.delivery?.idempotencyKey;

  return evt.examples.flatMap((ex): ValidationWarning[] => {
    if (ex.case !== 'duplicate') return [];

    const warn = (message: string): ValidationWarning[] => [
      { code: 'duplicate_example_unmatched', message, path: ex.path },
    ];

    if (!key)
      return warn(
        `Duplicate example "${ex.name}" has no delivery.idempotencyKey to recognise it by`,
      );

    const value = JSON.stringify(valueAt(ex.data, key));

    const repeats = evt.examples.some(
      (other) =>
        other !== ex &&
        other.case !== 'invalid' &&
        JSON.stringify(valueAt(other.data, key)) === value,
    );

    return repeats
      ? []
      : warn(
          `Duplicate example "${ex.name}" has idempotency key ${key} ${value}, which no other example has, so it is not a repeat of anything`,
        );
  });
}

/** Compiles each schema in the dialect it declares, one validator per dialect for the run. */
function schemaCompiler() {
  const made = new Map<JsonSchemaDialect, Ajv>();

  return (schema: JsonObject): ValidateFunction => {
    const dialect = jsonSchemaDialect(schema);
    const ajv = made.get(dialect) ?? jsonSchemaAjv(dialect);
    made.set(dialect, ajv);

    return ajv.compile(schema);
  };
}

export interface ValidateCatalogOptions {
  /**
   * A JSON Schema every Event manifest must also satisfy: the project's naming
   * and completeness rules, such as an id pattern or a required owner.
   */
  policy?: JsonObject;
}

export async function validateCatalog(
  eventsRoot: string,
  opts: ValidateCatalogOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const snapshot = await loadCatalogSnapshot(eventsRoot, { mode: 'collect' });
  const events = snapshot.events;

  for (const diagnostic of snapshot.diagnostics) {
    errors.push({
      code:
        diagnostic.code === 'events_directory_missing'
          ? 'events_directory_missing'
          : 'frontmatter_invalid',
      message: diagnostic.message,
      path: diagnostic.path,
    });
  }

  const compile = schemaCompiler();
  let policy;

  try {
    policy = opts.policy && compile(opts.policy);
  } catch (err) {
    errors.push({
      code: 'schema_invalid_json_schema',
      message: `${EVENT_MANIFEST_CONTRACT_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Per-event validation
  const byKey = new Map<string, LoadedEvent[]>();

  for (const evt of events) {
    if (evt.frontmatter.spec !== SUPPORTED_SPEC) {
      errors.push({
        code: 'unsupported_spec',
        message: `Unsupported spec ${evt.frontmatter.spec}, expected ${SUPPORTED_SPEC}`,
        path: evt.folder.path,
      });
      continue;
    }

    if (policy && !policy(evt.frontmatter)) {
      const detail = (policy.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');

      errors.push({
        code: 'policy_violation',
        message: `Manifest breaks ${EVENT_MANIFEST_CONTRACT_PATH}: ${detail}`,
        path: evt.folder.path,
      });
    }

    if (!VERSION_RE.test(evt.frontmatter.version)) {
      warnings.push({
        code: 'version_not_semver',
        message: `Version "${evt.frontmatter.version}" is neither semver nor an integer version like V2; one of those is recommended for deterministic ordering/diffs`,
        path: evt.folder.path,
      });
    }

    if (evt.folder.isVersioned && evt.folder.parentEventPath) {
      const parent = events.find((e) => e.folder.path === evt.folder.parentEventPath);

      if (parent && parent.frontmatter.id !== evt.frontmatter.id) {
        errors.push({
          code: 'versioned_id_mismatch',
          message: `Versioned event id "${evt.frontmatter.id}" does not match parent "${parent.frontmatter.id}"`,
          path: evt.folder.path,
        });
      }
    }

    // A declared path the schema does not have never matches a change, so
    // drift cannot see that the consumer reads what the author meant.
    const paths = fieldPaths(evt.schema);

    for (const [consumer, declared] of Object.entries(evt.frontmatter.consumerFields ?? {})) {
      for (const field of declared.filter((path) => !paths.has(path))) {
        warnings.push({
          code: 'consumer_field_unknown',
          message: `Consumer "${consumer}" declares it reads "${field}", which the schema does not have`,
          path: evt.folder.path,
        });
      }
    }

    // A delivery key is a promise consumers build on, so it has to be a field
    // the payload has, and one every payload carries.
    const guaranteed = guaranteedFieldPaths(evt.schema);

    for (const [key, label, without] of [
      ['orderingKey', 'ordering key', 'has no order'],
      ['idempotencyKey', 'idempotency key', 'cannot be deduplicated'],
      ['correlationKey', 'correlation key', 'cannot be traced'],
    ] as const) {
      const field = evt.frontmatter.delivery?.[key];

      if (field === undefined || guaranteed.has(field)) continue;

      if (!paths.has(field))
        errors.push({
          code: 'delivery_key_unknown',
          message: `The ${label} "${field}" is not in the schema, so consumers cannot use it`,
          path: evt.folder.path,
        });
      else
        warnings.push({
          code: 'delivery_key_optional',
          message: `The ${label} "${field}" is optional in the schema; an event without it ${without}`,
          path: evt.folder.path,
        });
    }

    let validate;

    try {
      validate = compile(evt.schema);
    } catch (err) {
      errors.push({
        code: 'schema_invalid_json_schema',
        message: err instanceof Error ? err.message : String(err),
        path: evt.schemaPath,
      });
      continue;
    }

    for (const ex of evt.examples) {
      const problems: ValidationError[] = [];

      if (evt.frontmatter.envelope?.mode === 'structured')
        for (const finding of validateCloudEvent(ex.data, evt.schema))
          problems.push({
            code: 'example_does_not_match_schema',
            message: `Example "${ex.name}": ${finding.message}`,
            path: evt.folder.path,
          });
      else if (!validate(ex.data)) {
        const detail = (validate.errors ?? [])
          .map((e) => `${e.instancePath} ${e.message}`)
          .join('; ');

        problems.push({
          code: 'example_does_not_match_schema',
          message: `Example "${ex.name}" does not match schema: ${detail}`,
          path: ex.path,
        });
      }

      // An invalid example is the one that has to fail: it shows what to reject.
      if (ex.case !== 'invalid') errors.push(...problems);
      else if (problems.length === 0)
        errors.push({
          code: 'invalid_example_is_valid',
          message: `Example "${ex.name}" is under examples/invalid/ but the schema accepts it, so it shows nothing a consumer must reject`,
          path: ex.path,
        });
    }

    warnings.push(...duplicateExampleWarnings(evt));

    const key = `${evt.frontmatter.domain}@${evt.frontmatter.id}@${evt.frontmatter.version}`;
    const arr = byKey.get(key) ?? [];
    arr.push(evt);
    byKey.set(key, arr);
  }

  // Uniqueness
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      errors.push({
        code: 'duplicate_event',
        message: `Duplicate event (domain, id, version) "${key}" in: ${list.map((e) => e.folder.path).join(', ')}`,
      });
    }
  }

  // replacedBy references
  for (const evt of events) {
    const ref = evt.frontmatter.deprecation?.replacedBy;

    if (!ref) continue;

    const found = events.some(
      (e) => e.frontmatter.id === ref.id && (!ref.version || e.frontmatter.version === ref.version),
    );

    if (!found) {
      errors.push({
        code: 'unresolved_replaced_by',
        message: `deprecation.replacedBy "${ref.id}${ref.version ? '@' + ref.version : ''}" does not resolve`,
        path: evt.folder.path,
      });
    }
  }

  return { events, errors, warnings };
}
