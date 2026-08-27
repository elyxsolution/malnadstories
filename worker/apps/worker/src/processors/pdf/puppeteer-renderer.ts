import type { Browser } from 'puppeteer';
import type { ResourceHandle } from '../../resources/resource-manager.js';
import type { PageRenderer, RenderRequest, RenderResult } from './page-renderer.js';
import {
  PrintRouteError,
  RendererCrashedError,
  RenderTargetUnreachableError,
  classifyNetworkError,
  unreachableAdvice,
} from './page-renderer.js';
import { redactToken } from './pdf-contract.js';

/**
 * PUPPETEER PAGE RENDERER — the production `PageRenderer`. It acquires a shared `Browser` from the
 * ResourceManager handle (never launching its own), opens a FRESH page per render (so memory never
 * leaks between jobs), drives the print route, and returns the PDF bytes. It does NOT own Chromium's
 * lifecycle — on a browser-level crash/disconnect it calls `handle.reset()` so the next render rebuilds
 * a clean browser, and reports the failure as transient (`RendererCrashedError`). A non-OK print-route
 * response is a page-level, permanent `PrintRouteError` and never resets the (healthy) browser.
 *
 * Bounds are enforced by Puppeteer's own per-call timeouts (goto/waitForFunction/pdf) plus the launch
 * `protocolTimeout` (which caps newPage/evaluate) — no bespoke watchdog layer needed.
 */
export class PuppeteerPageRenderer implements PageRenderer {
  constructor(private readonly browser: ResourceHandle<Browser>) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const browser = await this.browser.acquire();
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;
    let browserBroke = false;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });

      const response = await page.goto(request.url, {
        waitUntil: 'networkidle0',
        timeout: request.timeouts.navigationMs,
      });
      if (response === null || !response.ok()) {
        throw new PrintRouteError(response?.status() ?? 0);
      }
      const httpStatus = response.status();

      await page.waitForFunction(`window.${request.readinessFlag} === true`, {
        timeout: request.timeouts.readinessMs,
      });
      await settle(page, request.timeouts.settleMs);

      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        timeout: request.timeouts.pdfMs,
      });
      const bytes = new Uint8Array(pdf);
      if (bytes.byteLength === 0) throw new Error('page.pdf produced 0 bytes');
      return { pdf: bytes, httpStatus };
    } catch (error) {
      if (error instanceof PrintRouteError) throw error; // browser is healthy — page-level HTTP problem

      // EVERY message out of this block is redacted: Chromium puts the full navigation URL —
      // token and all — into its network errors, and that string ends up in the log, the
      // processor event and `album_pdfs.error`.
      const raw = error instanceof Error ? error.message : String(error);
      const message = redactToken(raw);

      // THE APPLICATION IS NOT THERE vs THE BROWSER DIED. Same Puppeteer symptom, completely
      // different fix, so they are separated before the generic browser-level check — a connection
      // failure must never be mistaken for a crashed Chromium and answered with a browser rebuild.
      const reason = classifyNetworkError(raw);
      if (reason !== null) {
        throw new RenderTargetUnreachableError(
          reason,
          request.origin,
          `${message} — ${unreachableAdvice(reason, request.origin)}`,
        );
      }

      if (isBrowserLevel(error) || !browser.connected) {
        browserBroke = true;
        throw new RendererCrashedError(message);
      }
      // NOTHING LEAVES THIS BLOCK UNREDACTED. Re-throwing the original error here used to carry
      // Chromium's raw navigation message — token included — past every redaction downstream. Any
      // error that reaches this line is re-wrapped around the redacted text.
      throw error instanceof Error
        ? Object.assign(new Error(message), { name: error.name, cause: undefined })
        : new Error(message);
    } finally {
      if (page !== null) {
        try {
          await page.close();
        } catch {
          browserBroke = true; // a page that won't close means the browser is wedged
        }
      }
      if (browserBroke) await this.browser.reset();
    }
  }
}

/** Deterministic paint: wait for fonts + image decode, capped so a stuck asset can't hang the render. */
async function settle(page: Awaited<ReturnType<Browser['newPage']>>, capMs: number): Promise<void> {
  // The callback runs INSIDE the browser (DOM present); the worker's lib has no DOM types, so the
  // document is referenced through a minimal structural type.
  await page.evaluate(async (cap: number) => {
    interface DomImage {
      readonly complete: boolean;
      readonly naturalWidth: number;
      decode(): Promise<unknown>;
    }
    const doc = (
      globalThis as unknown as {
        document: { fonts?: { ready?: Promise<unknown> }; images: ArrayLike<DomImage> };
      }
    ).document;

    const deadline = new Promise<void>((resolve) => setTimeout(resolve, cap));
    await Promise.race([doc.fonts?.ready ?? Promise.resolve(), deadline]);
    const decodes = Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : img.decode().catch(() => undefined),
      ),
    );
    await Promise.race([decodes, deadline]);
  }, capMs);
}

/** Recognize a browser/CDP-level failure (vs a normal page error) — these mean Chromium must be rebuilt. */
function isBrowserLevel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Protocol error|Target closed|Session closed|Connection closed|browser has disconnected|Navigation timeout|timed out/i.test(
    message,
  );
}
