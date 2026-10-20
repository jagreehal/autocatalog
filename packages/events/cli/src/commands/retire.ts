import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import {
  assessRetirement,
  consumersFromGraph,
  fieldPaths,
  jsonValueSchema,
  loadCatalog,
  matchSnapshot,
  pactEvidence,
  readSnapshot,
  renderRetirement,
  type DeclaredConsumers,
  type JsonValue,
  type LoadedEvent,
  type PactEvidence,
  type RetirementInput,
} from 'autocatalog-core';
import { z } from 'zod';
import { publishedLine, readCompanyIndex, repositoryName } from '../company-index';

export interface RunRetireOptions {
  /** `domain/id`, or an id the catalog has once. */
  event: string;
  field?: string;
  events: string;
  catalog?: string;
  catalogTokenEnv?: string;
  repository?: string;
  snapshot?: string;
  /** A pact file, a folder of them, or a Pact Broker's base URL. */
  pacts?: string;
  pactProvider?: string;
  pactTokenEnv?: string;
  format?: 'markdown' | 'json';
  quiet?: boolean;
}

const FETCH_TIMEOUT_MS = 15_000;

const MAX_PACT_BYTES = 4 * 1024 * 1024;

const MAX_PACTS = 200;

const PACT_CONCURRENCY = 8;

/** Pacts read, and what could not be: a gap blocks the verdict. */
interface PactsRead {
  pacts: PactEvidence[];
  gaps: string[];
}

const brokerPacts = z.object({
  _links: z.object({
    'pb:pacts': z.array(z.object({ href: z.string() })).catch([]),
  }),
});

const brokerLinks = z.object({
  _links: z
    .object({ 'pb:latest-verification-results': z.object({ href: z.string() }).optional() })
    .catch({}),
});

const verification = z.object({
  success: z.boolean(),
  providerApplicationVersion: z.string().optional(),
});

async function getJson(url: string, token: string | undefined): Promise<JsonValue> {
  const response = await fetch(url, {
    headers: { accept: 'application/hal+json', ...(token && { authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);

  if (Number(response.headers.get('content-length') ?? 0) > MAX_PACT_BYTES) {
    throw new Error(`${url}: larger than a pact`);
  }

  // Counted as it arrives, so an oversized body is dropped before it is held.
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  // Leaving the loop early cancels the stream.
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;

    if (bytes > MAX_PACT_BYTES) break;

    chunks.push(chunk);
  }

  if (bytes > MAX_PACT_BYTES) throw new Error(`${url}: larger than a pact`);

  return jsonValueSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** Each item through `work`, a few at a time, in order. */
async function few<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];

  for (let i = 0; i < items.length; i += PACT_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + PACT_CONCURRENCY).map(work))));
  }

  return out;
}

/** The latest pact each consumer has with the provider, and its latest verification. */
async function fromBroker(
  broker: string,
  provider: string,
  token: string | undefined,
  event: Pick<RetirementInput, 'event' | 'field'>,
): Promise<PactsRead> {
  const base = broker.replace(/\/+$/, '');

  const index = brokerPacts.parse(
    await getJson(`${base}/pacts/provider/${encodeURIComponent(provider)}/latest`, token),
  );

  const links = index._links['pb:pacts'];

  const gaps =
    links.length > MAX_PACTS
      ? [`${links.length - MAX_PACTS} pact(s) past the first ${MAX_PACTS}`]
      : [];

  const found = await few(links.slice(0, MAX_PACTS), async ({ href }): Promise<PactEvidence[]> => {
    // Only links on the broker itself are followed, so a pact cannot send the token elsewhere.
    if (new URL(href, base).origin !== new URL(base).origin) {
      gaps.push(`a pact linked off the broker (${new URL(href, base).origin})`);

      return [];
    }

    let pact: JsonValue | undefined;

    try {
      pact = await getJson(new URL(href, base).href, token);
    } catch (error) {
      gaps.push(`${href}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let evidence: Omit<PactEvidence, 'verified'> | undefined;

    try {
      evidence =
        pact === undefined ? undefined : pactEvidence(pact, { ...event, source: 'Pact Broker' });
    } catch (error) {
      gaps.push(`${href}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!pact || !evidence) return [];

    const link = brokerLinks.parse(pact)._links['pb:latest-verification-results'];

    const result =
      link && new URL(link.href, base).origin === new URL(base).origin
        ? verification.safeParse(
            await getJson(new URL(link.href, base).href, token).catch(() => null),
          )
        : undefined;

    return [
      {
        ...evidence,
        ...(result?.success && {
          verified: {
            success: result.data.success,
            ...(result.data.providerApplicationVersion && {
              version: result.data.providerApplicationVersion,
            }),
          },
        }),
      },
    ];
  });

  return { pacts: found.flat(), gaps };
}

function parseJson(text: string): JsonValue | undefined {
  try {
    return jsonValueSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

/** Pact files on disk: one file, or every `.json` in a folder. */
async function fromFiles(
  source: string,
  event: Pick<RetirementInput, 'event' | 'field'>,
): Promise<PactsRead> {
  const stat = await fs.stat(source);

  const files = stat.isDirectory()
    ? (await fs.readdir(source))
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => path.join(source, name))
    : [source];

  const gaps =
    files.length > MAX_PACTS
      ? [`${files.length - MAX_PACTS} pact file(s) past the first ${MAX_PACTS}`]
      : [];

  const found = await few(files.slice(0, MAX_PACTS), async (file): Promise<PactEvidence[]> => {
    // Sized before it is read, so an oversized file is never held.
    const { size } = await fs.stat(file);

    const pact = size > MAX_PACT_BYTES ? undefined : parseJson(await fs.readFile(file, 'utf8'));

    if (pact === undefined) {
      gaps.push(`${path.basename(file)} is not a pact that could be read`);

      return [];
    }

    try {
      const evidence = pactEvidence(pact, { ...event, source: path.basename(file) });

      return evidence ? [evidence] : [];
    } catch (error) {
      gaps.push(
        `${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  });

  return { pacts: found.flat(), gaps };
}

function findEvent(events: LoadedEvent[], name: string): LoadedEvent {
  const matches = events.filter((e) =>
    name.includes('/')
      ? `${e.frontmatter.domain}/${e.frontmatter.id}` === name
      : e.frontmatter.id === name,
  );

  if (matches.length === 1) return matches[0]!;

  throw new Error(
    matches.length === 0
      ? `no event ${name} in the catalog`
      : `${name} is in more than one domain; name it as domain/id`,
  );
}

/**
 * Whether a field, or a whole event, can be removed yet: every consumer the
 * evidence knows of, where each stands, and what has to happen first.
 */
export async function runRetire(opts: RunRetireOptions): Promise<number> {
  const say = (line: string) => {
    if (!opts.quiet) console.warn(line);
  };

  let event: LoadedEvent;

  try {
    event = findEvent(
      await loadCatalog(path.resolve(opts.events), { skipVersioned: true }),
      opts.event,
    );
  } catch (error) {
    console.error(kleur.red(`✗ ${error instanceof Error ? error.message : String(error)}`));

    return 1;
  }

  const fm = event.frontmatter;
  const key = `${fm.domain}/${fm.id}`;
  const subject = { event: key, ...(opts.field !== undefined && { field: opts.field }) };

  if (opts.field !== undefined && !fieldPaths(event.schema).has(opts.field)) {
    say(`! ${opts.field} is not in the current schema of ${key}; reporting who declared it`);
  }

  const repository = opts.repository ?? (await repositoryName(path.resolve(opts.events)));

  const declared: DeclaredConsumers[] = [
    {
      source: repository ?? 'this repository',
      consumers: fm.consumers,
      fields: fm.consumerFields ?? {},
    },
  ];

  if (opts.catalog) {
    const { graph, publishedAt } = await readCompanyIndex(opts.catalog, {
      tokenEnv: opts.catalogTokenEnv,
    });

    say(`  ${publishedLine('consumers', opts.catalog, publishedAt)}`);

    const elsewhere = consumersFromGraph(graph, { repository }).consumers.get(key);

    if (elsewhere) {
      declared.push({
        source: `company index, default branches${publishedAt ? ` as of ${publishedAt.toISOString().slice(0, 10)}` : ''}`,
        consumers: elsewhere.consumers,
        // What a consumer says for itself outranks the producer's word on it.
        fields: { ...elsewhere.fields, ...elsewhere.own },
      });
    }
  }

  let runtime: RetirementInput['runtime'];

  if (opts.snapshot) {
    const snapshot = await readSnapshot(opts.snapshot);
    const { matches } = matchSnapshot([event], (e) => e.frontmatter, snapshot);
    const [name] = [...matches.keys()];
    const observation = name ? snapshot.events[name] : undefined;

    runtime = {
      source: `snapshot${snapshot.generatedAt ? ` of ${snapshot.generatedAt.slice(0, 10)}` : ''}`,
      consumers: observation?.consumers ?? [],
      sends: observation
        ? opts.field === undefined || (observation.fieldPaths ?? []).includes(opts.field)
        : false,
    };
  }

  let pacts: PactEvidence[] | undefined;
  const gaps: string[] = [];

  if (opts.pacts) {
    try {
      if (/^https?:\/\//i.test(opts.pacts)) {
        const provider = opts.pactProvider ?? fm.producers[0];

        if (!provider) throw new Error(`${key} names no producer; pass --pact-provider`);

        const token = opts.pactTokenEnv ? process.env[opts.pactTokenEnv] : undefined;

        if (opts.pactTokenEnv && !token) throw new Error(`${opts.pactTokenEnv} is not set`);

        const read = await fromBroker(opts.pacts, provider, token, subject);

        pacts = read.pacts;
        gaps.push(...read.gaps);
      } else {
        const read = await fromFiles(path.resolve(opts.pacts), subject);

        pacts = read.pacts;
        gaps.push(...read.gaps);
      }

      // Asked for pacts and found none for the event: a missing download, or
      // descriptions that do not name it. Either way it is not a pass.
      if (pacts.length === 0 && gaps.length === 0) {
        gaps.push(`no pact in ${opts.pacts} has a message for ${key}`);
      }
    } catch (error) {
      // Evidence asked for and not read blocks the verdict; it never reads as a pass.
      gaps.push(
        `pacts from ${opts.pacts} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  const retirement = assessRetirement({
    ...subject,
    declared,
    ...(runtime && { runtime }),
    ...(pacts && { pacts }),
    gaps,
  });

  if (!opts.quiet) {
    console.log(
      opts.format === 'json' ? JSON.stringify(retirement, null, 2) : renderRetirement(retirement),
    );
  }

  return retirement.verdict === 'ready' ? 0 : 1;
}
