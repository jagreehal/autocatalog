import { Model, Resource } from '@eventcatalog/visualiser/model';
import { z } from 'zod';

/** The event `ac site` dev's server sends its pages when a design file changes on disk: `{ file }`. */
export const DESIGN_CHANGED = 'autocatalog:design-changed';

/**
 * Studio's model as the design editor's canvas holds it: EventCatalog's
 * `Model`, with each resource's catalog `ref` kept beside it, so the canvas
 * carries the reference and a save writes it back.
 */
export const canvasModel = Model.extend({
  // Studio's model wants a resource; a design just started has none yet.
  resources: z.array(Resource.extend({ ref: z.string().optional() })),
});

export type CanvasModel = z.output<typeof canvasModel>;

const evidence = z.object({
  state: z.enum(['observed', 'unseen', 'undocumented']),
  count: z.number(),
  event: z.string(),
  producer: z.string().optional(),
});

const review = z.object({
  changes: z.string(),
  added: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
  impact: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      owner: z.string().optional(),
      changes: z.array(z.string()),
      dependents: z.array(z.string()),
    }),
  ),
  runtime: z
    .object({
      relations: z.array(
        z.object({ from: z.string(), to: z.string(), kind: z.string(), evidence }),
      ),
      undrawn: z.array(
        z.object({
          event: z.string(),
          service: z.string(),
          role: z.enum(['produces', 'consumes']),
          count: z.number(),
        }),
      ),
    })
    .optional(),
});

/** What the editor opens with, and fetches again when its file changes on disk. */
export const openedDesign = z.object({ model: canvasModel, review });

/** What the editor hears back: what the design asks of the catalog, or why it does not hold. */
export const designCheck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), review, warnings: z.array(z.string()), saved: z.boolean() }),
  z.object({ ok: z.literal(false), errors: z.array(z.string()), warnings: z.array(z.string()) }),
]);

export type DesignCheck = z.output<typeof designCheck>;
