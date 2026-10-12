import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import addFormats from 'ajv-formats';
import type { JsonObject } from './json';

export type JsonSchemaDialect = 'draft-07' | '2019-09' | '2020-12';

/**
 * The dialect a schema's `$schema` names, or `fallback` when it names none.
 * EventCatalog and most hand-written schemas are draft-07, whose `items` array
 * means a tuple that 2020-12 would refuse to compile.
 */
export function jsonSchemaDialect(
  schema: JsonObject,
  fallback: JsonSchemaDialect = '2020-12',
): JsonSchemaDialect {
  const declared = String(schema.$schema ?? '');

  if (/draft-0[67]/.test(declared)) return 'draft-07';

  if (declared.includes('2019-09')) return '2019-09';

  return declared.includes('2020-12') ? '2020-12' : fallback;
}

/** A validator for one dialect, with the standard formats. Draft-07's also reads draft-06. */
export function jsonSchemaAjv(dialect: JsonSchemaDialect): Ajv {
  const options = { strict: false, allErrors: true };

  const ajv =
    dialect === 'draft-07'
      ? new Ajv(options).addMetaSchema(draft06)
      : dialect === '2019-09'
        ? new Ajv2019(options)
        : new Ajv2020(options);

  addFormats(ajv);

  return ajv;
}
