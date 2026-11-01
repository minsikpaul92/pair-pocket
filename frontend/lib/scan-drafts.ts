/**
 * Scan files kept in IndexedDB so a failed or interrupted AI scan can be
 * retried after a refresh. localStorage cannot hold photos (about 5 MB, text only).
 *
 * Files stay "pending" until analysed. Finished ones are kept for a few days
 * so they can be scanned again, then removed.
 */

const DB_NAME = "pairpocket-scan";
const STORE = "drafts";
export const DONE_KEEP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScanDraft {
  id: string;
  file: File;
  status: "pending" | "done";
  /** Last time the status changed. */
  updatedAt: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode or storage blocked: scanning still works without drafts
    }
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? req.result : undefined);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

export async function saveDrafts(items: { id: string; file: File }[]): Promise<void> {
  const now = Date.now();
  await run("readwrite", (store) => {
    items.forEach(({ id, file }) =>
      store.put({ id, file, status: "pending", updatedAt: now } satisfies ScanDraft)
    );
  });
}

export async function listDrafts(): Promise<ScanDraft[]> {
  const rows = (await run("readonly", (s) => s.getAll())) as ScanDraft[] | undefined;
  return (rows ?? []).sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function markDone(ids: string[]): Promise<void> {
  const now = Date.now();
  await run("readwrite", (store) => {
    ids.forEach((id) => {
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result) store.put({ ...get.result, status: "done", updatedAt: now });
      };
    });
  });
}

export async function markPending(ids: string[]): Promise<void> {
  const now = Date.now();
  await run("readwrite", (store) => {
    ids.forEach((id) => {
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result) store.put({ ...get.result, status: "pending", updatedAt: now });
      };
    });
  });
}

export async function deleteDrafts(ids: string[]): Promise<void> {
  await run("readwrite", (store) => {
    ids.forEach((id) => store.delete(id));
  });
}

/** Remove finished files older than the retention window. */
export async function purgeOldDone(): Promise<void> {
  const cutoff = Date.now() - DONE_KEEP_DAYS * DAY_MS;
  const old = (await listDrafts()).filter((d) => d.status === "done" && d.updatedAt < cutoff);
  if (old.length) await deleteDrafts(old.map((d) => d.id));
}
