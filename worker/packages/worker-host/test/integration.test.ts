import { describe, it, expect } from 'vitest';
import { WorkerHost } from '@workerv2/worker-host';
import { validatePdf } from '@workerv2/pdf-export';
import { parseDocument } from '@workerv2/document';
import { ASSEMBLE_NODE_ID, RENDER_NODE_PREFIX } from '@workerv2/manifest';
import { seedAlbumBlueprint, latin1 } from './helpers.js';

describe('end-to-end album generation', () => {
  it('runs Blueprint → Manifest → Coordinator → composition → Document → PDF Artifact', async () => {
    const host = new WorkerHost();
    const blueprint = seedAlbumBlueprint(host, 2); // cover + 2 spreads
    const result = await host.run(blueprint);

    expect(result.succeeded).toBe(true);
    expect(result.pdfKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.documentKey).toMatch(/^sha256:/);

    // The produced PDF is a valid PDF referencing every page.
    const pdf = result.pdfBytes!;
    expect(validatePdf(pdf).ok).toBe(true);
    expect(latin1(pdf).startsWith('%PDF-')).toBe(true);
    expect(latin1(pdf)).toContain('/Count 3'); // cover + 2 spreads

    // The Document artifact decodes and has the right page count.
    const docBytes = await host.store.read(result.documentKey!);
    const doc = parseDocument(new TextDecoder().decode(docBytes));
    expect(doc.ok).toBe(true);
    if (doc.ok) expect(doc.value.pages).toHaveLength(3);
  });

  it('surfaces observational diagnostics (order, artifacts, retries, failures)', async () => {
    const host = new WorkerHost();
    const result = await host.run(seedAlbumBlueprint(host, 1));
    const d = result.diagnostics;

    expect(d.status).toBe('succeeded');
    expect(d.settled).toBe(true);
    expect(d.totalNodes).toBe(3); // render:cover + render:spread:0000 + assemble:album
    expect(d.completedNodes).toBe(3);
    expect(d.totalRetries).toBe(0);
    expect(d.failures).toEqual([]);
    // Assemble runs after the render nodes (it depends on them).
    expect(d.executionOrder[d.executionOrder.length - 1]).toBe(ASSEMBLE_NODE_ID);
    expect(d.executionOrder.some((id) => id.startsWith(RENDER_NODE_PREFIX))).toBe(true);
    expect(Object.keys(d.producedArtifacts)).toContain(`${ASSEMBLE_NODE_ID}.album`);
  });
});

describe('deterministic output + artifact identity stability', () => {
  it('the same input always produces the same artifact identities', async () => {
    const runOnce = async (): Promise<{ pdf?: string; doc?: string }> => {
      const host = new WorkerHost();
      const result = await host.run(seedAlbumBlueprint(host, 2));
      return { pdf: result.pdfKey, doc: result.documentKey };
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.pdf).toBe(b.pdf);
    expect(a.doc).toBe(b.doc);
    expect(a.pdf).toBeDefined();
  });

  it('different albums produce different PDF identities', async () => {
    const h1 = new WorkerHost();
    const r1 = await h1.run(seedAlbumBlueprint(h1, 1));
    const h2 = new WorkerHost();
    const r2 = await h2.run(seedAlbumBlueprint(h2, 3));
    expect(r1.pdfKey).not.toBe(r2.pdfKey);
  });
});
