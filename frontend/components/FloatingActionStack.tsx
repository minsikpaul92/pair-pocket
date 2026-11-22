"use client";

import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type FabCorner = "tl" | "tr" | "bl" | "br";

interface Props {
  onCamera: () => void;
  onAdd: () => void;
  cameraLabel: string;
  addLabel: string;
  cameraBusy?: boolean;
  CameraIcon: LucideIcon;
  AddIcon: LucideIcon;
  cameraBusyIcon?: ReactNode;
  onCornerChange?: (corner: FabCorner) => void;
}

const LONG_PRESS_MS = 350;
const CANCEL_MOVE_PX = 10;
const EDGE_MARGIN = 16;
const FLICK_MS = 120;

function isPhone() {
  return typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches;
}

/**
 * Camera and add buttons in one row, as small regular Liquid Glass controls.
 * On phones the pair can be picked up with a long press and dropped in any
 * screen corner. Taps and keyboard use are unchanged.
 */
export default function FloatingActionStack({
  onCamera,
  onAdd,
  cameraLabel,
  addLabel,
  cameraBusy = false,
  CameraIcon,
  AddIcon,
  cameraBusyIcon,
  onCornerChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<FabCorner>("br");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(offset);
  const drag = useRef({
    pending: false,
    active: false,
    id: 0,
    startX: 0,
    startY: 0,
    startOffset: { x: 0, y: 0 },
    samples: [] as { t: number; x: number; y: number }[],
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    suppressClick: false,
  });

  const applyOffset = useCallback((next: { x: number; y: number }) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  /** Offsets (from the CSS default, bottom right) that put the group in each corner. */
  const cornerOffsets = useCallback((): Record<FabCorner, { x: number; y: number }> | null => {
    const el = ref.current;
    if (!el) return null;
    const left = EDGE_MARGIN - el.offsetLeft;
    const top =
      (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0) +
      EDGE_MARGIN -
      el.offsetTop;
    return {
      br: { x: 0, y: 0 },
      bl: { x: left, y: 0 },
      tr: { x: 0, y: top },
      tl: { x: left, y: top },
    };
  }, []);

  useEffect(() => {
    onCornerChange?.(corner);
  }, [corner, onCornerChange]);

  // Keep the corner correct after resize or rotation.
  useEffect(() => {
    function onResize() {
      const target = cornerOffsets()?.[corner];
      if (target) applyOffset(target);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [corner, cornerOffsets, applyOffset]);

  // While dragging the page must not scroll. A non-passive listener that exists
  // before the touch starts is the only thing iOS Safari respects.
  useEffect(() => {
    function block(e: TouchEvent) {
      if (drag.current.active) e.preventDefault();
    }
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isPhone() || e.button > 0) return;
    const d = drag.current;
    d.pending = true;
    d.id = e.pointerId;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.startOffset = offsetRef.current;
    d.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    const el = e.currentTarget;
    clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      if (!d.pending) return;
      d.pending = false;
      d.active = true;
      d.suppressClick = true;
      try {
        el.setPointerCapture(d.id);
      } catch {
        // pointer already gone
      }
      setDragging(true);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d.pending) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > CANCEL_MOVE_PX) {
        d.pending = false;
        clearTimeout(d.timer);
      }
      return;
    }
    if (!d.active) return;
    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    d.samples = d.samples.filter((s) => e.timeStamp - s.t <= 100);
    applyOffset({
      x: d.startOffset.x + e.clientX - d.startX,
      y: d.startOffset.y + e.clientY - d.startY,
    });
  }

  function endPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    clearTimeout(d.timer);
    d.pending = false;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    // Swallow the click that follows a drag.
    setTimeout(() => {
      d.suppressClick = false;
    }, 60);

    const targets = cornerOffsets();
    const el = ref.current;
    if (!targets || !el) return;
    const first = d.samples[0];
    const dt = Math.max(1, e.timeStamp - (first?.t ?? e.timeStamp));
    const vx = first ? (e.clientX - first.x) / dt : 0;
    const vy = first ? (e.clientY - first.y) / dt : 0;
    const cur = offsetRef.current;
    const px = cur.x + vx * FLICK_MS;
    const py = cur.y + vy * FLICK_MS;
    let best: FabCorner = "br";
    let bestDist = Infinity;
    (Object.keys(targets) as FabCorner[]).forEach((c) => {
      const dist = Math.hypot(targets[c].x - px, targets[c].y - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    });
    setCorner(best);
    applyOffset(targets[best]);
  }

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moved = offset.x !== 0 || offset.y !== 0 || dragging;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClickCapture={(e) => {
        if (drag.current.suppressClick) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onContextMenu={(e) => {
        if (drag.current.active || drag.current.pending) e.preventDefault();
      }}
      style={
        moved
          ? {
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${dragging ? 1.08 : 1})`,
              transition:
                dragging || reduceMotion
                  ? "none"
                  : "transform 380ms cubic-bezier(0.34, 1.4, 0.64, 1)",
              filter: dragging ? "drop-shadow(0 10px 14px rgba(0,0,0,0.25))" : undefined,
            }
          : undefined
      }
      className="fixed bottom-[calc(4.35rem+max(0.5rem,env(safe-area-inset-bottom)))] md:bottom-8 right-4 md:right-5 z-40 flex select-none items-center gap-2 md:gap-3 [-webkit-touch-callout:none]"
    >
      <button
        type="button"
        onClick={onCamera}
        disabled={cameraBusy}
        aria-label={cameraLabel}
        className="glass-fab"
      >
        {cameraBusy && cameraBusyIcon ? (
          cameraBusyIcon
        ) : (
          <CameraIcon className="h-6 w-6" />
        )}
      </button>
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        data-tour="fab-add"
        className="glass-fab glass-fab-primary"
      >
        <AddIcon className="h-6 w-6" />
      </button>
    </div>
  );
}
