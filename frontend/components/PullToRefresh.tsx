"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";

const PULL_THRESHOLD = 72;
const MAX_PULL = 112;

interface Props {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  /** Disable while a modal or other overlay owns touch gestures. */
  disabled?: boolean;
}

/**
 * Mobile pull-down refresh for document scroll. Shows a compact indicator
 * under the sticky header; desktop mouse drag is ignored.
 */
export default function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: Props) {
  const t = useTranslations("common");
  const startY = useRef(0);
  const pulling = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const canStartPull = useCallback(() => {
    if (disabled || refreshingRef.current) return false;
    if (typeof window === "undefined") return false;
    return window.scrollY <= 0;
  }, [disabled]);

  const finishRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullDistance(PULL_THRESHOLD);
    try {
      await onRefresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh]);

  function onTouchStart(e: TouchEvent) {
    if (!canStartPull()) {
      pulling.current = false;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? 0;
    pulling.current = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!pulling.current || refreshingRef.current) return;
    if (window.scrollY > 0) {
      pulling.current = false;
      setPullDistance(0);
      return;
    }
    const y = e.touches[0]?.clientY ?? 0;
    const delta = y - startY.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    // Resist further pull past the threshold (rubber-band feel).
    const distance = Math.min(MAX_PULL, delta * 0.55);
    setPullDistance(distance);
  }

  function onTouchEnd() {
    if (!pulling.current) return;
    pulling.current = false;
    if (refreshingRef.current) return;
    if (pullDistance >= PULL_THRESHOLD) {
      void finishRefresh();
    } else {
      setPullDistance(0);
    }
  }

  // Keep indicator in sync if refresh is triggered while still touching.
  useEffect(() => {
    if (disabled && !refreshingRef.current) {
      pulling.current = false;
      setPullDistance(0);
    }
  }, [disabled]);

  const armed = pullDistance >= PULL_THRESHOLD;
  const visible = pullDistance > 4 || refreshing;
  const heightClass = !visible
    ? "h-0"
    : refreshing || armed
      ? "h-[4.5rem]"
      : pullDistance >= 48
        ? "h-14"
        : pullDistance >= 24
          ? "h-10"
          : "h-6";

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className={`pointer-events-none flex items-end justify-center overflow-hidden transition-[height] duration-150 ease-out ${heightClass}`}
        aria-hidden={!visible}
      >
        <div
          className={`mb-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            refreshing || armed
              ? "bg-blue-500 text-white"
              : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          }`}
          role="status"
          aria-live="polite"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                armed ? "rotate-180" : "rotate-0"
              }`}
            />
          )}
          <span className="whitespace-nowrap">
            {refreshing
              ? t("pullRefreshing")
              : armed
                ? t("pullRelease")
                : t("pullToRefresh")}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
