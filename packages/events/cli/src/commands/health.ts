import path from 'node:path';
import kleur from 'kleur';
import { loadCatalog, scoreEvent } from 'autocatalog-core';

export interface RunHealthOptions {
  cwd: string;
  min?: number; // fail if any event scores below this
  quiet?: boolean;
}

export async function runHealth(opts: RunHealthOptions): Promise<number> {
  const events = await loadCatalog(path.join(opts.cwd, 'events'), { skipVersioned: true });

  if (events.length === 0) {
    if (!opts.quiet) console.log('No events found.');

    return 1;
  }

  const scores = events.map(scoreEvent).sort((a, b) => a.score - b.score);

  if (!opts.quiet) {
    for (const s of scores) {
      const color = s.score >= 80 ? kleur.green : s.score >= 50 ? kleur.yellow : kleur.red;
      console.log(`${color(String(s.score).padStart(3))}  ${s.domain}/${s.eventId}`);

      for (const check of s.checks.filter((c) => !c.earned)) {
        console.log(kleur.dim(`      -${check.points} ${check.name}: ${check.hint}`));
      }
    }

    const avg = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
    console.log(kleur.bold(`\naverage ${avg}/100 across ${scores.length} event(s)`));
  }

  const min = opts.min;

  if (min !== undefined && scores.some((s) => s.score < min)) return 1;

  return 0;
}
