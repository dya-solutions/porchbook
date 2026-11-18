import { useEffect, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { loadReadDoc } from "@/lib/porch/read";

/**
 * Library books and PDFs downloaded to read without data (⬇ Download). They're kept in the
 * phone's storage; ✓ On this phone shows which ones, and Remove frees the space.
 */

const CACHE = "porch-books-v1";
const LIST = "porch-books-offline";
type Seed = Record<string, unknown>;
type Kept = Record<string, { at: number; bytes: number }>;
export const BOOKS_CHANGED = "porch-books-offline";

const docUrl = (key: string) => `/offline/doc/${encodeURIComponent(key)}`;
const pdfUrl = (key: string) => `/offline/pdf/${encodeURIComponent(key)}`;

function list(): Kept {
  try {
    return JSON.parse(localStorage.getItem(LIST) || "{}") as Kept;
  } catch {
    return {};
  }
}
function setList(next: Kept) {
  try {
    localStorage.setItem(LIST, JSON.stringify(next));
  } catch {
    /* the list still matches the files next time */
  }
  window.dispatchEvent(new Event(BOOKS_CHANGED));
}
export const isDownloaded = (key: string) => Boolean(list()[key]);

/** ⬇ Download: the book's text (and its PDF, if it has one). */
export async function downloadBook(seed: Seed, key: string, hasPdf: boolean) {
  const cache = await caches.open(CACHE);
  const doc = await loadReadDoc({ data: { ...seed, key } as never });
  if (!doc.ok) throw new Error(doc.error);
  const text = JSON.stringify(doc);
  await cache.put(docUrl(key), new Response(text, { headers: { "content-type": "application/json" } }));
  let bytes = text.length;
  if (hasPdf) {
    const token = getBearerToken();
    const response = await fetch(`/api/read-pdf?key=${encodeURIComponent(key)}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (!response.ok) throw new Error("This PDF couldn't be downloaded.");
    const data = await response.arrayBuffer();
    bytes += data.byteLength;
    await cache.put(pdfUrl(key), new Response(data, { headers: { "content-type": "application/pdf" } }));
  }
  setList({ ...list(), [key]: { at: Date.now(), bytes } });
  return bytes;
}

export async function removeBook(key: string) {
  try {
    const cache = await caches.open(CACHE);
    await cache.delete(docUrl(key));
    await cache.delete(pdfUrl(key));
  } catch {
    /* already gone */
  }
  const next = list();
  delete next[key];
  setList(next);
}

/** The downloaded copy of a book's text (for opening without data). */
export async function keptDoc(key: string): Promise<Awaited<ReturnType<typeof loadReadDoc>> | null> {
  if (!isDownloaded(key)) return null;
  try {
    const hit = await (await caches.open(CACHE)).match(docUrl(key));
    return hit ? ((await hit.json()) as Awaited<ReturnType<typeof loadReadDoc>>) : null;
  } catch {
    return null;
  }
}
export async function keptPdf(key: string): Promise<ArrayBuffer | null> {
  if (!isDownloaded(key)) return null;
  try {
    const hit = await (await caches.open(CACHE)).match(pdfUrl(key));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export function sizeLabel(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Whether a book is on this phone (updates when one is downloaded or removed). */
export function useDownloaded(key: string) {
  const [info, setInfo] = useState(() => (typeof window === "undefined" ? undefined : list()[key]));
  useEffect(() => {
    const check = () => setInfo(list()[key]);
    check();
    window.addEventListener(BOOKS_CHANGED, check);
    return () => window.removeEventListener(BOOKS_CHANGED, check);
  }, [key]);
  return info;
}
