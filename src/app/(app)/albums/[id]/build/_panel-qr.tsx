'use client';

import { useState } from 'react';
import { QrCode, Plus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * QR Codes tab — type a URL (or any text), preview the code live, and drop it onto the
 * current spread. The QR is generated client-side as an inline SVG (no upload, no network),
 * so it round-trips through layout_config and renders in the PDF without a load wait.
 */
export default function QrPanel({ hasTarget, onAdd }: { hasTarget: boolean; onAdd: (data: string) => void }) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const valid = trimmed.length > 0;

  return (
    <div className="ms-scroll flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">QR code</p>

      <div className="space-y-2">
        <label htmlFor="qr-url" className="text-[12px] font-medium text-foreground">
          Link or text
        </label>
        <input
          id="qr-url"
          type="text"
          inputMode="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://your-trip-blog.com"
          maxLength={1024}
          className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all duration-150 placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
      </div>

      <div className="grid place-items-center rounded-2xl border border-border bg-secondary/40 p-6">
        {valid ? (
          <div className="h-32 w-32 rounded-xl bg-white p-2 shadow-soft ring-1 ring-border">
            <QRCodeSVG value={trimmed} size={256} level="M" marginSize={0} fgColor="#1e3a2f" style={{ width: '100%', height: '100%' }} />
          </div>
        ) : (
          <div className="flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground/60">
            <QrCode className="h-7 w-7" />
            <span className="text-[11px]">Live preview</span>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!valid || !hasTarget}
        onClick={() => {
          onAdd(trimmed);
          setValue('');
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-studio px-3 py-2.5 text-[13px] font-semibold text-studio-foreground shadow-[0_1px_2px_rgb(16_24_20/0.12),0_6px_16px_-8px_hsl(150_46%_26%/0.5)] transition-all duration-150 ease-glide hover:bg-[hsl(150_48%_29%)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="h-4 w-4" /> Add to page
      </button>
      {!hasTarget && (
        <p className="text-center text-[11px] text-muted-foreground">Add a spread first to place a QR code.</p>
      )}
    </div>
  );
}
