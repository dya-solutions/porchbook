import { createServerFn } from "@tanstack/react-start";
import { myPorchId } from "@/lib/porch/porch-foundation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";

/**
 * Resizable items, shared by everyone.
 *
 * A "place" is where items sit (e.g. "read-shelf", later "office:pastor");
 * an "item" is one thing there (a book key, a file id). Width and height are
 * percentages of the row the item sits in. Only the founder may change them;
 * every member sees the founder's sizes.
 */
export type ItemSize = { w: number; h: number };
export type ItemSizes = Record<string, ItemSize>;

const NAME = /^[a-z0-9:_-]{1,80}$/i;

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function clamp(value: unknown, low: number, high: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(high, Math.max(low, n)) * 10) / 10;
}

async function isFounder(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(rows[0]?.is_founder);
}

export const loadItemSizes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return { place: typeof raw.place === "string" && NAME.test(raw.place) ? raw.place : "" };
  })
  .handler(async ({ context, data }) => {
    const founder = await isFounder(context.userId);
    if (!data.place) return { founder, sizes: {} as ItemSizes };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    const rows = await sql.query<{ item: string; w: number; h: number }>(`select item, w, h from item_sizes where porch_id = ${porch} and place = $1`,
      [data.place],
    );
    const sizes: ItemSizes = {};
    for (const row of rows) sizes[row.item] = { w: Number(row.w), h: Number(row.h) };
    return { founder, sizes };
  });

export const saveItemSize = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return {
      place: typeof raw.place === "string" && NAME.test(raw.place) ? raw.place : "",
      item: typeof raw.item === "string" && NAME.test(raw.item) ? raw.item : "",
      reset: raw.reset === true,
      w: clamp(raw.w, 4, 100),
      h: clamp(raw.h, 20, 100),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.place || !data.item) return { ok: false as const, error: "Nothing to resize." };
    if (!(await isFounder(context.userId))) {
      noteAttempt(context.userId, "item-size", "Tried to resize something.");
      return { ok: false as const, error: "Only an admin can resize." };
    }
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    if (data.reset) {
      await sql.query(`delete from item_sizes where porch_id = ${porch} and place = $1 and item = $2`, [data.place, data.item]);
      return { ok: true as const };
    }
    if (data.w === null || data.h === null) return { ok: false as const, error: "That size isn't valid." };
    await sql.query(`insert into item_sizes (porch_id, place, item, w, h, updated_at) values (${porch}, $1, $2, $3, $4, now())
       on conflict (porch_id, place, item) do update set w = excluded.w, h = excluded.h, updated_at = now()`,
      [data.place, data.item, data.w, data.h],
    );
    return { ok: true as const };
  });

/**
 * React hook for a place's sizes. `resize` updates the screen at once and
 * saves (debounced) for everyone; `reset` returns an item to its natural size.
 */
// Remember the last sizes on this device so a page opens in its current
// look straight away, instead of flashing normal sizes until the server answers.
function readCache(place: string): { sizes: ItemSizes; founder: boolean } {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(`porch-sizes:${place}`) : null;
    if (!raw) return { sizes: {}, founder: false };
    const parsed = JSON.parse(raw) as { sizes?: ItemSizes; founder?: boolean };
    return { sizes: parsed.sizes && typeof parsed.sizes === "object" ? parsed.sizes : {}, founder: Boolean(parsed.founder) };
  } catch {
    return { sizes: {}, founder: false };
  }
}

function writeCache(place: string, sizes: ItemSizes, founder: boolean) {
  try {
    localStorage.setItem(`porch-sizes:${place}`, JSON.stringify({ sizes, founder }));
  } catch {
    /* sizes still work without the cache */
  }
}

export function useItemSizes(place: string, enabled = true) {
  const [sizes, setSizes] = useState<ItemSizes>({});
  const [founder, setFounder] = useState(false);

  // Before the first paint, show the sizes remembered on this device.
  const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useBeforePaint(() => {
    const cached = readCache(place);
    setSizes(cached.sizes);
    setFounder(cached.founder);
  }, [place]);
  const [error, setError] = useState("");
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    loadItemSizes({ data: { place } })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setSizes(result.sizes);
        writeCache(place, result.sizes, result.founder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [place, enabled]);

  const resize = useCallback(
    (item: string, size: ItemSize) => {
      setSizes((current) => {
        const next = { ...current, [item]: size };
        writeCache(place, next, true);
        return next;
      });
      window.clearTimeout(timers.current[item]);
      timers.current[item] = window.setTimeout(() => {
        saveItemSize({ data: { place, item, w: size.w, h: size.h } })
          .then((result) => setError(result.ok ? "" : result.error))
          .catch(() => setError("Couldn't save that size. Try again."));
      }, 400);
    },
    [place],
  );

  const reset = useCallback(
    (item: string) => {
      setSizes((current) => {
        const next = { ...current };
        delete next[item];
        writeCache(place, next, true);
        return next;
      });
      window.clearTimeout(timers.current[item]);
      saveItemSize({ data: { place, item, reset: true } })
        .then((result) => setError(result.ok ? "" : result.error))
        .catch(() => setError("Couldn't reset that size. Try again."));
    },
    [place],
  );

  return { sizes, founder, error, resize, reset };
}
