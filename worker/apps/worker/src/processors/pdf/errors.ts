import type { PdfFailureCode } from './pdf-contract.js';

/**
 * PDF ERROR TAXONOMY — three outcomes:
 *   • `SupersededError` — a newer request owns the current token, or the album is already rendered.
 *     The job is a harmless NO-OP → ack, never marked failed.
 *   • `PermanentPdfError` — the input can never render (album gone, token expired, print route non-OK,
 *     empty output). Terminal → `album_pdfs` marked `failed` with the code; admin regenerates.
 *   • `TransientPdfError` — a browser crash, timeout, or storage/DB blip. Also marked `failed` this
 *     phase (there is no broker retry; admin regenerate recovers it), but the code + class are retained
 *     so the Phase I-3 recovery sweep can auto-redrive transient failures with a fresh token.
 */

export class SupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupersededError';
  }
}

export class PermanentPdfError extends Error {
  constructor(
    message: string,
    readonly code: PdfFailureCode,
  ) {
    super(message);
    this.name = 'PermanentPdfError';
  }
}

export class TransientPdfError extends Error {
  constructor(
    message: string,
    readonly code: PdfFailureCode,
  ) {
    super(message);
    this.name = 'TransientPdfError';
  }
}
