/** JSON-safe value types — the boundary shape for anything serialized/persisted. */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export type JsonArray = readonly JsonValue[];
