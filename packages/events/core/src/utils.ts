import fs from 'node:fs';
import path from 'node:path';

/**
 * Directories no scanner ever descends into.
 *
 * The catalog's own output root is skipped by resolved path, never by name:
 * a repository is free to keep its schemas in a directory called `events/`,
 * and that is the likeliest place to find them.
 */
export const DEFAULT_SCAN_EXCLUDE = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.autocatalog',
  'coverage',
  '.turbo',
  '.pnpm-store',
];

export function pascalCase(input: string): string {
  return input
    .split(/[.\-_/]/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');
}

const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }

    previous = current;
  }

  return previous[b.length]!;
};

/** The candidate a mistyped reference most likely meant, for a "did you mean" hint. */
// ponytail: edit distance over every candidate, fine for catalogs in the thousands.
export function closestMatch(ref: string, candidates: string[]): string | undefined {
  const best = candidates
    .map((candidate) => ({ candidate, d: distance(ref, candidate) }))
    .sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate))[0];

  return best && best.d <= Math.max(2, Math.floor(ref.length / 4)) ? best.candidate : undefined;
}

/**
 * Refuse a catalog value that becomes a directory name — an event's domain,
 * id or version, a service name — when it could climb out of its parent
 * (`..`, a slash) or names nothing. Catalog content comes from repositories,
 * so it is never trusted as a path.
 */
export function assertPathSegment(where: string, field: string, value: string): void {
  // eslint-disable-next-line no-control-regex -- control characters are what is being refused
  if (value === '' || value === '.' || value === '..' || /[/\\\u0000-\u001f]/.test(value)) {
    throw new Error(`${where}: ${field} ${JSON.stringify(value)} cannot be a path segment`);
  }
}

/**
 * Whether `file` is a regular file whose real path is inside `repository`. An
 * enrolled repository is another team's: a symlink could name any file on
 * this machine, and its content would surface in the build.
 */
export function isRealFileInside(repository: string, file: string): boolean {
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) return false;

  return fs.realpathSync(file).startsWith(`${fs.realpathSync(repository)}${path.sep}`);
}
