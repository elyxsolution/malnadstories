import type { Brand, Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * An ISO-8601 timestamp value object. Time is an INPUT to the domain — nothing here reads the
 * ambient clock (`Date.now`), so every operation is deterministic given its inputs. Construct
 * from a caller-supplied `Date` or ISO string; the stored form is normalized ISO-8601 UTC.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

export function makeTimestamp(value: string | Date): Result<Timestamp, ValidationError> {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return err(new ValidationError('Invalid timestamp', { context: { value: String(value) } }));
  }
  return ok(date.toISOString() as Timestamp);
}

/** Compare two timestamps chronologically (negative if `a` precedes `b`). Pure. */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  return Date.parse(a) - Date.parse(b);
}
