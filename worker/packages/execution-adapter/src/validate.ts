import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { ProcessorResolver, StepCapabilityRequirement } from '@workerv2/processing';
import type {
  CapabilityNegotiator,
  CapabilityOffer,
  CapabilityRequirement,
} from '@workerv2/runtime';
import type { Coordinator } from '@workerv2/coordinator';
import { AdapterError } from './errors.js';

/**
 * EXECUTION VALIDATION — the adapter's PRE-FLIGHT gate. Before driving a run it proves the host
 * can actually execute every node: each node's processor RESOLVES through the resolver, and each
 * node's required capabilities NEGOTIATE against the host's offers. Running this first turns a
 * missing processor or unmet capability into an up-front, actionable error instead of a
 * per-node permanent failure discovered mid-run. Pure — it inspects contracts, executes nothing.
 */
export function validateExecutable(
  coordinator: Coordinator,
  resolver: ProcessorResolver,
  negotiator: CapabilityNegotiator,
  offers: readonly CapabilityOffer[],
): Result<void, AdapterError> {
  const processors = coordinator.validateProcessors(resolver);
  if (!processors.ok) {
    return err(
      new AdapterError(`Processor resolution failed: ${processors.error.message}`, {
        cause: processors.error,
      }),
    );
  }

  const unmet: string[] = [];
  for (const id of coordinator.graph.order) {
    const step = coordinator.graph.nodes[id];
    if (step === undefined) continue;
    const required: readonly CapabilityRequirement[] =
      step.requires as readonly StepCapabilityRequirement[];
    const negotiation = negotiator.negotiate(required, offers);
    if (!negotiation.satisfied) {
      unmet.push(`${id} → ${negotiation.unmet.map((u) => u.name).join(', ')}`);
    }
  }
  if (unmet.length > 0) {
    return err(new AdapterError(`Unmet capabilities: ${unmet.join('; ')}`, { context: { unmet } }));
  }
  return ok(undefined);
}
