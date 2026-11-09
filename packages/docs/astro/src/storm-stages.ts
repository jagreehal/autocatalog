import { z } from 'zod';
import type {
  StickyKind,
  StormColumnView,
  StormRowName,
  StormStickyView,
} from './ui/components/Storm';

const text = z.string().trim().min(1);

// A sticky by its text alone, or with a line to say more and where it leads.
const sticky = z.union([
  text.transform((value) => ({ text: value })),
  z
    .object({
      text,
      summary: text.optional(),
      href: text.optional(),
      hotspot: z.boolean().optional(),
    })
    .strict(),
]);

const stickies = z
  .union([z.array(sticky), sticky.transform((one) => [one])])
  .optional()
  .transform((value) => value ?? []);

const stageSchema = z
  .object({
    stage: text,
    repeats: text.optional(),
    actor: stickies,
    system: stickies,
    readModel: stickies,
    command: stickies,
    decidedBy: stickies,
    event: stickies,
    failure: stickies,
    policy: stickies,
    hotspot: stickies,
  })
  .strict();

/**
 * A stage of a board written by hand in MDX. Each row takes one sticky or a
 * list; a sticky is its text, or `{ text, summary, href, hotspot }`.
 */
export type StormStage = z.input<typeof stageSchema>;

type Parsed = z.output<typeof stageSchema>;

const ROW_OF: Array<[Exclude<keyof Parsed, 'stage' | 'repeats'>, StickyKind, StormRowName]> = [
  ['actor', 'actor', 'who'],
  ['system', 'system', 'who'],
  ['readModel', 'read-model', 'who'],
  ['command', 'command', 'command'],
  ['decidedBy', 'aggregate', 'decidedBy'],
  ['event', 'event', 'happy'],
  ['failure', 'failure', 'failure'],
  ['policy', 'policy', 'policy'],
  ['hotspot', 'hotspot', 'policy'],
];

/** Hand-written stages as the board's columns, or what is wrong with them. */
export function stormColumns(stages: StormStage[]): StormColumnView[] {
  const parsed = z.array(stageSchema).min(1).safeParse(stages);

  if (!parsed.success) {
    throw new Error(`<Storm stages>: ${z.prettifyError(parsed.error).replace(/\n+/g, '; ')}`);
  }

  return parsed.data.map((stage) => {
    const rows: Record<StormRowName, StormStickyView[]> = {
      who: [],
      command: [],
      decidedBy: [],
      happy: [],
      failure: [],
      policy: [],
    };

    for (const [field, kind, row] of ROW_OF) {
      rows[row].push(
        ...stage[field].map(({ text: value, ...rest }) => ({
          kind,
          text: value,
          summary: 'summary' in rest ? rest.summary : undefined,
          href: 'href' in rest ? rest.href : undefined,
          hotspots: 'hotspot' in rest && rest.hotspot ? 1 : undefined,
        })),
      );
    }

    return { stage: stage.stage, repeats: stage.repeats, rows };
  });
}
