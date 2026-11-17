/**
 * The outbox: what was taken or written with no signal, kept on the phone
 * until it can be sent.
 *
 * A yard at the end of a lane, a basement, a new estate with no mast yet:
 * the evaluation or the job happens anyway. A photo taken there is kept
 * here, in the browser's own database, with what has to happen to it once
 * it is sent, and the outbox runner sends it by itself when the phone is
 * back online, even if the page it was taken on has been closed.
 *
 * Browser only.
 */

export type OutboxKind =
  /** A photo of the job, and the row that records it. */
  | "job-photo"
  /** A receipt for something bought for the job. */
  | "receipt"
  /** A subcontractor's after photo, on their link. */
  | "sub-photo"
  /** A photo on the client's pre-evaluation form. */
  | "intake-photo"
  /** The pre-evaluation form itself, sent. */
  | "intake-submit"
  /** A photo of an area on the evaluator's site map. */
  | "zone-photo"
  /** The evaluator's site map, saved. */
  | "site-map"
  /** What the evaluator ticked and crossed from the client's pre-eval. */
  | "visit-plan";

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** What it belongs to, so the page it was taken on can show it: "job:<id>", "intake:<token>". */
  scope: string;
  /** In words, for the list of what is waiting: "Prep photo · Front bed". */
  label: string;
  createdAt: number;
  /** The photo, or null for something with no file (the site map, a form). */
  blob: Blob | null;
  type: string;
  args: Record<string, unknown>;
  attempts: number;
  /** Not tried again before this, after a failed try that wasn't the signal. */
  nextTryAt?: number;
  /** Set when it was refused for a reason more signal won't fix. */
  failed: string | null;
}

export type NewOutboxItem = Omit<OutboxItem, "id" | "createdAt" | "attempts" | "failed" | "nextTryAt"> & { id?: string };

const DB_NAME = "field-outbox";
const STORE = "items";
export const OUTBOX_CHANGED = "outbox-changed";
export const OUTBOX_SENT = "outbox-sent";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function changed() {
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED));
}

/** Everything waiting, oldest first, which is the order it is sent in. */
export async function outboxItems(): Promise<OutboxItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const all = ((await withStore<OutboxItem[]>("readonly", (store) => store.getAll() as IDBRequest<OutboxItem[]>)) ?? []) as OutboxItem[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Keeps something to send later. An item given an id replaces the one
 * already kept under it: the site map is kept once, as it is now, not once
 * per change.
 */
export async function keepForLater(item: NewOutboxItem): Promise<OutboxItem> {
  const kept: OutboxItem = { ...item, id: item.id ?? crypto.randomUUID(), createdAt: Date.now(), attempts: 0, failed: null };
  await withStore("readwrite", (store) => store.put(kept));
  // Ask the browser not to clear it to make room, where it lets us.
  void navigator.storage?.persist?.().catch(() => false);
  if (kept.blob) previews.set(previewKey(kept), URL.createObjectURL(kept.blob));
  changed();
  return kept;
}

export async function updateItem(item: OutboxItem): Promise<void> {
  await withStore("readwrite", (store) => store.put(item));
  changed();
}

export async function removeItem(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
  changed();
}

/** Takes one out if it is there, and says nothing if it isn't. */
export async function removeIfPresent(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const found = await withStore("readonly", (store) => store.getKey(id));
  if (found !== undefined) await removeItem(id);
}

/* ---------------------------------------------------------------- previews */

/**
 * A photo still on the phone, to show where it will be once it is sent.
 * Keyed by the storage path it is going to, when it has one, so a site map
 * that already names the path can show the picture before it exists.
 */
const previews = new Map<string, string>();

function previewKey(item: Pick<OutboxItem, "id" | "args">): string {
  return typeof item.args.path === "string" ? item.args.path : item.id;
}

export function localPreview(pathOrId: string): string | null {
  return previews.get(pathOrId) ?? null;
}

/** The waiting photos for one page, with a picture to show for each. */
export async function waitingFor(scope: string): Promise<(OutboxItem & { preview: string | null })[]> {
  const items = (await outboxItems()).filter((i) => i.scope === scope);
  return items.map((item) => {
    const key = previewKey(item);
    if (item.blob && !previews.has(key)) previews.set(key, URL.createObjectURL(item.blob));
    return { ...item, preview: item.blob ? previews.get(key)! : null };
  });
}

/* ----------------------------------------------------------------- signal */

/**
 * Whether a failure was the signal rather than a refusal. The browser says
 * "Failed to fetch" (Chrome), "Load failed" (Safari) or "NetworkError"
 * (Firefox) when a request never reached the server.
 */
export function isNoSignal(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (error as { message?: string } | null)?.message ?? "";
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|internet connection appears to be offline|network connection was lost|timed out/i.test(message);
}
