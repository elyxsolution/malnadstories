'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { commitTextSize, stepTextSize, MAX_TEXT_SIZE, MIN_TEXT_SIZE } from '@/lib/builder/text-size';

/**
 * THE FONT-SIZE CONTROL — one component, both hosts (the floating text toolbar and the docked
 * inspector), so a size typed in one place behaves exactly as it does in the other.
 *
 * ── WHY THE FIELD IS A DRAFT, NOT A CONTROLLED NUMBER ────────────────────────────────────────
 *
 * The control this replaces was `<input type="number" value={size}>` that clamped on EVERY
 * keystroke. That makes some values literally untypeable: to reach 180 the field must pass
 * through "1", "1" clamped to the old minimum of 10, and the rewritten value landed back under
 * the caret — so the next keystroke appended to "10" instead of "1". Values above the maximum
 * were truncated the same way, and any keystroke that momentarily parsed as NaN (an empty field,
 * a lone "-") was dropped, leaving the field showing the OLD size after an apparently-successful
 * edit.
 *
 * So while the field has focus it owns a plain string, and NOTHING is parsed or clamped until the
 * edit is COMMITTED — Enter, or blur. On commit the value is parsed once, clamped once, pushed to
 * the model, and echoed back into the field, so what is displayed is always exactly what was
 * accepted. Escape abandons the draft. When the field does not have focus it mirrors the model,
 * which is what keeps it in step with the ▲▼ steppers and with a corner drag-resize.
 *
 * `onChange` receives an already-clamped size; the host decides what a size change means for the
 * element (see `textSizePatch`).
 */
export default function FontSizeField({
  value,
  onChange,
  compact = false,
  barItem = false,
}: {
  value: number;
  onChange: (size: number) => void;
  /** Toolbar form — 28px tall, transparent, sized to sit between two `BarBtn`s. */
  compact?: boolean;
  /** Opt into the canvas bar's roving-tabindex sweep (`[data-bar-item]`). */
  barItem?: boolean;
}) {
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);

  // Mirror the model whenever it moves underneath us — a stepper press, a corner drag, an undo,
  // or simply selecting a different text element. Suppressed while typing so a re-render cannot
  // overwrite a half-entered number.
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  /** Parse → clamp → publish → echo. The single exit from draft state. */
  const commit = (raw: string) => {
    const next = commitTextSize(raw, value);
    setDraft(String(next));
    if (next !== Math.round(value)) onChange(next);
  };

  /** A stepper press, or ▲/▼ inside the field. Always steps from the MODEL, never from the draft. */
  const step = (direction: 1 | -1) => {
    const next = stepTextSize(Math.round(value), direction);
    setDraft(String(next));
    if (next !== Math.round(value)) onChange(next);
  };

  const stepperCls = compact
    ? 'grid h-[13px] w-[17px] place-items-center text-muted-foreground transition-colors duration-100 hover:text-foreground active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3'
    : 'grid h-[15px] w-[22px] place-items-center text-muted-foreground transition-colors duration-100 hover:bg-secondary hover:text-foreground active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5';

  return (
    <div
      className={
        compact
          ? 'group inline-flex h-7 items-stretch overflow-hidden rounded-lg transition-colors duration-100 hover:bg-secondary focus-within:bg-secondary'
          : 'inline-flex h-8 items-stretch overflow-hidden rounded-lg border border-input bg-card shadow-xs'
      }
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        {...(barItem ? { 'data-bar-item': '' } : {})}
        value={draft}
        aria-label="Font size"
        title={`Font size (${MIN_TEXT_SIZE}–${MAX_TEXT_SIZE})`}
        role="spinbutton"
        aria-valuenow={Math.round(value)}
        aria-valuemin={MIN_TEXT_SIZE}
        aria-valuemax={MAX_TEXT_SIZE}
        onFocus={(e) => {
          setEditing(true);
          // Click-then-type replaces the value rather than appending to it.
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          // The canvas bar's roving focus owns ←/→ — keep them for the caret inside the field.
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.stopPropagation();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            step(e.key === 'ArrowUp' ? 1 : -1);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(e.currentTarget.value);
            return;
          }
          if (e.key === 'Escape') {
            // Abandon the draft; blur would otherwise commit it on the way out.
            e.stopPropagation();
            setDraft(shown);
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className={
          compact
            ? 'h-full w-11 bg-transparent px-1.5 text-center text-[12px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-studio-bright'
            : 'h-full w-full min-w-0 bg-transparent px-2 text-[12px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-studio-bright/40'
        }
      />
      {/* The steppers write through the SAME `onChange` the field does — no second update path. */}
      <span className={compact ? 'flex flex-col justify-center' : 'flex flex-col justify-center border-l border-input'}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase font size"
          title="Increase font size"
          disabled={Math.round(value) >= MAX_TEXT_SIZE}
          onPointerDown={(e) => e.preventDefault() /* keep focus where it is; never steal it from the canvas */}
          onClick={() => step(1)}
          className={stepperCls}
        >
          <ChevronUp />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease font size"
          title="Decrease font size"
          disabled={Math.round(value) <= MIN_TEXT_SIZE}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => step(-1)}
          className={stepperCls}
        >
          <ChevronDown />
        </button>
      </span>
    </div>
  );
}
