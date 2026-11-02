/**
 * Bank imports the user set aside to finish later. Kept in this browser only,
 * so a half-reviewed statement survives a refresh without a server round trip.
 */
const KEY = "pairpocket.bankImportDrafts";
const MAX_DRAFTS = 10;

export interface ImportDraft<T> {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  savedAt: string;
  rows: T[];
}

export function listImportDrafts<T>(): ImportDraft<T>[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ImportDraft<T>[]) : [];
  } catch {
    return [];
  }
}

function write<T>(drafts: ImportDraft<T>[]): ImportDraft<T>[] {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, MAX_DRAFTS)));
  } catch {
    /* storage blocked or full; the draft only lives until the page closes */
  }
  return drafts.slice(0, MAX_DRAFTS);
}

export function saveImportDraft<T>(draft: Omit<ImportDraft<T>, "id" | "savedAt">): ImportDraft<T>[] {
  const entry: ImportDraft<T> = {
    ...draft,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
  };
  return write([entry, ...listImportDrafts<T>()]);
}

export function removeImportDraft<T>(id: string): ImportDraft<T>[] {
  return write(listImportDrafts<T>().filter((d) => d.id !== id));
}
