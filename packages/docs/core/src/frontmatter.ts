import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
// The 2020-12 build, matching autocatalog-core: the default ajv entry point does
// not carry that meta-schema and rejects the schema outright.
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  type JsonObject,
  isJsonObject,
  isRealFileInside,
  jsonObjectSchema,
  jsonValueSchema,
} from 'autocatalog-core';
import { z } from 'zod';

/**
 * Where the convention keeps the company's own contract.
 *
 * The same `contracts/` root holds the published index, so a repository has one
 * place for the machine-readable things it agrees to rather than two.
 */
export const DOCS_SCHEMA_PATH = 'contracts/docs-frontmatter.json';

/**
 * The contract a document's frontmatter must satisfy.
 *
 * Shipped so a company gets a working index on day one, but deliberately
 * replaceable: the convention's position is that the publishing organisation
 * owns its own contract, and a committed JSON Schema is what lets a Python
 * repository enforce the same rules without importing this package.
 *
 * `ac docs init-schema` writes this file into `contracts/` so a company edits
 * its own copy from the start. Extending it by hand beats layering a second
 * schema on top: one file, readable by anything that reads JSON Schema, with no
 * merge order for anyone to reason about.
 */
export const DEFAULT_FRONTMATTER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Documentation frontmatter',
  description:
    'The contract every document under docs/ satisfies. Owned by this organisation: add fields, tighten types, or set additionalProperties to false to close it.',
  type: 'object',
  required: ['title', 'owner'],
  properties: {
    title: { type: 'string', minLength: 1 },
    /**
     * A team, not a person: people change teams and documents outlive them.
     * Companies usually replace this with an enum of their own team names.
     */
    owner: { type: 'string', minLength: 1 },
    summary: { type: 'string' },
    /**
     * Cross-repository edges, declared as ids. A relative path into a sibling
     * directory resolves only for someone with every repo checked out side by
     * side, and is a dead link in a standalone clone or on the web.
     */
    related: {
      type: 'array',
      // `<repo>/<path>`, and never a relative path: a leading dot means someone
      // wrote a filesystem route that only resolves on their own machine.
      items: { type: 'string', pattern: '^[^./][^/]*/.+$' },
    },
    /**
     * Resources this document is about, as `kind/id` — `event/<domain>/<id>`
     * for an Event, `service/<name>`, `agent/<id>`. A runbook or ADR attached
     * to what it describes is found from that resource's page.
     */
    about: {
      type: 'array',
      items: { type: 'string', pattern: '^[a-z]+/.+$' },
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
  // Open by default: a team may carry fields this contract has never heard of.
  // Set false to close the contract once the organisation knows its own shape.
  additionalProperties: true,
} satisfies JsonObject;

/** A frontmatter contract, and where it was read from. */
export interface FrontmatterContract {
  schema: JsonObject;
  /** Absolute path, or null when this is the built-in default. */
  file: string | null;
}

/**
 * Find the contract to enforce.
 *
 * An explicit path wins; otherwise the convention looks for
 * `contracts/docs-frontmatter.json` at the root, so a company that owns its
 * contract never has to pass a flag, and one that has not written one yet still
 * gets a working index.
 *
 * An aggregation root of cloned repositories has no files of its own, so there
 * the contract is the one an enrolled repository publishes: the handbook
 * pattern, `<repo>/contracts/docs-frontmatter.json`. Other repositories keep
 * copies of it for their own CI (`ac docs sync-schema`), and an identical copy
 * is the same contract. Two that differ are refused rather than chosen between:
 * which one is enforced must not depend on directory order, and a drifted copy
 * silently becoming the company's rules is the failure the contract exists to
 * prevent.
 */
export function resolveFrontmatterContract(root: string, schemaPath?: string): FrontmatterContract {
  if (schemaPath) return readContract(path.resolve(schemaPath));

  const absolute = path.resolve(root);
  const conventional = path.join(absolute, DOCS_SCHEMA_PATH);

  if (fs.existsSync(conventional)) return readContract(conventional);

  // One repository: its subdirectories are its own code, not enrolled repositories.
  if (fs.existsSync(path.join(absolute, 'docs'))) {
    return { schema: DEFAULT_FRONTMATTER_SCHEMA, file: null };
  }

  const files = fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const repository = path.join(absolute, entry.name);
      const file = path.join(repository, DOCS_SCHEMA_PATH);

      return entry.isDirectory() && isRealFileInside(repository, file) ? [file] : [];
    })
    .sort();

  const published = files.map(readContract);
  const [first] = published;

  if (!first) return { schema: DEFAULT_FRONTMATTER_SCHEMA, file: null };

  if (published.some((contract) => !isDeepStrictEqual(contract.schema, first.schema))) {
    throw new Error(
      [
        'More than one repository publishes a different docs frontmatter contract:',
        ...files.map((file) => `  ${path.relative(absolute, file)}`),
        'Name the one to enforce: ac site --docs-schema <file>, or ac docs check --schema <file>.',
      ].join('\n'),
    );
  }

  return first;
}

function readContract(file: string): FrontmatterContract {
  return { schema: jsonObjectSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))), file };
}

/**
 * The frontmatter fields a contract declares.
 *
 * A site has to know these to keep them: a content collection drops anything it
 * was not told about, so a field a company added to its own contract would
 * validate and then vanish before any page could show it.
 */
export function declaredFrontmatterFields(schema: JsonObject): string[] {
  const properties = schema.properties;

  return isJsonObject(properties) ? Object.keys(properties) : [];
}

/**
 * The fields this package reads from a document that passed its contract.
 * Anything else a company declares rides along untouched.
 */
export const frontmatterSchema = z
  .object({
    title: z.string(),
    owner: z.string(),
    summary: z.string().optional(),
    related: z.array(z.string()).optional(),
    about: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .catchall(jsonValueSchema);

export type Frontmatter = z.infer<typeof frontmatterSchema>;

export interface FrontmatterIssue {
  path: string;
  message: string;
}

export interface FrontmatterValidator {
  validate(data: JsonObject): FrontmatterIssue[];
}

/**
 * Compile a validator from a resolved JSON Schema.
 *
 * Takes the schema rather than a path so that whoever resolves the contract —
 * and reports which file was used — is the same code every caller shares.
 */
export function frontmatterValidator(schema: JsonObject): FrontmatterValidator {
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  // ajv-formats ships as CJS, but sets `module.exports` to the plugin itself
  // and `.default` to the same function, so every interop path is callable.
  addFormats(ajv);

  const compiled: ValidateFunction = ajv.compile(schema);

  return {
    validate(data: JsonObject): FrontmatterIssue[] {
      if (compiled(data)) return [];

      return (compiled.errors ?? []).map((error) => ({
        path: error.instancePath.replace(/^\//, '').replace(/\//g, '.') || '(root)',
        message: error.message ?? 'is invalid',
      }));
    },
  };
}
