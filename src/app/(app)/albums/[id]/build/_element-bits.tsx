'use client';

import { useEffect, useRef } from 'react';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { textFontSize } from '@/lib/builder/elements';
import type { TextElement } from '@/lib/builder/model';

/**
 * Shared on-canvas element bits — the floating control bar, its buttons, and the
 * double-click inline text editor. Extracted from `_block` so BOTH the page canvas
 * (`_block`) and the cover canvas (`_cover-canvas`) drive identical interactions —
 * the "one continuous editor" requirement, with no duplicated UI.
 */

/** A single button in the floating element control bar. */
export function CtlBtn({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-secondary'
      }`}
    >
      {children}
    </button>
  );
}

/** The floating control bar shared by overlays / text / stickers / QR (layer + delete + extras). */
export function ElementControls({
  onForward,
  onBackward,
  onDelete,
  extra,
}: {
  onForward?: () => void;
  onBackward?: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <>
      {extra}
      {(onForward || onBackward) && <span className="mx-0.5 h-4 w-px self-center bg-border" />}
      {onBackward && (
        <CtlBtn label="Send backward" onClick={onBackward}>
          <ChevronDown />
        </CtlBtn>
      )}
      {onForward && (
        <CtlBtn label="Bring forward" onClick={onForward}>
          <ChevronUp />
        </CtlBtn>
      )}
      <span className="mx-0.5 h-4 w-px self-center bg-border" />
      <CtlBtn label="Delete" onClick={onDelete} destructive>
        <Trash2 />
      </CtlBtn>
    </>
  );
}

/** Double-click inline text editor — contenteditable styled to match the rendered text. */
export function InlineTextEditor({
  initial,
  el,
  onCommit,
}: {
  initial: string;
  el: TextElement;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = initial;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selObj = window.getSelection();
    selObj?.removeAllRanges();
    selObj?.addRange(range);
  }, [initial]);

  const items = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
  return (
    <div
      className="absolute inset-0 flex flex-col justify-center"
      style={{ alignItems: items }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Edit text"
        onBlur={(e) => onCommit(e.currentTarget.textContent ?? '')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          }
          e.stopPropagation();
        }}
        className="w-full bg-studio-bright/[0.06] outline-none ring-1 ring-studio-bright/60"
        style={{
          fontFamily: 'inherit',
          /*
           * THE SAME function the rendered text uses — not a copy of its formula.
           *
           * This used to hardcode `cqw`, while `textFontSize` resolves a SPINE object against
           * `cqh`. The spine face declares `container-type: size` and is a sliver a few percent
           * of a page wide but a whole page tall, so a spine title rendered at `20cqh` became
           * `20cqw` the instant the editor opened — a fraction of its real size — and snapped
           * back only when the editor unmounted on commit. That is the "text goes tiny while I
           * type, then normalises" report: not a measurement race, a divergent duplicate.
           *
           * Calling the shared function means the editor cannot disagree with the renderer for
           * this or any future role, which is the property that stops it regressing.
           */
          fontSize: textFontSize(el),
          fontWeight: el.weight,
          fontStyle: el.italic ? 'italic' : 'normal',
          textAlign: el.align,
          color: el.color,
          letterSpacing: `${el.letterSpacing}em`,
          lineHeight: el.lineHeight,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
    </div>
  );
}
