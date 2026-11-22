/** JSON values a schema tree or example can hold, without pulling autocatalog-core into the browser. */
export type JsonValue =
  string | number | boolean | null | Array<JsonValue> | { [key: string]: JsonValue };
