/**
 * App update notes, newest first. Titles and descriptions live in the message
 * files under whatsNew.items.<id>.{title,description}.
 */
export interface WhatsNewEntry {
  id: string;
  version: string;
  date: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  { id: "receiptTax", version: "0.7.0", date: "2026-11-01" },
  { id: "notifications", version: "0.6.0", date: "2026-10-31" },
  { id: "languageSettings", version: "0.5.0", date: "2026-10-31" },
  { id: "crossSettlement", version: "0.4.0", date: "2026-10-31" },
  { id: "merchantFirstList", version: "0.3.0", date: "2026-10-31" },
  { id: "newDashboard", version: "0.2.0", date: "2026-10-31" },
];

const SEEN_KEY = "pairpocket.whatsNewSeen";

export function hasUnseenWhatsNew(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== WHATS_NEW[0].id;
  } catch {
    return false;
  }
}

export function markWhatsNewSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, WHATS_NEW[0].id);
  } catch {
    /* storage unavailable; the dot just stays */
  }
}
