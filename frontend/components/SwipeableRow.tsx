"use client";

import { useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Partial swipe snaps open here so the delete label stays tappable. */
const REVEAL = 80;

/**
 * Swipe left (touch or mouse drag) over a full-width red delete layer.
 * Partial swipe reveals the action; only a near-full swipe triggers onDelete.
 */
export default function SwipeableRow({
  children,
  onDelete,
  deleteLabel = "Delete",
  disabled = false,
  className = "",
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const pointerId = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const openRef = useRef(false);
  const [offset, setOffset] = useState(0);

  function measureWidth() {
    widthRef.current = rowRef.current?.offsetWidth ?? 0;
  }

  /** Allow sliding almost the full row so red stays visible to the end. */
  function maxSlide() {
    const w = widthRef.current;
    if (w <= 0) return 280;
    return Math.max(REVEAL, w - 4);
  }

  /** Auto-delete only when released near the full swipe end. */
  function deleteTrigger() {
    return maxSlide() * 0.85;
  }

  function applyOffset(next: number) {
    offsetRef.current = next;
    setOffset(next);
  }

  function applyOpen(next: boolean) {
    openRef.current = next;
  }

  function beginDrag(clientX: number, clientY: number) {
    if (disabled) return;
    measureWidth();
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
    const next = Math.min(0, Math.max(-maxSlide(), dx + base));
    applyOffset(next);
  }

  function endDrag() {
    if (!dragging.current || disabled) return;
    dragging.current = false;
    pointerId.current = null;
    const current = offsetRef.current;
    const trigger = -deleteTrigger();

    // Near-full swipe only — mid-swipe / reveal must not delete.
    if (current <= trigger) {
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

  const revealWidth = Math.max(0, -offset);

  return (
    <div ref={rowRef} className={`relative overflow-hidden ${className}`}>
      {revealWidth > 0 && (
        <div
          className="pointer-events-none absolute top-0.5 bottom-0.5 right-0 flex items-stretch justify-end overflow-hidden bg-red-500"
          style={{ width: revealWidth }}
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
            className="pointer-events-auto flex h-full min-w-[80px] shrink-0 items-center justify-center px-5 text-sm font-semibold text-white"
          >
            {deleteLabel}
          </button>
        </div>
      )}
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
