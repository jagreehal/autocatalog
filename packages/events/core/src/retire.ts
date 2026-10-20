import { z } from 'zod';
import { isSafeName, UNSAFE_CONSUMER } from './consumes';
import { overlaps } from './drift';
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from './json';
import { normaliseEventId } from './snapshot';

/**
 * Where one consumer stands on a retirement, worst first: it reads what goes,
 * it receives the event but declares nothing, it declares no fields, or it is
 * clear.
 */
export type ConsumerStanding = 'reads' | 'unknown' | 'unspecified' | 'clear';

const RANK: ConsumerStanding[] = ['reads', 'unknown', 'unspecified', 'clear'];

export interface RetirementEvidence {
  /** Where the evidence came from: this repository, the company index, a pact, a snapshot. */
  source: string;
  says: string;
  /** Absent for evidence that informs but decides nothing, such as being seen at runtime. */
  standing?: ConsumerStanding;
}

export interface ConsumerRetirement {
  consumer: string;
  standing: ConsumerStanding;
  evidence: RetirementEvidence[];
}

export interface Retirement {
  event: string;
  field?: string;
  verdict: 'ready' | 'blocked';
  consumers: ConsumerRetirement[];
  /** What the producer was last seen sending, from a snapshot. */
  runtime?: string;
  /** Evidence that could not be read, so the verdict cannot be ready. */
  gaps: string[];
  next: string[];
}

/** Consumers some source declares, with the fields each says it reads. */
export interface DeclaredConsumers {
  source: string;
  consumers: string[];
  fields: Record<string, string[]>;
}

export interface PactEvidence {
  source: string;
  consumer: string;
  /** Whether a message for the event carries the field. */
  usesField: boolean;
  /** The provider's latest verification of the pact, when the broker has one. */
  verified?: { success: boolean; version?: string };
}

export interface RetirementInput {
  /** `domain/id`. */
  event: string;
  /** The payload path to retire; without one, the whole event. */
  field?: string;
  declared: DeclaredConsumers[];
  runtime?: {
    source: string;
    consumers: string[];
    /** Whether the producer still sends the field, or the event, when the source says. */
    sends?: boolean;
  };
  pacts?: PactEvidence[];
  /** Evidence asked for that could not be read in full. Any gap blocks the verdict. */
  gaps?: string[];
}

// Gaps and versions quote text from elsewhere, printed into a pull request.
const printableGap = (gap: string): string => gap.replaceAll(/[\p{Cc}`|<>[\]!@]/gu, ' ');

const printable = (name: string): string => (isSafeName(name) ? name : UNSAFE_CONSUMER);

/** What the declared fields say of one consumer. */
function declaredStanding(field: string | undefined, fields: string[] | undefined) {
  if (field === undefined) return { standing: 'reads' as const, says: 'consumes the event' };

  if (!fields) return { standing: 'unspecified' as const, says: 'declares no fields it reads' };

  return fields.some((declared) => overlaps(field, declared))
    ? { standing: 'reads' as const, says: `reads ${field}` }
    : {
        standing: 'clear' as const,
        says: `reads ${fields.join(', ') || 'no fields'}, not ${field}`,
      };
}

/**
 * Whether a field, or an event, can go: every consumer the evidence knows of,
 * and where each stands. Silence decides nothing, so a consumer that declares
 * no fields, or that runs but declares nothing, blocks until someone finds out.
 * A pact or a declaration that names the fields settles it either way.
 */
export function assessRetirement(input: RetirementInput): Retirement {
  const evidence = new Map<string, RetirementEvidence[]>();

  const add = (consumer: string, found: RetirementEvidence) =>
    evidence.set(printable(consumer), [...(evidence.get(printable(consumer)) ?? []), found]);

  for (const declared of input.declared) {
    for (const consumer of declared.consumers) {
      add(consumer, {
        source: declared.source,
        ...declaredStanding(
          input.field,
          Object.hasOwn(declared.fields, consumer) ? declared.fields[consumer] : undefined,
        ),
      });
    }
  }

  for (const pact of input.pacts ?? []) {
    const verified = pact.verified
      ? `; ${pact.verified.success ? 'verified' : 'failed verification'}${pact.verified.version ? ` against ${printableGap(pact.verified.version)}` : ''}`
      : '; not verified';

    add(pact.consumer, {
      source: pact.source,
      standing: input.field === undefined || pact.usesField ? 'reads' : 'clear',
      says:
        input.field === undefined
          ? `has a pact for the event${verified}`
          : `pact ${pact.usesField ? 'expects' : 'does not use'} ${input.field}${verified}`,
    });
  }

  if (input.runtime) {
    const known = new Set(evidence.keys());

    for (const consumer of input.runtime.consumers) {
      add(consumer, {
        source: input.runtime.source,
        says: 'seen receiving the event',
        ...(!known.has(printable(consumer)) && { standing: 'unknown' as const }),
      });
    }
  }

  const consumers = [...evidence]
    .map(([consumer, found]): ConsumerRetirement => {
      const standings = found.flatMap((e) => e.standing ?? []);
      // A source that names fields outranks one that says nothing about them.
      const decided = standings.filter((s) => s !== 'unspecified');
      const pool = decided.length > 0 ? decided : standings;

      return {
        consumer,
        standing: RANK.find((rank) => pool.includes(rank)) ?? 'unknown',
        evidence: found,
      };
    })
    .sort(
      (a, b) =>
        RANK.indexOf(a.standing) - RANK.indexOf(b.standing) || a.consumer.localeCompare(b.consumer),
    );

  const what = input.field ?? input.event;

  const next = consumers.flatMap(({ consumer, standing }) =>
    standing === 'reads'
      ? [`${consumer} moves off ${what}`]
      : standing === 'unknown'
        ? [`Find out whether ${consumer} needs ${what}: it receives the event and declares nothing`]
        : standing === 'unspecified'
          ? [`${consumer} declares the fields it reads, in autocatalog.consumes.json`]
          : [],
  );

  const gaps = input.gaps ?? [];

  if (gaps.length > 0) next.push('Read the evidence that is missing, then ask again');

  const verdict = next.length === 0 ? 'ready' : 'blocked';

  if (verdict === 'ready') {
    next.push(
      input.field
        ? `Remove ${input.field} and bump the event's major version`
        : `Remove ${input.event}, or mark it deprecated first`,
    );
  }

  return {
    event: input.event,
    ...(input.field !== undefined && { field: input.field }),
    verdict,
    consumers,
    gaps,
    ...(input.runtime && {
      runtime: `${input.runtime.sends === undefined ? 'seen' : input.runtime.sends ? 'still sent' : 'not sent'} (${input.runtime.source})`,
    }),
    next,
  };
}

const LABEL: Record<ConsumerStanding, string> = {
  reads: 'needs it',
  unknown: 'unknown',
  unspecified: 'unspecified',
  clear: 'clear',
};

/** The assessment as Markdown, for a pull request or a terminal. */
export function renderRetirement(retirement: Retirement): string {
  const what = retirement.field
    ? `\`${retirement.field}\` from ${retirement.event}`
    : retirement.event;

  const lines = [
    `## Removing ${what}: ${retirement.verdict}`,
    '',
    ...(retirement.consumers.length === 0
      ? ['No consumer is known to anything that was read.']
      : []),
    ...retirement.consumers.map(
      ({ consumer, standing, evidence }) =>
        `- **${consumer}**: ${LABEL[standing]}. ${evidence.map((e) => `${e.says} (${e.source})`).join('; ')}`,
    ),
    ...(retirement.runtime ? ['', `Producer: ${retirement.runtime}.`] : []),
    ...(retirement.gaps.length > 0
      ? ['', `Missing evidence: ${retirement.gaps.map(printableGap).join('; ')}.`]
      : []),
    '',
    `Next: ${retirement.next.join('. ')}.`,
  ];

  return `${lines.join('\n')}\n`;
}

// Strict where it matters: a document that does not read as a pact is missing
// evidence, never a pact without the field.
const pactDocument = z
  .looseObject({
    consumer: z.object({ name: z.string() }),
    messages: z
      .array(z.looseObject({ description: z.string(), contents: jsonValueSchema.optional() }))
      .optional(),
    interactions: z
      .array(
        z.union([
          z.looseObject({
            type: z.string(),
            description: z.string(),
            contents: jsonValueSchema.optional(),
          }),
          // Pact 3 HTTP interactions carry no type, so they must read as HTTP to be set aside.
          z.looseObject({
            type: z.never().optional(),
            description: z.string(),
            request: z.looseObject({ method: z.string(), path: z.string() }),
            response: z.looseObject({ status: z.number().int() }),
            contents: z.never().optional(),
          }),
        ]),
      )
      .optional(),
  })
  .refine((pact) => pact.messages || pact.interactions, 'has no messages or interactions');

const synchronous = z.looseObject({
  request: z.looseObject({ contents: jsonValueSchema.optional() }).optional(),
  response: z.array(z.looseObject({ contents: jsonValueSchema.optional() })).optional(),
});

const pact4Contents = z.looseObject({
  content: jsonValueSchema,
  encoded: z.union([z.string(), z.boolean()]).optional(),
});

/**
 * A Pact 4 body as JSON. One that is encoded, or not JSON, cannot be searched
 * for the field, so it is missing evidence, never a body without the field.
 */
function pact4Body(contents: JsonValue): JsonValue {
  const wrapped = pact4Contents.safeParse(contents);

  if (!wrapped.success) return contents;

  if (wrapped.data.encoded || z.string().safeParse(wrapped.data.content).success) {
    throw new Error('a message body that is not JSON cannot be read');
  }

  return wrapped.data.content;
}

/** Whether a payload carries a path such as `customer.id` or `items[].sku`. */
function carries(value: JsonValue | undefined, path: string[]): boolean {
  if (path.length === 0) return value !== undefined;

  const [head, ...rest] = path;
  const array = head!.endsWith('[]');
  const key = array ? head!.slice(0, -2) : head!;

  const child = jsonObjectSchema.safeParse(value);

  if (!child.success || !Object.hasOwn(child.data, key)) return false;

  const next = child.data[key];

  if (!array) return carries(next, rest);

  const items = z.array(jsonValueSchema).safeParse(next);

  return items.success && items.data.some((item) => carries(item, rest));
}

/**
 * What one pact file says of an event: its messages whose description names
 * the event, as `order.placed` or `OrderPlaced`, and whether any carries the
 * field. Nothing when the pact has no message for it; throws when the document
 * is not a pact.
 */
export function pactEvidence(
  pact: JsonValue,
  options: { event: string; field?: string; source: string },
): Omit<PactEvidence, 'verified'> | undefined {
  const parsed = pactDocument.safeParse(pact);

  if (!parsed.success) {
    throw new Error(`not a pact (${parsed.error.issues[0]?.message ?? 'unreadable'})`);
  }

  const id = normaliseEventId(options.event.split('/').at(-1)!);

  const messages = [
    ...(parsed.data.messages ?? []).map((m) => ({
      description: m.description,
      contents: m.contents,
    })),
    // Pact 4 keeps each body under `contents`, and a synchronous message has a
    // request and responses besides.
    ...(parsed.data.interactions ?? [])
      .filter((i) => i.type?.includes('Message'))
      .flatMap((i) => {
        const exchange = synchronous.safeParse(i).data;

        return [
          i.contents,
          exchange?.request?.contents,
          ...(exchange?.response ?? []).map((r) => r.contents),
        ].flatMap((contents) =>
          contents === undefined
            ? []
            : [{ description: i.description, contents: pact4Body(contents) }],
        );
      }),
  ].filter((m) => normaliseEventId(m.description).includes(id));

  if (messages.length === 0) return undefined;

  const path = options.field?.split('.') ?? [];

  return {
    source: options.source,
    consumer: parsed.data.consumer.name,
    usesField: options.field === undefined || messages.some((m) => carries(m.contents, path)),
  };
}
