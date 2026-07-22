/**
 * CANONICAL JSON — a deterministic serialization for content addressing and structural
 * equality: object keys sorted lexicographically, `undefined`-valued keys omitted, arrays kept
 * in order (array order is semantic), no whitespace. Two structurally-equal values always
 * produce byte-identical output, regardless of key insertion order.
 *
 * Only JSON-safe values are meaningful inputs (the boundary shape for anything persisted);
 * functions/symbols/undefined inside arrays serialize as JSON.stringify would (null), matching
 * standard JSON semantics.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
