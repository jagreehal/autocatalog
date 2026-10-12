import { z } from 'zod';
import { jsonValueSchema, type JsonObject, type JsonValue } from './json';
import { pascalCase } from './utils';

export interface SnippetInput {
  id: string;
  version: string;
  name: string;
  domain: string;
  schema: JsonObject;
  example?: JsonValue;
  baseUrl?: string;
}

export interface Snippets {
  curl: string;
  zod: string;
  pydantic: string;
  ref: string;
}

// The keywords a snippet reads from a property schema. A keyword of the wrong
// type is ignored, as is a property schema that is not an object (`true`).
const fieldSchema = z
  .object({
    type: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .catch(undefined),
    enum: z.array(jsonValueSchema).optional().catch(undefined),
    format: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  })
  .catch({});

type Field = z.infer<typeof fieldSchema>;

const objectSchema = z.object({
  properties: z.record(z.string(), fieldSchema).optional().catch(undefined),
  required: z.array(z.string()).optional().catch(undefined),
});

function jsonType(s: Field): string {
  return (Array.isArray(s.type) ? s.type[0] : s.type) ?? 'unknown';
}

function zodEnumValue(v: JsonValue): string {
  const text = z.string().safeParse(v);

  return text.success ? `'${text.data}'` : JSON.stringify(v);
}

function zodForField(s: Field): string {
  if (s.enum) return `z.enum([${s.enum.map(zodEnumValue).join(', ')}])`;
  const t = jsonType(s);

  if (t === 'string' && s.format === 'date-time') return 'z.string().datetime()';

  if (t === 'string') return 'z.string()';

  if (t === 'integer') return 'z.number().int()';

  if (t === 'number') return 'z.number()';

  if (t === 'boolean') return 'z.boolean()';

  if (t === 'object') return 'z.object({}).passthrough()';

  if (t === 'array') return 'z.array(z.unknown())';

  return 'z.unknown()';
}

function pyForField(s: Field): string {
  if (s.enum) {
    const literals = s.enum.map((v) => JSON.stringify(v)).join(', ');

    return `Literal[${literals}]`;
  }

  const t = jsonType(s);

  if (t === 'string') return 'str';

  if (t === 'integer') return 'int';

  if (t === 'number') return 'float';

  if (t === 'boolean') return 'bool';

  if (t === 'object') return 'dict';

  if (t === 'array') return 'list';

  return 'Any';
}

export function generateSnippets(input: SnippetInput): Snippets {
  const baseUrl = input.baseUrl ?? '';
  const ref = `${baseUrl}/events/${input.domain}/${input.id}/schema.json`;

  // curl
  const examplePayload = input.example ?? {};

  const curl =
    `curl -X POST ${baseUrl}/${input.id} \\\n` +
    `  -H 'Content-Type: application/json' \\\n` +
    `  -d '${JSON.stringify(examplePayload)}'`;

  // zod
  const object = objectSchema.parse(input.schema);
  const props = object.properties ?? {};
  const required = new Set(object.required ?? []);

  const zodLines = Object.entries(props).map(([key, s]) => {
    const base = zodForField(s);

    const desc = s.description === undefined ? '' : `.describe(${JSON.stringify(s.description)})`;

    const tail = required.has(key) ? '' : '.optional()';

    return `  ${key}: ${base}${desc}${tail},`;
  });

  const zod =
    `import { z } from 'zod';\n\n` +
    `export const ${pascalCase(input.id)}Schema = z.object({\n${zodLines.join('\n')}\n});\n\n` +
    `export type ${pascalCase(input.id)} = z.infer<typeof ${pascalCase(input.id)}Schema>;`;

  // pydantic
  const pyLines = Object.entries(props).map(([key, s]) => {
    const base = pyForField(s);
    const optional = required.has(key) ? base : `Optional[${base}] = None`;

    return `    ${key}: ${optional}`;
  });

  const hasOptional = Object.entries(props).some(([k]) => !required.has(k));
  const hasLiteral = Object.values(props).some((s) => !!s.enum);

  const imports = [
    'from pydantic import BaseModel',
    ...(hasOptional ? ['from typing import Optional'] : []),
    ...(hasLiteral ? ['from typing import Literal'] : []),
  ];

  const pydantic = `${imports.join('\n')}\n\nclass ${pascalCase(input.id)}(BaseModel):\n${pyLines.join('\n')}\n`;

  return { curl, zod, pydantic, ref };
}
