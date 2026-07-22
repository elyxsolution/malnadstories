import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * The components whose versions a run pins at inception (INV-11 / Version Matrix). Not all
 * exist in early phases; a `VersionSet` may pin any subset — `require()` asserts the ones a
 * given run needs.
 */
export type VersionComponent =
  | 'workerRuntime'
  | 'manifest'
  | 'imageEngine'
  | 'pdfEngine'
  | 'blueprint'
  | 'template'
  | 'theme'
  | 'fontPack'
  | 'stickerPack'
  | 'processingProfile'
  | 'product'
  | 'vendorProfile';

export const VERSION_COMPONENTS: readonly VersionComponent[] = [
  'workerRuntime',
  'manifest',
  'imageEngine',
  'pdfEngine',
  'blueprint',
  'template',
  'theme',
  'fontPack',
  'stickerPack',
  'processingProfile',
  'product',
  'vendorProfile',
];

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * An immutable, validated set of component→version pins. Once created it never changes — a run
 * holds one for its whole life, giving reproducibility (INV-11). Values must be semver-shaped.
 */
export class VersionSet {
  private constructor(private readonly pins: ReadonlyMap<VersionComponent, string>) {}

  /** Validate and build a `VersionSet` from a partial component→version map. */
  static create(
    entries: Partial<Record<VersionComponent, string>>,
  ): Result<VersionSet, ValidationError> {
    const map = new Map<VersionComponent, string>();
    for (const component of VERSION_COMPONENTS) {
      const value = entries[component];
      if (value === undefined) continue;
      if (!SEMVER_RE.test(value)) {
        return err(
          new ValidationError(`Version for "${component}" is not semver-shaped: "${value}"`, {
            context: { component, value },
          }),
        );
      }
      map.set(component, value);
    }
    return ok(new VersionSet(map));
  }

  /** The pinned version for a component, or `undefined` if not pinned. */
  get(component: VersionComponent): string | undefined {
    return this.pins.get(component);
  }

  has(component: VersionComponent): boolean {
    return this.pins.has(component);
  }

  /** The components pinned in this set (in canonical order). */
  components(): VersionComponent[] {
    return VERSION_COMPONENTS.filter((c) => this.pins.has(c));
  }

  /** Assert that every listed component is pinned (a run's required-version gate). */
  require(components: readonly VersionComponent[]): Result<void, ValidationError> {
    const missing = components.filter((c) => !this.pins.has(c));
    if (missing.length > 0) {
      return err(
        new ValidationError(`Missing required version pins: ${missing.join(', ')}`, {
          context: { missing },
        }),
      );
    }
    return ok(undefined);
  }

  /** Plain, order-stable object view (JSON-safe). */
  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of this.components()) {
      const v = this.pins.get(c);
      if (v !== undefined) out[c] = v;
    }
    return out;
  }

  /** Structural equality: same components pinned to the same versions. */
  equals(other: VersionSet): boolean {
    if (this.pins.size !== other.pins.size) return false;
    for (const [c, v] of this.pins) {
      if (other.pins.get(c) !== v) return false;
    }
    return true;
  }
}
