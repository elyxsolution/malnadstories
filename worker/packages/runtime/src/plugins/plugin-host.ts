import { RegistrationError } from '../errors.js';
import type { Plugin, PluginContext } from './plugin.js';

/**
 * Applies plugins in the given order, each exactly once. Rejects duplicate plugin names so the
 * extension set is unambiguous. Deterministic: plugins register in the order provided.
 */
export function applyPlugins(plugins: readonly Plugin[], context: PluginContext): string[] {
  const applied = new Set<string>();
  for (const plugin of plugins) {
    if (applied.has(plugin.name)) {
      throw new RegistrationError(`Duplicate plugin: "${plugin.name}"`, {
        context: { name: plugin.name },
      });
    }
    plugin.register(context);
    applied.add(plugin.name);
  }
  return [...applied];
}
