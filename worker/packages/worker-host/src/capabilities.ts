import type { CapabilityOffer } from '@workerv2/runtime';
import { RENDER_CAPABILITY, ASSEMBLE_CAPABILITY } from '@workerv2/manifest';
import { REFERENCE_BACKEND_VERSION } from '@workerv2/image-backend';

/**
 * The capabilities the HOST OFFERS — reconciled against each manifest node's declared requirements
 * by the capability negotiator BEFORE dispatch. The manifest's `surface.render` nodes require
 * `render.surface` and `album.assemble` requires `render.assemble`; the host offers both (versioned
 * to the reference implementation). Backend/capability selection lives HERE, in the host — never in
 * processor logic — so a node whose host lacks a capability simply never runs.
 */
export function hostCapabilityOffers(): readonly CapabilityOffer[] {
  return [
    { name: RENDER_CAPABILITY, version: REFERENCE_BACKEND_VERSION },
    { name: ASSEMBLE_CAPABILITY, version: REFERENCE_BACKEND_VERSION },
  ];
}
