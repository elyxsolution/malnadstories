import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import type { ManagedResource } from './resource-manager.js';

/**
 * CHROMIUM as a `ManagedResource` — the ONLY module that launches a browser. The PDF processor never
 * calls `puppeteer.launch`; it acquires a `Browser` from a `ResourceHandle` backed by this. Health is
 * `browser.connected` (a crashed/disconnected Chromium reports unhealthy → the handle rebuilds it),
 * and `destroy` closes it. Launch flags mirror the hardened V1 settings (no-sandbox for containers,
 * disable-dev-shm to avoid /dev/shm exhaustion) plus a protocol timeout that bounds every CDP call.
 */

export interface BrowserLaunchOptions {
  readonly headless?: boolean;
  /** Bounds browser start / websocket connect. */
  readonly launchTimeoutMs?: number;
  /** CDP ceiling for every subsequent page.* call (newPage/evaluate/pdf). */
  readonly protocolTimeoutMs?: number;
  readonly args?: readonly string[];
}

const DEFAULT_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

export function createBrowserResource(
  options: BrowserLaunchOptions = {},
): ManagedResource<Browser> {
  return {
    name: 'chromium',
    create: () =>
      puppeteer.launch({
        headless: options.headless ?? true,
        timeout: options.launchTimeoutMs ?? 45_000,
        protocolTimeout: options.protocolTimeoutMs ?? 90_000,
        args: [...(options.args ?? DEFAULT_ARGS)],
      }),
    isHealthy: (browser) => browser.connected,
    destroy: async (browser) => {
      await browser.close();
    },
  };
}
