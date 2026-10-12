import fs from 'node:fs';
import { z } from 'astro/zod';

/**
 * The EventCatalog diagrams `ac site --eventcatalog` built into this site:
 * paths relative to the site base, keyed by event id and service name. Absent
 * unless that flag ran, and then nothing about EventCatalog appears.
 */
const embedsSchema = z.object({
  /** EventCatalog's chrome-free embed mode, which it unlocks only with its own licence key. */
  embed: z.boolean(),
  graph: z.string(),
  events: z.record(z.string(), z.string()),
  services: z.record(z.string(), z.string()),
});

export type EventCatalogEmbeds = z.infer<typeof embedsSchema>;

let cached: EventCatalogEmbeds | undefined | null = null;

export function eventCatalogEmbeds(): EventCatalogEmbeds | undefined {
  if (cached === null) {
    const file = process.env.AUTOCATALOG_EVENTCATALOG;
    cached = file ? embedsSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : undefined;
  }

  return cached;
}
