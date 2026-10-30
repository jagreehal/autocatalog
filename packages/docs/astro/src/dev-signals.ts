import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// What `ac site` dev's server tells itself across module instances: the
// integration (routes.ts) runs in Node, the pages and endpoints in Vite's
// server runtime, in the one process. A module variable would be two
// variables, so these live in the process's environment.

const SAVED = 'AUTOCATALOG_DESIGN_SAVED';

const CHANGED_AT = 'AUTOCATALOG_DESIGNS_CHANGED_AT';

const at = (key: string) => Number(process.env[key] ?? 0);

// What the editor last wrote to each file, by digest, and which tab wrote it: a
// change is that tab's only while the file still holds exactly that, however
// soon someone else writes it.
const savedKey = (file: string) => `${SAVED}:${path.resolve(file)}`;

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** An editor tab (`by`) wrote this design, with this text. */
export const markSaved = (file: string, text: string, by: string) => {
  process.env[savedKey(file)] = `${digest(text)} ${by}`;
};

/**
 * The editor tab whose save the file holds now, when it holds one: that tab
 * already shows it, and every other page on the file does not.
 */
export const savedBy = (file: string): string | undefined => {
  const [saved, by] = process.env[savedKey(file)]?.split(' ') ?? [];

  if (!saved || !fs.existsSync(file) || digest(fs.readFileSync(file, 'utf8')) !== saved) {
    return undefined;
  }

  return by;
};

/** A design file changed on disk, by the editor or anyone else: the catalog read before is stale. */
export const markDesignsChanged = () => {
  process.env[CHANGED_AT] = String(Date.now());
};

/** When a design file last changed on disk; 0 when none has since the server started. */
export const designsChangedAt = () => at(CHANGED_AT);
