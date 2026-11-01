"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

const CURRENT_VERSION = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
// After this long away the app is reloaded on return; sooner, only a banner.
const AUTO_RELOAD_AFTER_MS = 10 * 60 * 1000;
const RELOADED_FOR_KEY = "pp-reloaded-for-version";

/** True while the user may be mid-input: a focused field or an open overlay. */
function isBusy(): boolean {
  const el = document.activeElement;
  if (
    el instanceof HTMLElement &&
    (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  ) {
    return true;
  }
  return document.querySelector(".fixed.inset-0") !== null;
}

function alreadyReloadedFor(version: string): boolean {
  try {
    return window.sessionStorage.getItem(RELOADED_FOR_KEY) === version;
  } catch {
    return false;
  }
}

function rememberReloadFor(version: string) {
  try {
    window.sessionStorage.setItem(RELOADED_FOR_KEY, version);
  } catch {
    // Without storage the guard is skipped; a stale page may reload once more.
  }
}

/**
 * Detects a newer deploy when the app is opened or regains focus (never on a
 * timer). It reloads on its own only after a long absence with nothing being
 * typed; otherwise it shows a banner and leaves the page alone.
 */
export default function AppUpdateWatcher() {
  const t = useTranslations("common");
  const [available, setAvailable] = useState(false);
  const leftAt = useRef<number | null>(null);

  const check = useCallback(async (awayMs: number) => {
    if (CURRENT_VERSION === "dev") return;
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: unknown };
      const latest = data.version;
      if (typeof latest !== "string" || latest === CURRENT_VERSION) return;
      if (
        awayMs >= AUTO_RELOAD_AFTER_MS &&
        !isBusy() &&
        !alreadyReloadedFor(latest)
      ) {
        rememberReloadFor(latest);
        window.location.reload();
        return;
      }
      setAvailable(true);
    } catch {
      // Offline or the check failed: try again next time the app is opened.
    }
  }, []);

  useEffect(() => {
    void check(Infinity);

    const markLeft = () => {
      if (leftAt.current === null) leftAt.current = Date.now();
    };
    const markReturned = () => {
      const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
      leftAt.current = null;
      void check(away);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") markLeft();
      else markReturned();
    };

    window.addEventListener("blur", markLeft);
    window.addEventListener("focus", markReturned);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", markLeft);
      window.removeEventListener("focus", markReturned);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  if (!available) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[60] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl py-2 pl-4 pr-2">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
          {t("updateAvailable")}
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 px-3 py-1.5 text-sm font-semibold text-white transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("updateRefresh")}
        </button>
      </div>
    </div>
  );
}
