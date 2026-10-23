import fs from 'node:fs/promises';
import path from 'node:path';
import type { AdapterEvent } from './adapter-event';
import type { EventFrontmatter } from './schema';
import { generateExampleFromSchema } from './example-gen';
import { isJsonObject } from './json';
import { ownerForPath, parseCodeowners, type CodeownersRule } from './codeowners';

/**
 * The CODEOWNERS that covers `root`: its own, or, for a package inside a
 * monorepo, the nearest one above it, read no higher than `within`.
 */
export async function loadCodeowners(root: string, within = root): Promise<CodeownersRule[]> {
  const top = path.resolve(within);

  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    for (const rel of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']) {
      try {
        const rules = parseCodeowners(await fs.readFile(path.join(dir, rel), 'utf8'));
        const base = path.relative(dir, path.resolve(root)).split(path.sep).join('/');

        return base ? rules.map((rule) => ({ ...rule, base })) : rules;
      } catch {
        // try the next location
      }
    }

    if (dir === top || !dir.startsWith(top + path.sep)) return [];
  }
}

/** No declared team + a CODEOWNERS match on the defining file → inferred owner. */
export function inferOwnership(event: AdapterEvent, rules: CodeownersRule[]): void {
  if (event.meta?.team || rules.length === 0 || !event.source?.file) return;
  const owner = ownerForPath(rules, event.source.file);

  if (!owner) return;
  event.meta = { ...event.meta, team: owner };
  event.provenance = {
    default: event.provenance?.default ?? 'extracted',
    fields: { ...event.provenance?.fields, owner: 'inferred' },
  };
}

/** No example anywhere → generate a deterministic baseline from the schema. */
export function generateMissingExample(event: AdapterEvent): void {
  if (event.examples.length > 0) return;
  const generated = generateExampleFromSchema(event.schema);

  if (!isJsonObject(generated) && !Array.isArray(generated)) return;

  const data =
    event.meta?.envelope?.mode === 'structured'
      ? {
          specversion: '1.0',
          id: `${event.id}-example`,
          source: '/autocatalog/examples',
          type: event.id,
          data: generated,
        }
      : generated;

  event.examples = [{ name: 'generated', data }];
  event.provenance = {
    default: event.provenance?.default ?? 'extracted',
    fields: { ...event.provenance?.fields, examples: 'inferred' },
  };
}

export function enrichEvent(event: AdapterEvent, rules: CodeownersRule[]): void {
  inferOwnership(event, rules);
  generateMissingExample(event);
}

/**
 * Where an event's contract was found and how we know, as parts each surface
 * formats for itself: a markdown line for EventCatalog, markup for the site.
 */
export interface ProvenanceSummary {
  /** `file:line`, or the repository when no file is recorded. */
  location: string | null;
  symbol: string | null;
  /** e.g. ['extracted', 'confidence 95%', 'needs review'] */
  facts: string[];
}

export function provenanceSummary(frontmatter: EventFrontmatter): ProvenanceSummary {
  const { source, provenance, confidence, needsReview } = frontmatter;

  const location = source?.file
    ? `${source.file}${source.line ? `:${source.line}` : ''}`
    : (source?.repo ?? null);

  return {
    location,
    // A JSON Schema file's "symbol" is its own filename, which says nothing new.
    symbol: source?.symbol && !location?.endsWith(source.symbol) ? source.symbol : null,
    facts: [
      provenance.default,
      ...(confidence === undefined ? [] : [`confidence ${Math.round(confidence * 100)}%`]),
      ...(needsReview ? ['needs review'] : []),
    ],
  };
}
