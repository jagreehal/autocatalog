/**
 * An Open Data Contract Standard contract as a data product page, the MCP
 * server and llms.txt show it: what it promises, on what terms, to whom, and
 * how well it has kept those promises. Reading only: linting, diffing and
 * checking consumers' expectations live in autocatalog-plugin-odcs, which
 * uses autotel-datacontract.
 */
import { isJsonObject, type JsonObject } from 'autocatalog-core';
import { parse } from 'yaml';
import { z } from 'zod';

/** A contract file this reads: `<id>_v<major>.odcs.yaml`, or any `*.odcs.yml`. */
export const ODCS_FILE = /\.odcs\.ya?ml$/;

/** The results a scheduled check appends beside the contract: `customers_v1.odcs.yaml` → `customers_v1.results.ndjson`. */
export function trackRecordFile(contract: string): string {
  return contract.replace(ODCS_FILE, '.results.ndjson');
}

const text = z.string().optional().catch(undefined);

// A malformed list fails the read, naming the field, rather than reading as empty.
const list = <T extends z.ZodType>(item: T) => z.array(item).default([]);

const property = z.object({
  name: z.string(),
  businessName: text,
  logicalType: text,
  physicalType: text,
  description: text,
  required: z.boolean().optional().catch(undefined),
  primaryKey: z.boolean().optional().catch(undefined),
  classification: text,
  quality: list(z.unknown()),
});

const odcsSchema = z.object({
  apiVersion: z.string().regex(/^v3\./, 'is not an ODCS v3 version'),
  kind: z.literal('DataContract'),
  id: z.string().min(1),
  name: text,
  version: z.string().min(1),
  status: text,
  description: z
    .object({ purpose: text, usage: text, limitations: text })
    .optional()
    .catch(undefined),
  schema: list(
    z.object({
      name: z.string(),
      physicalName: text,
      physicalType: text,
      description: text,
      quality: list(z.unknown()),
      properties: list(property),
    }),
  ),
  slaProperties: list(
    z.object({
      property: z.string(),
      value: z.union([z.number(), z.string()]),
      unit: text,
      element: text,
      description: text,
    }),
  ),
  slaDefaultElement: text,
  team: z
    .union([z.object({ name: text }), z.array(z.object({ name: text }))])
    .optional()
    .catch(undefined),
  support: list(z.object({ channel: text, tool: text, url: text })),
  servers: list(z.object({ server: z.string(), type: text, environment: text })),
  roles: list(z.object({ role: z.string(), access: text, description: text })),
  context: z
    .union([
      // ODCS 3.2: a plain string is shorthand for the instructions.
      z.string().transform((instructions) => ({
        instructions,
        constraints: [],
        verifiedStatements: [],
      })),
      z.object({
        instructions: text,
        constraints: list(z.object({ constraint: z.string() })),
        verifiedStatements: list(z.object({ question: z.string(), answer: text })),
      }),
    ])
    .optional()
    .catch(undefined),
  price: z
    .object({
      priceAmount: z.union([z.number(), z.string()]).optional(),
      priceCurrency: text,
      priceUnit: text,
    })
    .optional()
    .catch(undefined),
});

export interface OdcsColumn {
  name: string;
  businessName?: string | undefined;
  type?: string | undefined;
  description?: string | undefined;
  required: boolean;
  primaryKey: boolean;
  classification?: string | undefined;
}

export interface OdcsObject {
  name: string;
  physicalName?: string | undefined;
  physicalType?: string | undefined;
  description?: string | undefined;
  columns: OdcsColumn[];
  /** Quality rules on the object and its columns. */
  rules: number;
}

export interface OdcsSla {
  property: string;
  /** `24 hours`. */
  promise: string;
  element?: string | undefined;
  description?: string | undefined;
}

export interface OdcsContract {
  id: string;
  name?: string | undefined;
  version: string;
  status?: string | undefined;
  terms: {
    purpose?: string | undefined;
    usage?: string | undefined;
    limitations?: string | undefined;
  };
  objects: OdcsObject[];
  slas: OdcsSla[];
  team?: string | undefined;
  support: Array<{
    channel?: string | undefined;
    tool?: string | undefined;
    url?: string | undefined;
  }>;
  servers: Array<{ server: string; type?: string | undefined; environment?: string | undefined }>;
  roles: Array<{ role: string; access?: string | undefined; description?: string | undefined }>;
  /** ODCS 3.2's AI context: guidance written for agents. */
  ai: {
    instructions?: string | undefined;
    constraints: string[];
    verifiedStatements: Array<{ question: string; answer?: string | undefined }>;
  };
  price?: string | undefined;
  /**
   * The contract as written, for agents: relationships, authoritative
   * definitions, every quality rule and each server's connection details.
   */
  document: JsonObject;
}

const json = z.json();

/** Read a contract for display. Throws when the text is not an ODCS data contract. */
export function readOdcs(source: string): OdcsContract {
  const document: unknown = parse(source);
  const read = odcsSchema.safeParse(document);

  if (!read.success) {
    const issue = read.error.issues[0];
    throw new Error(
      `not an ODCS data contract: ${issue?.path.join('.') || 'the file'} ${issue?.message ?? ''}`.trim(),
    );
  }

  const c = read.data;
  // JSON-safe: YAML dates and the like become what JSON carries.
  const written = json.parse(JSON.parse(JSON.stringify(document)));

  if (!isJsonObject(written))
    throw new Error('not an ODCS data contract: the file is not a mapping');
  const teamName = Array.isArray(c.team) ? c.team[0]?.name : c.team?.name;

  return {
    id: c.id,
    name: c.name,
    version: c.version,
    status: c.status,
    terms: c.description ?? {},
    objects: c.schema.map((object) => ({
      name: object.name,
      physicalName: object.physicalName,
      physicalType: object.physicalType,
      description: object.description,
      columns: object.properties.map((p) => ({
        name: p.name,
        businessName: p.businessName,
        type: p.logicalType ?? p.physicalType,
        description: p.description,
        required: Boolean(p.required || p.primaryKey),
        primaryKey: Boolean(p.primaryKey),
        classification: p.classification,
      })),
      rules: object.quality.length + object.properties.reduce((n, p) => n + p.quality.length, 0),
    })),
    slas: c.slaProperties.map((s) => ({
      property: s.property,
      promise: `${s.value}${s.unit ? ` ${s.unit}` : ''}`,
      element: s.element ?? c.slaDefaultElement,
      description: s.description,
    })),
    team: teamName,
    support: c.support,
    servers: c.servers,
    roles: c.roles,
    ai: {
      instructions: c.context?.instructions?.trim(),
      constraints: (c.context?.constraints ?? []).map((x) => x.constraint.trim()),
      verifiedStatements: (c.context?.verifiedStatements ?? []).map((s) => ({
        question: s.question,
        answer: s.answer?.trim(),
      })),
    },
    price:
      c.price?.priceAmount !== undefined
        ? `${c.price.priceAmount} ${c.price.priceCurrency ?? ''} ${c.price.priceUnit ?? ''}`
            .replace(/\s+/g, ' ')
            .trim()
        : undefined,
    document: written,
  };
}

const resultLine = z.object({
  at: z.string(),
  contract: z.object({ id: z.string(), version: z.string() }),
  object: z.string().optional(),
  status: z.enum(['passed', 'failed', 'incomplete']),
  sla: z
    .array(
      z.object({
        property: z.string(),
        element: z.string().optional(),
        status: z.string(),
      }),
    )
    .default([]),
  quality: z.array(z.object({ status: z.string() })).default([]),
  unchecked: z.array(z.string()).default([]),
});

export interface TrackRecord {
  /** Checks read, most recent last, at most the window. */
  runs: number;
  /** Runs where every object, quality rule and service level the contract declares was checked and passed. */
  passed: number;
  last?: { at: string; status: 'passed' | 'failed' | 'incomplete' } | undefined;
  /** Per service level: runs it was kept, of the runs that measured it (unknown counts as not kept). */
  slas: Array<{ property: string; element: string; kept: number; measured: number }>;
}

/**
 * The contract's track record, from the lines a scheduled check appends: one
 * report per object per run, `{ "at": <ISO time>, ...report }`, as
 * autotel-datacontract's `resultLines()` writes them. Only reports of this
 * contract's id and version count, and only the service levels it promises,
 * so a result for an earlier promise never credits this one. Reports sharing
 * `at` are one run; a run that leaves an object unchecked is incomplete.
 * Lines that do not read are skipped and counted.
 */
export function readTrackRecord(
  source: string,
  contract: Pick<OdcsContract, 'id' | 'version' | 'objects' | 'slas'>,
  window = 30,
): TrackRecord & { unreadable: number } {
  const promised = new Set(contract.slas.map((s) => `${s.property}:${s.element ?? ''}`));
  const byRun = new Map<string, Array<z.output<typeof resultLine>>>();
  let unreadable = 0;

  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      unreadable++;
      continue;
    }

    const read = resultLine.safeParse(value);

    if (!read.success || Number.isNaN(Date.parse(read.data.at))) {
      unreadable++;
      continue;
    }

    if (read.data.contract.id !== contract.id || read.data.contract.version !== contract.version)
      continue;
    byRun.set(read.data.at, [...(byRun.get(read.data.at) ?? []), read.data]);
  }

  const runs = [...byRun.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .slice(-window);

  // A promise is checked in a run when some report measured it, not-executable aside.
  const measured = (reports: Array<z.output<typeof resultLine>>, key: string) =>
    reports.some((r) =>
      r.sla.some(
        (s) => `${s.property}:${s.element ?? ''}` === key && s.status !== 'not-executable',
      ),
    );

  const worst = (reports: Array<z.output<typeof resultLine>>) =>
    reports.some((r) => r.status === 'failed' || r.quality.some((q) => q.status === 'failed'))
      ? ('failed' as const)
      : reports.some(
            (r) =>
              r.status === 'incomplete' ||
              r.unchecked.length > 0 ||
              r.quality.some((q) => q.status !== 'passed'),
          ) ||
          contract.objects.some((o) => !reports.some((r) => r.object === o.name)) ||
          [...promised].some((key) => !measured(reports, key))
        ? ('incomplete' as const)
        : ('passed' as const);

  const slas = new Map<
    string,
    { property: string; element: string; kept: number; measured: number }
  >();

  for (const [, reports] of runs) {
    const seen = new Map<string, boolean>();

    for (const r of reports)
      for (const s of r.sla) {
        if (s.status === 'not-executable') continue;
        const key = `${s.property}:${s.element ?? ''}`;

        if (!promised.has(key)) continue;
        seen.set(key, (seen.get(key) ?? true) && s.status === 'kept');
      }

    for (const [key, kept] of seen) {
      const [property = '', element = ''] = key.split(/:(.*)/s);
      const entry = slas.get(key) ?? { property, element, kept: 0, measured: 0 };
      entry.measured++;

      if (kept) entry.kept++;
      slas.set(key, entry);
    }
  }

  const lastRun = runs.at(-1);

  return {
    runs: runs.length,
    passed: runs.filter(([, reports]) => worst(reports) === 'passed').length,
    last: lastRun && { at: lastRun[0], status: worst(lastRun[1]) },
    slas: [...slas.values()],
    unreadable,
  };
}
