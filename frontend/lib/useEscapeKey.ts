"use client";

import { useEffect, useEffectEvent } from "react";

/** Open dialogs, oldest first. Only the last one reacts to Escape. */
const openDialogs: symbol[] = [];

/**
 * Calls `onEscape` when Escape is pressed while this dialog is the topmost
 * open one, so a modal opened from another modal closes on its own. Presses
 * a popover inside the dialog already handled (a dropdown closing) are ignored.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handleEscape = useEffectEvent(onEscape);

  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("dialog");
    openDialogs.push(id);
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (openDialogs[openDialogs.length - 1] !== id) return;
      e.preventDefault();
      handleEscape();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openDialogs.splice(openDialogs.indexOf(id), 1);
    };
  }, [enabled]);
}
