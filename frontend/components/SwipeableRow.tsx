"use client";

import { useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Distance that reveals the delete action (button width). */
const REVEAL = 72;
/** Must swipe at least this far to auto-delete on release. */
const FULL_DELETE = 128;

/**
 * Swipe left (touch or mouse drag) to reveal a red delete action.
 * Only a full swipe past FULL_DELETE triggers onDelete; a partial swipe
 * snaps open/closed without deleting (tap the red button to delete).
 */
export default function SwipeableRow({
  children,
  onDelete,
  deleteLabel = "삭제",
  disabled = false,
  className = "",
}: Props) {
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const pointerId = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const openRef = useRef(false);
  const [offset, setOffset] = useState(0);

  function applyOffset(next: number) {
    offsetRef.current = next;
    setOffset(next);
  }

  function applyOpen(next: boolean) {
    openRef.current = next;
  }

  function beginDrag(clientX: number, clientY: number) {
    if (disabled) return;
    startX.current = clientX;
    startY.current = clientY;
    dragging.current = true;
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!dragging.current || disabled) return;
    const dx = clientX - startX.current;
    const dy = clientY - startY.current;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      dragging.current = false;
      applyOffset(openRef.current ? -REVEAL : 0);
      return;
    }
    const base = openRef.current ? -REVEAL : 0;
    const next = Math.min(0, Math.max(-FULL_DELETE, dx + base));
    applyOffset(next);
  }

  function endDrag() {
    if (!dragging.current || disabled) return;
    dragging.current = false;
    pointerId.current = null;
    const current = offsetRef.current;

    // Full swipe only — mid-swipe / reveal must not delete.
    if (current <= -FULL_DELETE + 4) {
      applyOffset(0);
      applyOpen(false);
      onDelete();
      return;
    }
    if (current <= -REVEAL / 2) {
      applyOffset(-REVEAL);
      applyOpen(true);
    } else {
      applyOffset(0);
      applyOpen(false);
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
  }

  function onTouchMove(e: React.TouchEvent) {
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || e.button !== 0) return;
    pointerId.current = e.pointerId;
    beginDrag(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    moveDrag(e.clientX, e.clientY);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    endDrag();
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="pointer-events-none absolute inset-y-1 right-1 flex w-[68px] items-stretch"
        aria-hidden
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            applyOffset(0);
            applyOpen(false);
            onDelete();
          }}
          className="pointer-events-auto flex w-full items-center justify-center rounded-lg bg-red-500 text-sm font-semibold text-white"
        >
          {deleteLabel}
        </button>
      </div>
      <div
        className="relative z-10 bg-white dark:bg-gray-800 transition-transform duration-150 ease-out touch-pan-y select-none"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
