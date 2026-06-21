import 'server-only';
import type { CourierName } from '../model';
import type { CourierProvider } from './types';
import { MockCourierProvider } from './mock';

/**
 * Courier provider registry — the ONE place that maps a courier name to its provider.
 * Today every courier resolves to the MockCourierProvider (no live integration yet). A real
 * Shiprocket / Delhivery / Blue Dart / DTDC client implements CourierProvider and is slotted
 * in here behind its key; nothing else in the app changes.
 */
export function getCourierProvider(courier: CourierName): CourierProvider {
  switch (courier) {
    // TODO (live integration): replace these with real provider instances.
    case 'shiprocket':
    case 'delhivery':
    case 'bluedart':
    case 'dtdc':
    case 'other':
    default:
      return new MockCourierProvider(courier);
  }
}

export type { CourierProvider } from './types';
