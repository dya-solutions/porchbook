import { memoryKey } from "@/lib/porch/runyankore";

export type CachedDevotion = {
  id: string;
  english: string;
  runyankore: string;
  source: string;
  status: string;
  savedAt: string;
};

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("porch-runyankore", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("devotionals")) db.createObjectStore("devotionals", { keyPath: "id" });
      if (!db.objectStoreNames.contains("memory")) db.createObjectStore("memory", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDevotionLocal(id: string) {
  if (!id || !("indexedDB" in globalThis)) return null;
  try {
    const db = await openDb();
    return await new Promise<CachedDevotion | null>((resolve) => {
      const request = db.transaction("devotionals").objectStore("devotionals").get(id);
      request.onsuccess = () => resolve((request.result as CachedDevotion | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveDevotionLocal(row: CachedDevotion) {
  if (!row.id || !("indexedDB" in globalThis)) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const request = db.transaction("devotionals", "readwrite").objectStore("devotionals").put(row);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  } catch {
    /* the page still shows */
  }
}

export async function readMemoryLocal() {
  const memory = new Map<string, string>();
  if (!("indexedDB" in globalThis)) return memory;
  try {
    const db = await openDb();
    const rows = await new Promise<{ key: string; runyankore: string }[]>((resolve) => {
      const request = db.transaction("memory").objectStore("memory").getAll();
      request.onsuccess = () => resolve((request.result as { key: string; runyankore: string }[]) ?? []);
      request.onerror = () => resolve([]);
    });
    for (const row of rows) if (row.key && row.runyankore) memory.set(row.key, row.runyankore);
  } catch {
    /* memory stays empty */
  }
  return memory;
}

export async function saveMemoryLocal(pairs: { english: string; runyankore: string }[]) {
  if (!("indexedDB" in globalThis)) return;
  try {
    const db = await openDb();
    const store = db.transaction("memory", "readwrite").objectStore("memory");
    for (const pair of pairs) {
      const key = memoryKey(pair.english);
      if (!key || !pair.runyankore.trim()) continue;
      store.put({ key, runyankore: pair.runyankore.trim() });
    }
  } catch {
    /* the correction still shows */
  }
}
