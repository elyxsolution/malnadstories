'use client';

import { useState } from 'react';
import {
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Layers,
  ChevronRight,
  CornerRightUp,
  CornerRightDown,
} from 'lucide-react';
import { BarPopover } from './_canvas-bar';

/**
 * THE LAYERS MENU — professional layer ordering for every movable object.
 *
 * One menu, rendered by every contextual toolbar (photo overlays, text, stickers, QR). It never
 * mutates anything itself: each item dispatches `onMove` with a declarative action, and the host
 * wires that to `commands.moveLayer` — the command layer's single, batched, undoable
 * implementation. The menu is pure presentation over the element's position in its stack.
 *
 * "Move above… / Move below…" list the element's SIBLINGS by name so the user can target an
 * exact position in a deep stack without spamming Bring Forward. They only appear when the
 * stack has a third element — with two, front/back already say everything.
 */

export type LayerAction = 'front' | 'forward' | 'backward' | 'back' | { above: string } | { below: string };

export type LayerSibling = { id: string; label: string };

export default function LayerMenu({
  index,
  total,
  siblings,
  onMove,
}: {
  /** The element's position in its stack (0 = back, total−1 = front). */
  index: number;
  total: number;
  /** Every element in the stack, back-to-front, INCLUDING the selected one. */
  siblings: LayerSibling[];
  onMove: (action: LayerAction) => void;
}) {
  const atFront = index >= total - 1;
  const atBack = index <= 0;
  const selfId = siblings[index]?.id;

  return (
    <BarPopover label="Layer order" icon={<Layers />} text="Layers" width={224}>
      {(close) => (
        <LayerMenuBody
          atFront={atFront}
          atBack={atBack}
          total={total}
          selfId={selfId}
          siblings={siblings}
          onMove={(a) => {
            onMove(a);
            close();
          }}
        />
      )}
    </BarPopover>
  );
}

function LayerMenuBody({
  atFront,
  atBack,
  total,
  selfId,
  siblings,
  onMove,
}: {
  atFront: boolean;
  atBack: boolean;
  total: number;
  selfId: string | undefined;
  siblings: LayerSibling[];
  onMove: (action: LayerAction) => void;
}) {
  /** Which "pick a sibling" list is expanded, if any. */
  const [pick, setPick] = useState<'above' | 'below' | null>(null);
  const others = siblings.filter((s) => s.id !== selfId);

  /** Roving ↑/↓ between menu items, matching the platform menu pattern. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const host = e.currentTarget as HTMLElement;
    const items = Array.from(host.querySelectorAll<HTMLElement>('[data-menu-item]:not([disabled])'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0) return;
    e.preventDefault();
    const next = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  };

  return (
    <div role="menu" aria-label="Layer order" onKeyDown={onKeyDown} className="ms-scroll overflow-y-auto p-1">
      <MenuItem icon={<BringToFront />} label="Bring to front" disabled={atFront} onClick={() => onMove('front')} />
      <MenuItem icon={<ArrowUp />} label="Bring forward" disabled={atFront} onClick={() => onMove('forward')} />
      <MenuSep />
      <MenuItem icon={<ArrowDown />} label="Send backward" disabled={atBack} onClick={() => onMove('backward')} />
      <MenuItem icon={<SendToBack />} label="Send to back" disabled={atBack} onClick={() => onMove('back')} />

      {/* Targeted placement — only meaningful in stacks of 3+, where forward/backward gets slow. */}
      {total > 2 && others.length > 0 && (
        <>
          <MenuSep />
          <MenuItem
            icon={<CornerRightUp />}
            label="Move above…"
            expanded={pick === 'above'}
            onClick={() => setPick((p) => (p === 'above' ? null : 'above'))}
          />
          {pick === 'above' && <SiblingList siblings={others} onPick={(id) => onMove({ above: id })} />}
          <MenuItem
            icon={<CornerRightDown />}
            label="Move below…"
            expanded={pick === 'below'}
            onClick={() => setPick((p) => (p === 'below' ? null : 'below'))}
          />
          {pick === 'below' && <SiblingList siblings={others} onPick={(id) => onMove({ below: id })} />}
        </>
      )}
    </div>
  );
}

/** The sibling picker, front-to-back — the order a person sees the stack in. */
function SiblingList({ siblings, onPick }: { siblings: LayerSibling[]; onPick: (id: string) => void }) {
  return (
    <div className="my-0.5 ml-4 border-l border-border/70 pl-1">
      {[...siblings].reverse().map((s) => (
        <button
          key={s.id}
          type="button"
          role="menuitem"
          data-menu-item
          onClick={() => onPick(s.id)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <span className="truncate">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  /** Present only on the two expandable items — renders the chevron + aria-expanded. */
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-muted-foreground"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {expanded !== undefined && (
        <ChevronRight className={`!h-3 !w-3 opacity-50 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
      )}
    </button>
  );
}

function MenuSep() {
  return <div className="mx-2 my-1 h-px bg-border/70" aria-hidden />;
}
