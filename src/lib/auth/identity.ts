import { validateName } from '@/lib/auth/policy';

/**
 * WHO THE ACCOUNT MENU IS FOR — the minimum the UI needs, and not one field more.
 *
 * The account surface is INFORMATIONAL. It shows a name and an email so a person can confirm
 * which account they are signed into, and that is the whole contract: no id, no role, no
 * metadata, no session, no token. Keeping the shape this narrow is what stops "just pass the
 * user object down" from quietly shipping session internals into client code.
 *
 * PURE — no `server-only`, no I/O. The values are resolved by whichever Server Component already
 * has the authenticated user in hand (the public header's shell, the app layout, the admin
 * layout), so this adds no query, no round trip and no second auth path.
 */
export type AccountIdentity = {
  /** A display name — never empty; see the fallback chain below. */
  name: string;
  /** The signed-in address. Shown once, in the account block. */
  email: string;
};

/**
 * THE FALLBACK CHAIN, stated once so every surface agrees.
 *
 *   1. the supplied display name, normalised and validated;
 *   2. the email's local part, through the SAME rule;
 *   3. "Your account" — a label, never a blank line.
 *
 * `validateName` is the existing identity policy (`lib/auth/policy`) — the same function
 * `/auth/callback` runs before it writes `profiles.name`. Reusing it means the menu shows exactly
 * what the database was allowed to store, rather than a second opinion about what a name is: a
 * value that failed validation on the way in is not silently rendered on the way out.
 *
 * Step 2 matters more than it looks. A Google sign-in carries a name in `user_metadata`, an email
 * signup may not, and an account created before that metadata existed has none at all — so the
 * local part is the honest identity we already have, and is what `customer-shell` has always
 * derived its avatar initial from.
 */
export function accountIdentity(email: string | null | undefined, rawName?: string | null): AccountIdentity {
  const address = (email ?? '').trim();

  const named = validateName(rawName ?? '');
  if (named.ok) return { name: named.value, email: address };

  const local = validateName(address.split('@')[0] ?? '');
  if (local.ok) return { name: local.value, email: address };

  return { name: 'Your account', email: address };
}

/**
 * The single letter shown in the avatar disc — the treatment `customer-shell` already uses for
 * its account chip, extracted so the header and the rail cannot disagree about it.
 */
export function accountInitial(identity: AccountIdentity): string {
  return (identity.name || identity.email || 'U').trim().charAt(0).toUpperCase();
}
