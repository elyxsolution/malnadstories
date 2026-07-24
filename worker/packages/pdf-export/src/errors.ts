import { WorkerV2Error } from '@workerv2/errors';
import type { JsonObject } from '@workerv2/contracts';

/** A PDF export failure — bad inputs, inconsistent pages, or an invalid generated PDF. */
export class PdfExportError extends WorkerV2Error {
  constructor(message: string, context?: JsonObject) {
    super(message, { code: 'VALIDATION', ...(context === undefined ? {} : { context }) });
    this.name = 'PdfExportError';
  }
}
