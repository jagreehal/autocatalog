import fs from 'node:fs/promises';
import path from 'node:path';
import { type JsonValue, jsonValueSchema } from './json';
import { DEFAULT_SCAN_EXCLUDE, isRealFileInside } from './utils';

export interface ResourceScanOptions {
  root: string;
  exclude?: string[];
  outDir?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  signal?: AbortSignal;
}

export interface ResourceFileFilter {
  /** Only files this accepts are listed and counted towards the file limit. */
  include?: (file: string) => boolean;
  /**
   * Where an unreadable directory or the file limit is reported. With it, a scan
   * degrades to what it could list; without it, either one throws.
   */
  skipped?: string[];
}

export async function resourceFiles(
  options: ResourceScanOptions,
  filter: ResourceFileFilter = {},
): Promise<string[]> {
  const files: string[] = [];
  const ignored = new Set([...DEFAULT_SCAN_EXCLUDE, ...(options.exclude ?? [])]);
  const root = path.resolve(options.root);
  const limit = options.maxFiles ?? 10000;
  let full = false;

  const report = (message: string) => {
    if (!filter.skipped) throw new Error(message);
    filter.skipped.push(message);
  };

  async function walk(directory: string): Promise<void> {
    options.signal?.throwIfAborted();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => undefined);

    if (!entries) {
      report(`${path.relative(root, directory)}: directory could not be read`);

      return;
    }

    for (const entry of entries) {
      if (full) return;

      if (ignored.has(entry.name)) continue;
      const file = path.join(directory, entry.name);

      if (options.outDir && path.resolve(options.outDir) === file) continue;

      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && (filter.include?.(file) ?? true)) {
        if (files.length >= limit) {
          full = true;
          report(
            `Stopped after ${limit} candidate files (the file limit); the rest of the repository was not scanned`,
          );

          return;
        }

        files.push(file);
      }
    }
  }

  await walk(root);

  return files.sort();
}

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Why a repository file was not read; the message names it relative to the repository. */
export class ResourceReadError extends Error {
  constructor(
    readonly reason: 'missing' | 'outside' | 'too-large' | 'not-json' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Read one of the repository's own files. Only a regular file whose real path
 * is inside the repository is read: a symlink could name any file on this
 * machine, and what a scan reads is published. Errors name the file and never
 * quote it.
 */
export async function readResourceSource(
  file: string,
  options: Pick<ResourceScanOptions, 'root' | 'maxFileBytes'>,
): Promise<string> {
  const relative = path.relative(options.root, file).split(path.sep).join('/');
  const stat = await fs.lstat(file).catch(() => undefined);

  if (!stat) throw new ResourceReadError('missing', `${relative}: not found`);

  if (!isRealFileInside(options.root, file)) {
    throw new ResourceReadError(
      'outside',
      `${relative}: not a regular file inside the repository, so it is not read`,
    );
  }

  const limit = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (stat.size > limit) {
    throw new ResourceReadError('too-large', `${relative}: larger than ${limit} bytes`);
  }

  return fs.readFile(file, 'utf8');
}

/** {@link readResourceSource}, parsed as JSON. A parse error does not quote the file. */
export async function readResourceJson(
  file: string,
  options: Pick<ResourceScanOptions, 'root' | 'maxFileBytes'>,
): Promise<JsonValue> {
  const text = await readResourceSource(file, options);
  let value: JsonValue;

  try {
    value = jsonValueSchema.parse(JSON.parse(text));
  } catch {
    const relative = path.relative(options.root, file).split(path.sep).join('/');

    throw new ResourceReadError('not-json', `${relative}: not valid JSON`);
  }

  return value;
}

/** {@link readResourceJson}, or undefined when the file does not exist. */
export async function readOptionalResourceJson(
  file: string,
  options: Pick<ResourceScanOptions, 'root' | 'maxFileBytes'>,
): Promise<JsonValue | undefined> {
  try {
    return await readResourceJson(file, options);
  } catch (error) {
    if (error instanceof ResourceReadError && error.reason === 'missing') return undefined;
    throw error;
  }
}
