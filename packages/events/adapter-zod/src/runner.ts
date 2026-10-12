import path from 'node:path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import { isCurveItem, isExplicitEvent, toAdapterEvent } from './curve-mapper';
import { writeEventFolder } from './writer';

export interface RunAdapterOptions {
  module: string;
  exportName: string;
  out: string;
}

export interface RunAdapterResult {
  eventsWritten: number;
  errors: string[];
}

export async function runAdapter(opts: RunAdapterOptions): Promise<RunAdapterResult> {
  const absModule = path.resolve(opts.module);
  const jiti = createJiti(import.meta.url, { interopDefault: true });

  const parsed = z
    .looseObject({ [opts.exportName]: z.array(z.unknown()) })
    .safeParse(await jiti.import(absModule));

  if (!parsed.success) {
    throw new Error(
      `Expected export "${opts.exportName}" in ${absModule} to be an array: ${z.prettifyError(parsed.error)}`,
    );
  }

  const items = parsed.data[opts.exportName] ?? [];

  const errors: string[] = [];
  let written = 0;

  for (const item of items) {
    try {
      if (!isExplicitEvent(item) && !isCurveItem(item)) {
        throw new Error(`Unrecognised item shape: ${JSON.stringify(item).slice(0, 80)}`);
      }

      const event = toAdapterEvent(item);
      await writeEventFolder({ outRoot: opts.out, event });
      written++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { eventsWritten: written, errors };
}
