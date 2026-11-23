"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { stepTargets, type TourStep } from "@/lib/tour/steps";

import TourCard, { type TourCardLayout } from "./TourCard";

/** Space between the control and the edge of the hole. */
const PAD = 6;
/** How long to wait for a target before offering to skip the step. */
const WAIT_MS = 3000;
const MARGIN = 12;
const GAP = 12;
/** Below this width the card docks as a sheet (Tailwind `sm`). */
const SHEET_BELOW = 640;
/** A sheet rises above a target whose top is below this share of the screen. */
const LIFT_ABOVE = 0.45;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  step: TourStep;
  stepIndex: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onExit: () => void;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** First visible match of each id; the sidebar and bottom nav both exist. */
function findTargets(ids: string[]): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const id of ids) {
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`);
    const el = Array.from(all).find(isVisible);
    if (el) found.push(el);
  }
  return found;
}

function unionBox(els: HTMLElement[]): Box {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return { top, left, width: right - left, height: bottom - top };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

function sameList(a: HTMLElement[], b: HTMLElement[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Floating card position: below, above, right or left of the hole, like InfoTip. */
function placeFloating(
  hole: Box | null,
  width: number,
  height: number
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), vw - width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), vh - height - MARGIN);
  if (!hole) return { left: clampX((vw - width) / 2), top: clampY((vh - height) / 2) };

  const centerX = clampX(hole.left + hole.width / 2 - width / 2);
  const centerY = clampY(hole.top + hole.height / 2 - height / 2);
  const below = hole.top + hole.height + GAP;
  if (below + height <= vh - MARGIN) return { left: centerX, top: below };
  const above = hole.top - GAP - height;
  if (above >= MARGIN) return { left: centerX, top: above };
  const right = hole.left + hole.width + GAP;
  if (right + width <= vw - MARGIN) return { left: right, top: centerY };
  const left = hole.left - GAP - width;
  if (left >= MARGIN) return { left, top: centerY };
  // Nothing fits beside a very large target: keep the card in a corner.
  return { left: vw - width - MARGIN, top: vh - height - MARGIN };
}

/**
 * Dark scrim with a hole around the step's target. The scrim is four panels
 * around the hole, so a press inside the hole reaches the real control and a
 * press anywhere else is blocked. If the target never shows up, the card is
 * shown on its own with a way to skip the step.
 */
export default function TourOverlay({
  step,
  stepIndex,
  total,
  onNext,
  onBack,
  onSkip,
  onExit,
}: Props) {
  const t = useTranslations("tutorial");
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < SHEET_BELOW
  );
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const targetKey = stepTargets(step).join("|");

  // Find the target, wait for it, and follow it as the page moves.
  useEffect(() => {
    const ids = targetKey.split("|");
    let frame = 0;
    let timer: number | undefined;
    let observed: HTMLElement[] = [];
    let scrolled = false;

    const resizeObserver = new ResizeObserver(() => schedule());

    function measure() {
      frame = 0;
      setNarrow(window.innerWidth < SHEET_BELOW);
      const els = findTargets(ids);
      if (!sameList(els, observed)) {
        resizeObserver.disconnect();
        els.forEach((el) => resizeObserver.observe(el));
        observed = els;
      }
      if (els.length === 0) {
        setBox(null);
        if (timer === undefined) {
          timer = window.setTimeout(() => setMissing(true), WAIT_MS);
        }
        return;
      }
      window.clearTimeout(timer);
      timer = undefined;
      setMissing(false);
      if (!scrolled) {
        scrolled = true;
        const r = els[0].getBoundingClientRect();
        if (r.top < MARGIN || r.bottom > window.innerHeight - MARGIN) {
          els[0].scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
        }
      }
      const next = unionBox(els);
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }

    const mutationObserver = new MutationObserver((records) => {
      const root = rootRef.current;
      // Changes inside the overlay itself never move the target.
      if (root && records.every((r) => root.contains(r.target))) return;
      schedule();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tour", "class", "style", "hidden"],
    });
    const viewport = window.visualViewport;
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    measure();

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [targetKey]);

  // Escape ends the tour. Capture phase, so an open modal underneath does not
  // also close on the same press.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onExit();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExit]);

  const hole: Box | null = box
    ? (() => {
        const vw = typeof window === "undefined" ? 0 : window.innerWidth;
        const vh = typeof window === "undefined" ? 0 : window.innerHeight;
        const top = Math.max(0, box.top - PAD);
        const left = Math.max(0, box.left - PAD);
        const right = Math.min(vw, box.left + box.width + PAD);
        const bottom = Math.min(vh, box.top + box.height + PAD);
        return {
          top,
          left,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      })()
    : null;

  // On a phone the card is a sheet docked to the bottom. When the target sits
  // low on the screen (bottom nav, add button) the sheet rises to just above
  // it, so it never covers the control the user has to press.
  const lifted =
    narrow && hole !== null && hole.top > window.innerHeight * LIFT_ABOVE;
  const layout: TourCardLayout = !narrow
    ? "float"
    : lifted
      ? "sheet-lifted"
      : "sheet-bottom";

  useLayoutEffect(() => {
    if (layout !== "float") return;
    const card = cardRef.current;
    if (!card) return;
    const next = placeFloating(hole, card.offsetWidth, card.offsetHeight);
    setCardPos((prev) =>
      prev && prev.top === next.top && prev.left === next.left ? prev : next
    );
    // `hole` is derived from `box`; `missing` changes the card's height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, box, missing, narrow]);

  // Move focus to the card for each step so screen readers read it.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  if (typeof document === "undefined") return null;

  const scrim = "pointer-events-auto fixed bg-black/60 motion-safe:transition-[top,left,width,height] motion-safe:duration-200";
  const cardStyle: CSSProperties | undefined =
    layout === "float"
      ? {
          top: cardPos?.top ?? 0,
          left: cardPos?.left ?? 0,
          // Opacity, not visibility, so the card can take focus right away.
          opacity: cardPos ? 1 : 0,
          pointerEvents: cardPos ? undefined : "none",
        }
      : layout === "sheet-lifted" && hole
        ? { bottom: window.innerHeight - hole.top + GAP }
        : undefined;

  return createPortal(
    <div ref={rootRef} data-tour-overlay="" className="pointer-events-none fixed inset-0 z-[140]">
      {hole ? (
        <>
          <div aria-hidden className={scrim} style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div
            aria-hidden
            className={scrim}
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            aria-hidden
            className={scrim}
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
          />
          <div
            aria-hidden
            className={scrim}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
          />
          <div
            aria-hidden
            className="pointer-events-none fixed rounded-xl ring-2 ring-white/90 shadow-[0_0_0_4px_rgba(59,130,246,0.55)] motion-safe:transition-[top,left,width,height] motion-safe:duration-200"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      ) : (
        <div aria-hidden className={scrim} style={{ inset: 0 }} />
      )}
      <TourCard
        ref={cardRef}
        title={t(`steps.${step.id}.title`)}
        body={t(`steps.${step.id}.body`)}
        stepIndex={stepIndex}
        total={total}
        missing={missing}
        showNext={step.advanceOn === "next"}
        layout={layout}
        style={cardStyle}
        onNext={onNext}
        onBack={onBack}
        onSkip={onSkip}
        onExit={onExit}
      />
    </div>,
    document.body
  );
}
