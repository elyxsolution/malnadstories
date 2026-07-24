import { createHash } from 'node:crypto';
import { PdfExportError } from './errors.js';
import type { PdfVersion } from './config.js';

/**
 * The low-level, DETERMINISTIC PDF writer. It emits objects in a fixed order, builds a byte-accurate
 * cross-reference table, and writes a trailer whose `/ID` is derived from a SHA-256 of the document
 * body — never a random value or a timestamp. There is no `CreationDate`/`ModDate` and the object
 * numbering is fully controlled here, so the same objects always serialize to byte-identical PDF
 * bytes. This is the "PDF library" for Worker V2, chosen precisely so determinism is guaranteed
 * rather than fought.
 */

/** Latin-1/ASCII bytes for PDF syntax (operators, dict keys, numbers — all ASCII). */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * A PDF text string encoded as UTF-16BE with a BOM, in hex `<FEFF...>` form. Unambiguous + fully
 * deterministic for any Unicode input — no encoding heuristics, no escaping edge cases.
 */
export function pdfTextString(value: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) {
    hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/** Assemble a stream object body: `<< dictInner /Length N >> stream … endstream`. */
export function streamObject(dictInner: string, data: Uint8Array): Uint8Array {
  return concatBytes([
    ascii(`<< ${dictInner} /Length ${data.length} >>\nstream\n`),
    data,
    ascii('\nendstream'),
  ]);
}

export class PdfBuilder {
  private readonly objects: (Uint8Array | null)[] = [];

  /** Reserve an object number whose body is filled later (for forward references). */
  reserve(): number {
    this.objects.push(null);
    return this.objects.length;
  }

  /** Fill a reserved object's body. */
  set(num: number, body: Uint8Array | string): void {
    this.objects[num - 1] = typeof body === 'string' ? ascii(body) : body;
  }

  /** Append an object and return its number. */
  add(body: Uint8Array | string): number {
    this.objects.push(typeof body === 'string' ? ascii(body) : body);
    return this.objects.length;
  }

  /** Serialize the whole PDF deterministically (header → objects → xref → trailer). */
  serialize(options: { pdfVersion: PdfVersion; root: number; info: number }): Uint8Array {
    const parts: Uint8Array[] = [];
    let offset = 0;
    const push = (bytes: Uint8Array): void => {
      parts.push(bytes);
      offset += bytes.length;
    };

    push(ascii(`%PDF-${options.pdfVersion}\n`));
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // "%âãÏÓ" binary marker

    const xrefOffsets: number[] = [];
    for (let i = 0; i < this.objects.length; i += 1) {
      const body = this.objects[i];
      if (body === null || body === undefined) {
        throw new PdfExportError(`PDF object ${i + 1} was reserved but never set`);
      }
      xrefOffsets.push(offset);
      push(ascii(`${i + 1} 0 obj\n`));
      push(body);
      push(ascii('\nendobj\n'));
    }

    const startxref = offset;
    const size = this.objects.length + 1;
    const xref = [`xref\n0 ${size}\n`, '0000000000 65535 f\r\n'];
    for (const off of xrefOffsets) xref.push(`${String(off).padStart(10, '0')} 00000 n\r\n`);
    push(ascii(xref.join('')));

    // /ID is content-derived (SHA-256 of everything above the trailer) — deterministic, never random.
    const idHex = createHash('sha256').update(concatBytes(parts)).digest('hex').slice(0, 32);
    push(
      ascii(
        `trailer\n<< /Size ${size} /Root ${options.root} 0 R /Info ${options.info} 0 R ` +
          `/ID [<${idHex}><${idHex}>] >>\nstartxref\n${startxref}\n%%EOF\n`,
      ),
    );

    return concatBytes(parts);
  }
}
