import type { JsonObject, JsonValue } from './json';

export interface LlmEventInput {
  id: string;
  version: string;
  name: string;
  summary: string;
  domain: string;
  producers: string[];
  consumers: string[];
  schema: JsonObject;
  body?: string; // long-form description (MDX body)
  examples: Array<{ name: string; data: JsonValue }>;
}

export function eventToLlmText(event: LlmEventInput): string {
  const sections: string[] = [];
  sections.push(`# ${event.name}`);
  sections.push('');
  sections.push(`id: ${event.id}`);
  sections.push(`version: ${event.version}`);
  sections.push(`domain: ${event.domain}`);
  sections.push(`summary: ${event.summary}`);

  if (event.producers.length > 0) sections.push(`Produced by: ${event.producers.join(', ')}`);

  if (event.consumers.length > 0) sections.push(`Consumed by: ${event.consumers.join(', ')}`);

  if (event.body && event.body.trim().length > 0) {
    sections.push('');
    sections.push('## Description');
    sections.push(event.body.trim());
  }

  sections.push('');
  sections.push('## Schema');
  sections.push('```json');
  sections.push(JSON.stringify(event.schema, null, 2));
  sections.push('```');

  for (const ex of event.examples) {
    sections.push('');
    sections.push(`## Example: ${ex.name}`);
    sections.push('```json');
    sections.push(JSON.stringify(ex.data, null, 2));
    sections.push('```');
  }

  return sections.join('\n');
}

export function catalogToLlmText(events: LlmEventInput[]): string {
  const sorted = [...events].sort((a, b) => {
    const d = a.domain.localeCompare(b.domain);

    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const toc = sorted.map((e) => `- ${e.domain} / ${e.id} (v${e.version}) — ${e.summary}`);
  const body = sorted.map(eventToLlmText).join('\n\n---\n\n');
  const domainCount = new Set(sorted.map((e) => e.domain)).size;

  return [
    '# Event Catalog',
    '',
    `${sorted.length} event${sorted.length === 1 ? '' : 's'} across ${domainCount} domain${domainCount === 1 ? '' : 's'}.`,
    '',
    '## Contents',
    ...toc,
    '',
    '---',
    '',
    body,
  ].join('\n');
}
