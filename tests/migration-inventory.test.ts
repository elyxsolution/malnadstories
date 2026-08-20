/**
 * MIGRATION INVENTORY / DOCUMENTATION CONSISTENCY.
 *
 * Migrations here are hand-written and hand-run: there is no migrations table and no CLI that
 * would notice a gap. Phase 9 Prompt 1 found CLAUDE.md documenting 39 of 56 files — 17 migrations
 * existed on disk and were completely undocumented, and one (0052) had shipped as code but was
 * never executed, which broke an admin page. The run-order list is the only map a developer has,
 * so its drift is a real operational risk.
 *
 * This is a STATIC check: it reads the filesystem and the document. It executes no SQL and
 * connects to no database — the applied/unapplied state was verified against `pg_catalog` in
 * Prompt 3 and cannot be re-derived from disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const FILES = readdirSync(resolve(ROOT, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();
const DOC = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8');

const numberOf = (f: string) => {
  const m = /^(\d{4})_/.exec(f);
  if (!m) throw new Error(`migration filename does not start with a 4-digit id: ${f}`);
  return Number(m[1]);
};

describe('migration files on disk', () => {
  it('every file uses the NNNN_name.sql convention', () => {
    for (const f of FILES) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('numeric ids are unique — two migrations must never share a number', () => {
    const ids = FILES.map(numberOf);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filenames are unique', () => {
    expect(new Set(FILES).size).toBe(FILES.length);
  });

  it('the sequence is contiguous from 0001 with no missing file', () => {
    const ids = FILES.map(numberOf).sort((a, b) => a - b);
    expect(ids[0]).toBe(1);
    for (let i = 0; i < ids.length; i++) expect(ids[i]).toBe(i + 1);
  });
});

describe('CLAUDE.md run order matches disk', () => {
  it('every migration on disk is documented', () => {
    const undocumented = FILES.filter((f) => !DOC.includes(f));
    expect(undocumented).toEqual([]);
  });

  it('documents no migration that does not exist', () => {
    const mentioned = Array.from(DOC.matchAll(/`?(\d{4}_[a-z0-9_]+\.sql)`?/g)).map((m) => m[1]);
    const phantom = Array.from(new Set(mentioned)).filter((f) => !FILES.includes(f));
    expect(phantom).toEqual([]);
  });

  it('lists the migrations in ascending order in the run-order table', () => {
    const table = DOC.slice(DOC.indexOf('SQL migrations — the complete'));
    const listed = Array.from(table.matchAll(/^\| (\d{4}) \| `(\d{4}_[a-z0-9_]+\.sql)`/gm)).map((m) => ({
      id: Number(m[1]), file: m[2],
    }));
    expect(listed.length).toBe(FILES.length);
    for (let i = 0; i < listed.length; i++) {
      expect(listed[i].id).toBe(i + 1);
      expect(listed[i].file).toBe(FILES[i]);
      // The row's stated number must match the filename it points at.
      expect(numberOf(listed[i].file)).toBe(listed[i].id);
    }
  });

  it('states the file count it claims to document, and that count is right', () => {
    expect(DOC).toContain(`${FILES.length} migration files`);
  });
});

describe('the specific migrations Phase 9 turned on', () => {
  // 0052 was documented as shipped but had never been run. 0057 hardened TRUNCATE privileges.
  // Both are recorded as executed; if either file were ever removed the checks above would fail,
  // and if the claim were removed from the doc these would.
  it('0052, 0055, 0056 and 0057 exist and are marked executed', () => {
    for (const f of [
      '0052_cover_template_default.sql',
      '0055_cart_items.sql',
      '0056_order_items.sql',
      '0057_revoke_truncate_privilege.sql',
    ]) {
      expect(FILES).toContain(f);
      expect(DOC).toContain(f);
    }
    expect(DOC).toMatch(/Nothing is unapplied/i);
  });

  it('0057 actually contains the TRUNCATE revoke it claims, for both client roles', () => {
    const sql = readFileSync(resolve(ROOT, 'drizzle/0057_revoke_truncate_privilege.sql'), 'utf8');
    expect(sql).toMatch(/revoke\s+truncate\s+on\s+table/i);
    expect(sql).toMatch(/from\s+anon,\s*authenticated/i);
    // The default-privilege change is what stops new tables re-inheriting TRUNCATE.
    expect(sql).toMatch(/alter\s+default\s+privileges[\s\S]*revoke\s+truncate\s+on\s+tables\s+from\s+anon,\s*authenticated/i);
    // It must not touch anything else.
    expect(sql).not.toMatch(/\bdrop\s+(table|policy|column)\b/i);
    expect(sql).not.toMatch(/^\s*create\s+policy/im);
  });
});
