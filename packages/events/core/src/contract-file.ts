import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseProto } from 'protobufjs';
import { parse as parseYaml } from 'yaml';
import { isJsonObject, jsonValueSchema, type JsonObject } from './json';
import { eventFromAvroSchema, looksLikeAvroSchema } from './scan-avro';
import { eventsFromProtoRoot } from './scan-protobuf';
import { pascalCase } from './utils';

/**
 * A contract a catalog declared for one event, read and translated into the
 * JSON Schema the catalog stores. Used where another tool names the file, such
 * as an EventCatalog `schemaPath`.
 */
export type ContractFileResult =
  { ok: true; schema: JsonObject; format: string } | { ok: false; reason: string };

/**
 * Read `file` and return its JSON Schema. JSON and YAML files are taken as
 * JSON Schema unless they are an Avro record; `.avsc`/`.avro` are Avro;
 * `.proto` is protobuf, where the message is chosen by `eventName` when the
 * file holds more than one. Any other format is reported, never guessed.
 */
export async function readContractFile(
  file: string,
  eventName?: string,
): Promise<ContractFileResult> {
  const ext = path.extname(file).toLowerCase();
  let text: string;

  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { ok: false, reason: `${file} does not exist` };
  }

  try {
    if (ext === '.proto') {
      const parsed = parseProto(text, { keepCase: true, alternateCommentMode: true });

      const messages = eventsFromProtoRoot(
        parsed.root,
        parsed.package ?? undefined,
        path.basename(file),
      );

      const wanted = eventName ? pascalCase(eventName) : undefined;

      const match =
        messages.length === 1
          ? messages[0]
          : messages.find((m) => m.event.name === eventName || m.event.folderName === wanted);

      if (!match) {
        return {
          ok: false,
          reason: `${file} defines ${messages.length} messages and none is named ${eventName ?? 'after the event'}`,
        };
      }

      return { ok: true, schema: match.event.schema, format: 'protobuf' };
    }

    const raw: unknown =
      ext === '.yaml' || ext === '.yml'
        ? parseYaml(text)
        : ['.json', '.avsc', '.avro'].includes(ext)
          ? JSON.parse(text)
          : undefined;

    if (raw === undefined) {
      return { ok: false, reason: `${file}: ${ext || 'this'} schema format is not supported` };
    }

    const value = jsonValueSchema.parse(raw);

    if (looksLikeAvroSchema(value)) {
      return {
        ok: true,
        schema: eventFromAvroSchema(value, path.basename(file)).event.schema,
        format: 'avro',
      };
    }

    if (ext === '.avsc' || ext === '.avro') {
      return { ok: false, reason: `${file} is not an Avro record schema` };
    }

    if (!isJsonObject(value)) return { ok: false, reason: `${file} is not a JSON Schema object` };

    return { ok: true, schema: value, format: 'json-schema' };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);

    const kind =
      ext === '.proto' ? 'protobuf' : ext === '.yaml' || ext === '.yml' ? 'YAML' : 'JSON';

    return { ok: false, reason: `${file} is not valid ${kind} (${detail})` };
  }
}
