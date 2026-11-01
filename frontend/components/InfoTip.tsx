"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  /** Accessible name of the "?" button. */
  label: string;
  children: React.ReactNode;
  className?: string;
};

const MARGIN = 12;
const GAP = 8;
const WIDTH = 288;

/**
 * Small "?" button that explains a card or field.
 * Opens on hover (mouse), tap or click (touch), and keyboard focus; closes on
 * outside press, Escape, or when the pointer and focus both leave. The bubble
 * is portaled and clamped to the viewport so it is never clipped on a phone.
 */
export default function InfoTip({ label, children, className }: Props) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const open = pinned || hovered || focused;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
      const left = Math.min(
        Math.max(MARGIN, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - MARGIN
      );
      const height = bubbleRef.current?.offsetHeight ?? 0;
      const below = rect.bottom + GAP;
      const fitsBelow = below + height <= window.innerHeight - MARGIN;
      const top = fitsBelow
        ? below
        : Math.max(MARGIN, rect.top - GAP - height);
      setPos({ left, top, width });
    }
    place();
    // Measure again once the bubble has its real height.
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    function onPress(e: PointerEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || bubbleRef.current?.contains(target)) return;
      setPinned(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPinned(false);
    }
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-indigo-500 focus-visible:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-gray-500"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
            style={{
              position: "fixed",
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              width: pos?.width ?? WIDTH,
              visibility: pos ? "visible" : "hidden",
              maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
            }}
            className="z-[100] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}
