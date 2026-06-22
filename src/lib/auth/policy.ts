import { z } from 'zod';

/**
 * Single source of truth for password + display-name (identity) policy.
 *
 * Phase 10C. Deliberately PURE and dependency-light (zod only) — NO `server-only`
 * import — so it can be reused identically on the client (signup / reset-password
 * forms) AND on the server (validations, profile action, auth callback). Keeping
 * the rules in one place removes the previous drift (signup min-8/no-max vs an
 * inline `< 8` check in reset-password, and an unvalidated name on the callback
 * upsert).
 */

// ── Password ────────────────────────────────────────────────────────────────
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 25;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer`);

/** Imperative check for non-zod call sites (e.g. the reset-password client form). */
export function validatePassword(value: string): { ok: true } | { ok: false; error: string } {
  const parsed = passwordSchema.safeParse(value);
  return parsed.success ? { ok: true } : { ok: false, error: parsed.error.issues[0].message };
}

// ── Display name (identity) ───────────────────────────────────────────────────
export const NAME_MIN = 2;
export const NAME_MAX = 60;

/**
 * Trim + collapse internal whitespace to single spaces and strip control characters
 * (C0 range 0–31 plus DEL 127). Pure + idempotent; used both to clean input before
 * validation and to normalise the value persisted server-side (so a crafted client
 * can't store odd whitespace/control chars via the callback upsert). Filtering by code
 * point avoids embedding raw control bytes in this source file.
 */
export function normalizeName(value: string): string {
  let stripped = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue; // drop control chars
    stripped += ch;
  }
  return stripped.replace(/\s+/g, ' ').trim(); // collapse whitespace + trim
}

// Letters (any script) + combining marks, plus spaces and the few punctuation marks
// real names use (apostrophe, hyphen, period). Control chars are already stripped by
// normalizeName; this rejects digits/symbols/emoji. Built via `new RegExp` so the `u`
// flag (needed for \p escapes) doesn't trip TS's literal-flag target check.
const NAME_ALLOWED = new RegExp("^[\\p{L}\\p{M} '.-]+$", 'u');

export const nameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? normalizeName(v) : v),
  z
    .string()
    .min(NAME_MIN, `Name must be at least ${NAME_MIN} characters`)
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer`)
    .regex(NAME_ALLOWED, 'Name contains invalid characters'),
);

/** Imperative name check + normalised value for non-zod server call sites (auth callback). */
export function validateName(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = nameSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return { ok: true, value: parsed.data };
}
