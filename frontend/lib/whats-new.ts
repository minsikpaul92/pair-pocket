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
  { id: "countrySettings", version: "0.23.0", date: "2026-11-04" },
  { id: "easierReading", version: "0.22.0", date: "2026-11-04" },
  { id: "dashboardEnglishText", version: "0.21.1", date: "2026-11-04" },
  { id: "geminiKeyCards", version: "0.21.0", date: "2026-11-03" },
  { id: "geminiKeyGuide", version: "0.20.0", date: "2026-11-03" },
  { id: "notificationOpensEntry", version: "0.19.1", date: "2026-11-02" },
  { id: "settlementMoveTab", version: "0.19.0", date: "2026-11-02" },
  { id: "notificationHistory", version: "0.18.0", date: "2026-11-02" },
  { id: "budgetCarryChoice", version: "0.17.0", date: "2026-11-02" },
  { id: "cardRefundBalance", version: "0.16.1", date: "2026-11-02" },
  { id: "settingsTabs", version: "0.16.0", date: "2026-11-02" },
  { id: "budgetExcludesSavings", version: "0.15.1", date: "2026-11-02" },
  { id: "subscriptionFromEntry", version: "0.15.0", date: "2026-11-02" },
  { id: "importPolish", version: "0.14.0", date: "2026-11-01" },
  { id: "bankStatementImport", version: "0.13.0", date: "2026-11-01" },
  { id: "scanDrafts", version: "0.12.0", date: "2026-11-01" },
  { id: "provinceTax", version: "0.10.0", date: "2026-11-01" },
  { id: "pasteImage", version: "0.9.0", date: "2026-11-01" },
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
