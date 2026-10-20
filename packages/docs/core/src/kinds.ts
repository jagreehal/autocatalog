import { type JsonObject, type JsonValue, isJsonObject, jsonObjectSchema } from 'autocatalog-core';
import { z } from 'zod';
import {
  declaredFrontmatterFields,
  type FrontmatterIssue,
  frontmatterValidator,
  resolvePublishedFile,
} from './frontmatter';
import type { Doc } from './read-docs';

/**
 * Where an organisation publishes its document kinds, beside the frontmatter
 * contract and found by the same rules: at the aggregation root, or the one an
 * enrolled repository (usually the handbook) publishes.
 */
export const DOCS_CONVENTIONS_PATH = 'contracts/autocatalog.conventions.json';

/** One sort of document the organisation keeps, such as an ADR or a runbook. */
export interface DocKind {
  /** The key in the conventions file, and what frontmatter `kind:` names. */
  id: string;
  /** Plural, as the index page and the sidebar say it: "Decisions". */
  label: string;
  /** The folder under each repository's `docs/` that holds this kind. */
  folder: string;
  /** The site path of the kind's index page, without slashes: `decisions`. */
  path: string;
  description?: string;
  /** JSON Schema for this kind's own frontmatter, checked with the base contract. */
  schema?: JsonObject;
  /** Frontmatter fields shown as columns on the kind's index page. */
  columns: string[];
  /** The field holding the document's state, shown as a badge and filtered on. */
  statusField?: string;
  /** The field holding the document's date, which orders the index newest first. */
  dateField?: string;
}

/**
 * The fields one document of a kind names the one it replaces with, and is
 * replaced by. Any kind may use them; an ADR's schema declares them.
 */
export const SUPERSEDE_FIELDS = ['supersedes', 'supersededBy'] as const;

// `<repo>/<path>`, as `related:` names a document.
const documentIds = {
  type: 'array',
  items: { type: 'string', pattern: '^[^./][^/]*/.+$' },
} satisfies JsonObject;

const isoDate = { type: 'string', format: 'date' } satisfies JsonObject;

const severity = {
  enum: ['sev1', 'sev2', 'sev3', 'sev4'],
  description: 'sev1 is the most severe.',
} satisfies JsonObject;

/**
 * The kinds every organisation gets without writing anything. Field names and
 * decision states follow common ADR practice, so a record written elsewhere
 * moves in unchanged; what a document applies to is `about:`, which every
 * document already has.
 */
export const DEFAULT_DOC_KINDS = {
  adr: {
    label: 'Decisions',
    folder: 'adr',
    path: 'decisions',
    description: 'Architecture decision records: what was decided, why, and what it replaced.',
    schema: {
      type: 'object',
      required: ['status', 'date'],
      properties: {
        status: { enum: ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'] },
        date: isoDate,
        supersedes: documentIds,
        supersededBy: documentIds,
      },
    },
    columns: ['status', 'date', 'owner'],
    statusField: 'status',
    dateField: 'date',
  },
  runbook: {
    label: 'Runbooks',
    folder: 'runbooks',
    path: 'runbooks',
    description: 'What to do when something goes wrong, written before it does.',
    schema: {
      type: 'object',
      properties: { severity, lastTested: isoDate },
    },
    columns: ['severity', 'lastTested', 'owner'],
    dateField: 'lastTested',
  },
  incident: {
    label: 'Incidents',
    folder: 'incidents',
    path: 'incidents',
    description: 'What broke, why, and what fixed it.',
    schema: {
      type: 'object',
      required: ['date', 'severity', 'status'],
      properties: {
        date: isoDate,
        severity,
        status: { enum: ['open', 'mitigated', 'resolved'] },
        rootCause: { type: 'string', description: 'One sentence; the body holds the detail.' },
        solution: { type: 'string', description: 'What fixed it, in one sentence.' },
      },
    },
    columns: ['status', 'severity', 'date', 'owner'],
    statusField: 'status',
    dateField: 'date',
  },
} satisfies Record<string, Omit<DocKind, 'id'>>;

const urlSegment = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'a lowercase URL segment, such as decisions');

const kindFields = z.strictObject({
  label: z.string().min(1),
  folder: z
    .string()
    .regex(
      /^[\w-]+(?:\/[\w-]+)*$/,
      'a folder under docs/, such as adr or ops/runbooks, with no leading or trailing slash',
    ),
  path: urlSegment.optional(),
  description: z.string().optional(),
  schema: jsonObjectSchema.optional(),
  columns: z.array(z.string().min(1)).optional(),
  statusField: z.string().min(1).optional(),
  dateField: z.string().min(1).optional(),
});

/** The conventions file as an organisation writes it. */
export const docsConventionsSchema = z.strictObject({
  $schema: z.string().optional(),
  kinds: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/),
      // `false` turns a built-in kind off; an object adds a kind or changes
      // the fields of a built-in one.
      z.union([z.literal(false), kindFields.partial()]),
      {
        error: (issue) =>
          issue.code === 'invalid_key'
            ? 'a kind id is lowercase letters, digits and dashes, such as adr or postmortem'
            : undefined,
      },
    )
    .default({}),
});

export type DocsConventions = z.input<typeof docsConventionsSchema>;

/** The kinds in force, and the file they came from (null for the defaults). */
export interface ResolvedDocKinds {
  kinds: DocKind[];
  file: string | null;
}

/** "Postmortems" becomes `postmortems`, the default path of a kind's index. */
const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Merge an organisation's conventions over the built-in kinds.
 *
 * A field the organisation sets replaces the built-in one whole, including
 * `schema`, so what a kind enforces is always readable in one place.
 */
export function docKinds(conventions: JsonValue, file = 'conventions'): DocKind[] {
  const parsed = docsConventionsSchema.safeParse(conventions);

  if (!parsed.success) {
    throw new Error(`${file} is not a valid conventions file:\n${z.prettifyError(parsed.error)}`);
  }

  const merged = new Map<string, Partial<Omit<DocKind, 'id'>>>(Object.entries(DEFAULT_DOC_KINDS));

  for (const [id, override] of Object.entries(parsed.data.kinds)) {
    if (override === false) merged.delete(id);
    else merged.set(id, { ...merged.get(id), ...override });
  }

  const kinds: DocKind[] = [];
  const problems: string[] = [];

  for (const [id, fields] of merged) {
    const complete = kindFields.safeParse(fields);

    if (!complete.success) {
      problems.push(
        `kinds.${id}: a new kind needs a label and a folder\n${z.prettifyError(complete.error)}`,
      );
      continue;
    }

    const { label, folder, path, columns, ...rest } = complete.data;

    kinds.push({ id, label, folder, path: path ?? slug(label), columns: columns ?? [], ...rest });
  }

  for (const key of ['folder', 'path'] as const) {
    const seen = new Map<string, string>();

    for (const kind of kinds) {
      const other = seen.get(kind[key]);

      if (other) problems.push(`kinds.${kind.id}: ${key} '${kind[key]}' is also ${other}'s`);
      seen.set(kind[key], kind.id);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${file} is not a valid conventions file:\n${problems.join('\n')}`);
  }

  return kinds;
}

/**
 * The document kinds this root enforces: the organisation's conventions file
 * merged over the built-in kinds, or the built-in kinds alone.
 */
export function resolveDocKinds(root: string, conventionsPath?: string): ResolvedDocKinds {
  const found = resolvePublishedFile(root, DOCS_CONVENTIONS_PATH, {
    explicit: conventionsPath,
    what: 'conventions file',
    remedy: 'ac site --docs-conventions <file>, or ac docs check --conventions <file>',
  });

  return found
    ? { kinds: docKinds(found.json, found.file), file: found.file }
    : { kinds: docKinds({}), file: null };
}

/** What `ac docs init-conventions` writes: every built-in kind, spelled out to edit. */
export function defaultConventionsFile(): DocsConventions {
  return { kinds: DEFAULT_DOC_KINDS };
}

// A folder's index or README introduces the kind rather than being one.
const INTRODUCTIONS = new Set(['index', 'readme']);

export type DocKindResolution = { kind: DocKind | null } | { failure: string };

/**
 * Which kind a document is: its frontmatter `kind:` when it names one, else
 * the deepest kind folder it sits in under `docs/`, else none.
 */
export function docKind(
  doc: Pick<Doc, 'id' | 'repo' | 'data'>,
  kinds: DocKind[],
): DocKindResolution {
  const declared = doc.data.kind;

  if (declared !== undefined) {
    const named = kinds.find((kind) => kind.id === declared);

    return named
      ? { kind: named }
      : {
          failure: `kind '${String(declared)}' is not a kind this organisation keeps (${kinds.map((kind) => kind.id).join(', ') || 'none'})`,
        };
  }

  const relative = doc.id.slice(doc.repo.length + 1);

  if (INTRODUCTIONS.has(relative.split('/').at(-1)!.toLowerCase())) return { kind: null };

  let match: DocKind | null = null;

  for (const kind of kinds) {
    const inside = relative.startsWith(`${kind.folder}/`);

    if (inside && kind.folder.length > (match?.folder.length ?? -1)) match = kind;
  }

  return { kind: match };
}

/**
 * The contract a document of one kind satisfies: the organisation's base
 * contract and the kind's schema, both at once.
 *
 * The kind's fields are declared on the base too, so a base contract closed
 * with `additionalProperties: false` still lets an ADR carry `status`.
 */
export function kindContract(base: JsonObject, kind: DocKind): JsonObject {
  if (!kind.schema) return base;

  const { $schema, $id: _id, ...rest } = base;
  const { $schema: _kindSchema, $id: _kindId, ...own } = kind.schema;
  const properties = isJsonObject(rest.properties) ? rest.properties : {};

  const extra = Object.fromEntries(
    declaredFrontmatterFields(own).map((field): [string, boolean] => [field, true]),
  );

  return {
    ...($schema !== undefined && { $schema }),
    allOf: [{ ...rest, properties: { ...extra, ...properties } }, own],
  };
}

/** One document checked against its kind's contract. */
export interface KindCheck {
  kind: DocKind | null;
  issues: FrontmatterIssue[];
}

/**
 * Check documents against the contract their kind calls for. Compiled once per
 * kind, because one check reads every document a company publishes.
 */
export function kindValidator(base: JsonObject, kinds: DocKind[]): (doc: Doc) => KindCheck {
  const plain = frontmatterValidator(base);

  const byKind = new Map(
    kinds.map((kind) => [kind.id, frontmatterValidator(kindContract(base, kind))]),
  );

  return (doc) => {
    const resolution = docKind(doc, kinds);

    if ('failure' in resolution) {
      return { kind: null, issues: [{ path: 'kind', message: resolution.failure }] };
    }

    const validator = resolution.kind ? byKind.get(resolution.kind.id)! : plain;

    return { kind: resolution.kind, issues: validator.validate(doc.data) };
  };
}

/**
 * One failing field, naming the document's kind when it has one: a missing
 * `status` reads as a mistake only once the reader knows it is an ADR.
 */
export function kindFailure(file: string, kind: DocKind | null, issue: FrontmatterIssue): string {
  return `${file}${kind ? ` (${kind.id})` : ''}: ${issue.path}: ${issue.message}`;
}

/** A frontmatter field as text, when it is one; anything else has no text to show. */
export function textField(data: JsonObject, field: string | undefined): string | null {
  const text = nonEmptyText.safeParse(field === undefined ? undefined : data[field]);

  return text.success ? text.data : null;
}

const nonEmptyText = z.string().min(1);

const documentIdList = z.array(z.string()).catch([]);

/** The documents one replaces, and the ones that replaced it, by id. */
export interface Supersession {
  supersedes: string[];
  supersededBy: string[];
}

/** The ids a document says it supersedes and is superseded by; none when it says neither. */
export function supersession(data: JsonObject): Supersession {
  return {
    supersedes: documentIdList.parse(data.supersedes ?? []),
    supersededBy: documentIdList.parse(data.supersededBy ?? []),
  };
}
