/**
 * A tiny event bus that lets existing screens tell the tour something happened
 * ("the entry form opened") or ask a screen to change ("expand the add
 * buttons"), without either side importing the other.
 */

export const SIGNALS = {
  entryModalOpened: "entryModalOpened",
  entryModalClosed: "entryModalClosed",
  txSaved: "txSaved",
  subSaved: "subSaved",
  holdingSaved: "holdingSaved",
  inviteCreated: "inviteCreated",
  expandFab: "expandFab",
} as const;

export type TourSignal = (typeof SIGNALS)[keyof typeof SIGNALS];

const EVENT_PREFIX = "pairpocket:tour:";

/** Fires a signal. Safe to call when no tour is running. */
export function signal(name: TourSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_PREFIX + name));
}

/** Listens for a signal. Returns the function that stops listening. */
export function onSignal(name: TourSignal, fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const type = EVENT_PREFIX + name;
  const handler = () => fn();
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}
