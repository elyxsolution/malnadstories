import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { DependencyGraphError } from '../errors.js';
import type { Service } from './service.js';

/**
 * Validate the service dependency graph and return a DETERMINISTIC start order (dependencies
 * before dependents). Uses Kahn's algorithm with name-sorted tie-breaking, so the same set of
 * services always yields the same order — a prerequisite for deterministic startup. Fails with
 * `DependencyGraphError` on a missing dependency or a cycle.
 */
export function orderServices(
  services: readonly Service[],
): Result<Service[], DependencyGraphError> {
  const byName = new Map<string, Service>();
  for (const s of services) byName.set(s.name, s);

  // All named dependencies must resolve to a registered service.
  for (const s of services) {
    for (const dep of s.dependencies ?? []) {
      if (!byName.has(dep)) {
        return err(
          new DependencyGraphError(`Service "${s.name}" depends on unknown service "${dep}"`, {
            context: { service: s.name, missing: dep },
          }),
        );
      }
    }
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of services) inDegree.set(s.name, 0);
  for (const s of services) {
    for (const dep of s.dependencies ?? []) {
      inDegree.set(s.name, (inDegree.get(s.name) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(s.name);
      dependents.set(dep, list);
    }
  }

  const ready: string[] = services
    .filter((s) => (inDegree.get(s.name) ?? 0) === 0)
    .map((s) => s.name)
    .sort();

  const order: Service[] = [];
  while (ready.length > 0) {
    const name = ready.shift();
    if (name === undefined) break;
    const svc = byName.get(name);
    if (svc === undefined) continue;
    order.push(svc);

    for (const dependent of [...(dependents.get(name) ?? [])].sort()) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== services.length) {
    return err(
      new DependencyGraphError('Service dependency graph has a cycle', {
        context: { ordered: order.map((s) => s.name) },
      }),
    );
  }
  return ok(order);
}
