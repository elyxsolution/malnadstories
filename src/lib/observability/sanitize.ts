// Sanitization for everything that gets PERSISTED to error_events (Phase 10B / Phase 9 security).
// Pure + dependency-free so the app, the client report route, and the worker mirror can all share
// the same contract. THE rule: secrets, tokens, and PII must never reach a row.
//
//   - Deny-list KEYS in metadata (password/secret/token/key/authorization/cookie/signature/...).
//   - Value SCRUBBERS in any free text (message/stack/metadata strings): JWT-like, long hex
//     tokens, card-like and email/phone PII.
//   - Hard length/depth caps so a captured blob can never poison/balloon the table or console.

const MAX_MESSAGE = 2_000;
const MAX_STACK = 8_000;
const MAX_STACK_FRAMES = 30;
const MAX_METADATA_JSON = 8_000;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;
const MAX_STRING = 1_000;

// Keys whose VALUES are always dropped, regardless of content.
const DENY_KEY = /pass|secret|token|key|authorization|auth|cookie|signature|hmac|jwt|otp|cvv|card|credential|bearer|session/i;
const REDACTED = '[redacted]';
// Control chars + newlines -> collapsed to a single space (single-line, poison-resistant logs).
const CONTROL = /\s+/g;

/** Scrub secret-shaped + PII-shaped substrings out of any free text. */
export function scrubText(input: string): string {
  return input
    // JWT-like (three base64url segments)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED)
    // long hex / base64-ish tokens (api keys, signatures, R2 keys)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED)
    // explicit key=value / "key": "value" secret leaks
    .replace(/("?(?:password|secret|token|api[_-]?key|authorization|signature)"?\s*[:=]\s*)("?)[^"\s,&]+\2/gi, `$1${REDACTED}`)
    // card-like (13-16 digit groups, optional spaces/dashes)
    .replace(/\b(?:\d[ -]?){13,16}\b/g, '[card]')
    // emails -> masked (keep domain for debugging, drop local part)
    .replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '[email]@$1')
    // phone-ish (10+ digits, optional +cc) -> masked
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[phone]');
}

export function sanitizeMessage(input: unknown): string {
  const s = typeof input === 'string' ? input : String(input ?? '');
  return scrubText(s).replace(CONTROL, ' ').slice(0, MAX_MESSAGE);
}

export function sanitizeStack(input: unknown): string | null {
  if (!input) return null;
  const s = typeof input === 'string' ? input : String(input);
  const trimmed = scrubText(s)
    .split('\n')
    .slice(0, MAX_STACK_FRAMES)
    .join('\n')
    .slice(0, MAX_STACK);
  return trimmed || null;
}

/** Deep-sanitize arbitrary metadata: drop deny-list keys, scrub strings, cap depth/size. */
export function sanitizeMetadata(input: unknown): Record<string, unknown> | null {
  if (input == null || typeof input !== 'object') return null;
  const out = walk(input, 0) as Record<string, unknown>;
  // Final hard cap on serialized size (defense against pathological nesting that slipped through).
  try {
    const json = JSON.stringify(out);
    if (json.length > MAX_METADATA_JSON) return { _truncated: true, preview: json.slice(0, MAX_METADATA_JSON) };
  } catch {
    return { _unserializable: true };
  }
  return out;
}

function walk(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return scrubText(value).slice(0, MAX_STRING);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => walk(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= MAX_KEYS) {
        out._truncated = true;
        break;
      }
      out[k] = DENY_KEY.test(k) ? REDACTED : walk(v, depth + 1);
    }
    return out;
  }
  return '[unserializable]';
}
