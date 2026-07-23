import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ProductError } from './errors.js';
import type { ProductDefinition, ProductSelection, ResolvedSelection } from './model.js';

/**
 * PRODUCT CONSTRAINTS — pure evaluation of the declarative constraint model against a
 * selection. Constraints are data on the product definition; this module only interprets
 * them. Deterministic: same product + same selection → same result, always.
 */

function bad<T>(
  message: string,
  context?: Record<string, string | number>,
): Result<T, ProductError> {
  return err(new ProductError(message, context === undefined ? {} : { context }));
}

/**
 * Resolve a selection against a product: validate the page count, validate every provided
 * option against the axis vocabulary, apply defaults for omitted axes, then evaluate every
 * option-coupling constraint. The result is the COMPLETE selection (every axis present).
 */
export function resolveSelection(
  product: ProductDefinition,
  selection: ProductSelection,
): Result<ResolvedSelection, ProductError> {
  if (!product.pageCounts.includes(selection.pageCount)) {
    return bad(`Product "${product.id}" is not offered with ${String(selection.pageCount)} pages`, {
      pageCount: selection.pageCount,
      offered: product.pageCounts.join(','),
    });
  }

  const provided = selection.options ?? {};
  const axes = new Set(product.options.map((o) => o.axis));
  for (const axis of Object.keys(provided)) {
    if (!axes.has(axis)) {
      return bad(`Product "${product.id}" has no option axis "${axis}"`);
    }
  }

  const options: Record<string, string> = {};
  for (const axis of product.options) {
    const value = provided[axis.axis] ?? axis.defaultValue;
    if (!axis.values.includes(value)) {
      return bad(`Option axis "${axis.axis}" does not allow value "${value}"`, {
        axis: axis.axis,
        value,
        allowed: axis.values.join(','),
      });
    }
    options[axis.axis] = value;
  }

  for (const constraint of product.constraints) {
    if (constraint.kind === 'requires-option') {
      if (
        options[constraint.ifAxis] === constraint.ifValue &&
        options[constraint.thenAxis] !== constraint.thenValue
      ) {
        return bad(
          `Constraint violated: "${constraint.ifAxis}=${constraint.ifValue}" requires "${constraint.thenAxis}=${constraint.thenValue}"`,
        );
      }
    } else if (constraint.kind === 'excludes-option') {
      if (
        options[constraint.ifAxis] === constraint.ifValue &&
        options[constraint.thenAxis] === constraint.thenValue
      ) {
        return bad(
          `Constraint violated: "${constraint.ifAxis}=${constraint.ifValue}" excludes "${constraint.thenAxis}=${constraint.thenValue}"`,
        );
      }
    }
    // Content limits (max-placements/texts-per-spread) apply to a resolved source, not a selection.
  }

  return ok({ pageCount: selection.pageCount, options });
}

/** The per-spread content limits a product declares (undefined = unlimited). */
export interface SpreadLimits {
  readonly maxPlacementsPerSpread?: number;
  readonly maxTextsPerSpread?: number;
}

/** Extract the content-limit constraints (the resolver applies them to every spread). */
export function spreadLimits(product: ProductDefinition): SpreadLimits {
  let maxPlacements: number | undefined;
  let maxTexts: number | undefined;
  for (const constraint of product.constraints) {
    if (constraint.kind === 'max-placements-per-spread') {
      maxPlacements = Math.min(maxPlacements ?? Number.POSITIVE_INFINITY, constraint.limit);
    } else if (constraint.kind === 'max-texts-per-spread') {
      maxTexts = Math.min(maxTexts ?? Number.POSITIVE_INFINITY, constraint.limit);
    }
  }
  const out: { maxPlacementsPerSpread?: number; maxTextsPerSpread?: number } = {};
  if (maxPlacements !== undefined) out.maxPlacementsPerSpread = maxPlacements;
  if (maxTexts !== undefined) out.maxTextsPerSpread = maxTexts;
  return out;
}
