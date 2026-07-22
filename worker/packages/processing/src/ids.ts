import type { Brand, Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * Branded identifiers for the processing model. Like the domain's ids, these are INPUTS —
 * the framework never generates them (id generation is an engine/infrastructure concern).
 * Constructors validate shape only; pure and deterministic.
 */
export type StepId = Brand<string, 'StepId'>;
export type PipelineId = Brand<string, 'PipelineId'>;

const MAX_ID_LENGTH = 200;
/** Ids must be readable, stable tokens — no whitespace/control chars that break key usage. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function idFactory<B extends string>(label: string) {
  return (raw: string): Result<Brand<string, B>, ValidationError> => {
    if (raw.length === 0 || raw.length > MAX_ID_LENGTH || !ID_RE.test(raw)) {
      return err(
        new ValidationError(
          `${label} must be 1-${MAX_ID_LENGTH} chars of [A-Za-z0-9._:-], starting alphanumeric`,
          { context: { label, value: raw } },
        ),
      );
    }
    return ok(raw as Brand<string, B>);
  };
}

export const makeStepId = idFactory<'StepId'>('StepId');
export const makePipelineId = idFactory<'PipelineId'>('PipelineId');

/**
 * Artifact SLOT names (a step's named input/output ports) are plain strings local to one step,
 * validated with the same token rules as ids (they are used as record keys, where a brand would
 * be erased anyway).
 */
export function isValidSlotName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_ID_LENGTH && ID_RE.test(name);
}
