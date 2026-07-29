"use client";

import { useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  disabled?: boolean;
  className?: string;
}

const THRESHOLD = 72;
const MAX_SLIDE = 88;

/**
 * Swipe left (touch or mouse drag) to reveal a red delete action.
 * Full swipe past threshold triggers onDelete (caller shows confirm).
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
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

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
      setOffset(open ? -THRESHOLD : 0);
      return;
    }
    const next = Math.min(0, Math.max(-MAX_SLIDE, dx + (open ? -THRESHOLD : 0)));
    setOffset(next);
  }

  function endDrag() {
    if (!dragging.current || disabled) return;
    dragging.current = false;
    pointerId.current = null;
    if (offset <= -MAX_SLIDE + 8) {
      setOffset(0);
      setOpen(false);
      onDelete();
      return;
    }
    if (offset <= -THRESHOLD / 2) {
      setOffset(-THRESHOLD);
      setOpen(true);
    } else {
      setOffset(0);
      setOpen(false);
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
        className="absolute inset-y-0 right-0 flex items-stretch"
        aria-hidden
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOffset(0);
            setOpen(false);
            onDelete();
          }}
          className="flex w-[88px] items-center justify-center bg-red-500 text-sm font-semibold text-white"
        >
          {deleteLabel}
        </button>
      </div>
      <div
        className="relative bg-white dark:bg-gray-800 transition-transform duration-150 ease-out touch-pan-y select-none"
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
