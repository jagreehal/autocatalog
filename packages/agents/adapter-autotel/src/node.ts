import { readFile } from 'node:fs/promises';
import { parseOtlpJson } from './parse.js';
import type { Observations } from './parse.js';

export const loadObservations = async (filepath: string): Promise<Observations> => {
  const raw = await readFile(filepath, 'utf8');

  return parseOtlpJson(raw);
};
