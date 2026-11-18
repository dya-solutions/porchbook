import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** When a paid service is about to run dry. */
export type CreditWarning = { key: "ai" | "voice" | "nyn" | "lug" | "radio-storage" | "radio-listening"; text: string; empty: boolean };

// Vercel Blob on the free (Hobby) plan: past either limit, Vercel blocks the store for 30 days and the Radio goes silent.
const BLOB_STORAGE_GB = 1;
const R2_STORAGE_GB = 10; // Cloudflare R2's free storage (listening is free there)
const BLOB_TRANSFER_GB = 10;
const GB_PER_LISTEN_HOUR = 0.065; // about 128 kbit/s, plus the next item loading ahead
const WARN_AT = 0.7;

const AI_LOW_USD = 1; // the porch guy's credit, in dollars
const VOICE_LOW_CHARS = 25_000; // ElevenLabs characters (a devotional reading is roughly 6–10 thousand)

/** Founder only: the paid services that are low (empty list when all is well). */
export const getCreditWarnings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: unknown }>("select is_founder from profiles where user_id = $1", [context.userId]);
    const f = me[0]?.is_founder;
    if (!(f === true || f === 1 || f === "1" || f === "t" || f === "true")) return { ok: false as const, warnings: [] as CreditWarning[] };
    const warnings: CreditWarning[] = [];

    // The porch guy's AI: the credit loaded, less what's been spent since.
    try {
      const credit = await sql.query<{ amount_usd: number; set_at: string }>("select amount_usd, set_at from porch_guy_credit where id = 1");
      if (credit.length) {
        const spent = await sql.query<{ since: number }>("select coalesce(sum(cost_usd), 0) as since from porch_guy_usage where created_at >= $1", [credit[0].set_at]);
        const left = Number(credit[0].amount_usd) - Number(spent[0]?.since ?? 0);
        if (left < AI_LOW_USD)
          warnings.push({
            key: "ai",
            empty: left <= 0,
            text: left <= 0 ? "The porch guy's AI credit has run out: he can't answer until it's topped up." : `The porch guy's AI credit is low: about $${left.toFixed(2)} left.`,
          });
      }
    } catch {
      /* no meter yet */
    }

    // The devotional voice (ElevenLabs): characters left this month.
    try {
      const rows = await sql.query<{ api_key: string; backup_first: unknown; backup_key: string; backup_voice: string }>(
        "select api_key, backup_first, backup_key, backup_voice from devotion_voice_settings where id = 1",
      );
      const key = rows[0]?.api_key ?? "";
      // Another voice (Azure) reads every day: ElevenLabs running low doesn't matter, so no warning.
      const otherMain = rows[0]?.backup_first === true && Boolean(rows[0]?.backup_key) && Boolean(rows[0]?.backup_voice);
      if (key.startsWith("sk_") && !otherMain) {
        const plan = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
        if (plan.ok) {
          const info = (await plan.json()) as { character_count?: number; character_limit?: number };
          if (info.character_limit) {
            const left = Math.max(0, info.character_limit - (info.character_count ?? 0));
            if (left < VOICE_LOW_CHARS)
              warnings.push({
                key: "voice",
                empty: left < 3000,
                text:
                  left < 3000
                    ? "The devotional voice (ElevenLabs) has run out for this month: the devotional can't be read aloud."
                    : `The devotional voice (ElevenLabs) is low: ${left.toLocaleString()} characters left this month (about ${Math.max(1, Math.floor(left / 8000))} devotional${left >= 16000 ? "s" : ""}).`,
              });
          }
        }
      }
    } catch {
      /* couldn't reach ElevenLabs: say nothing rather than a false alarm */
    }
    // Today's machine-translated Runyankore or Luganda, waiting for the founder's check.
    try {
      const waiting = await sql.query<{ lang: string }>(
        `select distinct t.lang from devotion_translations t join read_docs d on d.link = t.link and d.key = 'devotion'
         where t.lang in ('nyn', 'lug') and t.source = 'machine' and t.approved = false`,
      );
      for (const row of waiting) {
        const name = row.lang === "lug" ? "Luganda" : "Runyankore";
        warnings.push({ key: row.lang === "lug" ? "lug" : "nyn", empty: false, text: `Today's ${name} translation is waiting for your check (Devotional → ${name}).` });
      }
    } catch {
      /* no translations table yet */
    }
    // The Radio's audio storage and this month's listening (an estimate, warned about early).
    try {
      const usage = await sql.query<{ storage_bytes: string | number; stale: unknown }>(
        "select storage_bytes, (checked_at is null or checked_at < now() - interval '12 hours') as stale from radio_usage where id = 1",
      );
      let bytes = Number(usage[0]?.storage_bytes ?? 0);
      const stale = usage[0]?.stale === true || usage[0]?.stale === "t" || usage[0]?.stale === 1;
      const store = await import("@/lib/porch/audio-store.server");
      const cloud = Boolean(await store.cloudStore(sql));
      const STORE_GB = cloud ? R2_STORAGE_GB : BLOB_STORAGE_GB;
      if (stale && (cloud || process.env.BLOB_READ_WRITE_TOKEN)) {
        // Count every stored file (done about twice a day).
        const all = await store.listStore(sql);
        const total = all.reduce((n, f) => n + f.size, 0);
        const files = all.length;
        bytes = total;
        await sql.query("update radio_usage set storage_bytes = $1, files = $2, checked_at = now() where id = 1", [total, files]);
      }
      const storedGb = bytes / 1024 ** 3;
      if (storedGb >= STORE_GB * WARN_AT) {
        const full = storedGb >= STORE_GB;
        warnings.push({
          key: "radio-storage",
          empty: full,
          text: full
            ? `Radio storage is full (${storedGb.toFixed(2)} GB of ${STORE_GB} GB): ${cloud ? "Cloudflare starts charging a little" : "Vercel may block the Radio's audio for 30 days"}. Remove some audio or Bible books now.`
            : `Radio storage is at ${Math.round((storedGb / STORE_GB) * 100)}% (${storedGb.toFixed(2)} GB of ${STORE_GB} GB).${cloud ? "" : " Past 1 GB the Radio stops for 30 days."}`,
        });
      }
      const heard = await sql.query<{ n: number; days_left: number }>(
        `select count(*)::int as n,
                (date_trunc('month', now() at time zone 'Africa/Kampala') + interval '1 month')::date - (now() at time zone 'Africa/Kampala')::date as days_left
           from fm_listen_hours where hour_start >= (date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala')`,
      );
      const hours = Number(heard[0]?.n ?? 0);
      const usedGb = hours * GB_PER_LISTEN_HOUR;
      if (!cloud && usedGb >= BLOB_TRANSFER_GB * WARN_AT) {
        const full = usedGb >= BLOB_TRANSFER_GB;
        const share = Math.round((usedGb / BLOB_TRANSFER_GB) * 100);
        const days = Number(heard[0]?.days_left ?? 0);
        warnings.push({
          key: "radio-listening",
          empty: full,
          text: full
            ? `Radio listening this month is about ${usedGb.toFixed(1)} GB, past the free ${BLOB_TRANSFER_GB} GB: Vercel may block the Radio's audio for 30 days.`
            : `Radio listening this month is at about ${share}% of the free ${BLOB_TRANSFER_GB} GB (${hours} listening hours), with ${days} day${days === 1 ? "" : "s"} left in the month.${share >= 90 ? " The Radio may stop soon." : ""}`,
        });
      }
    } catch {
      /* measured next time */
    }
    return { ok: true as const, warnings };
  });

/** Studio: the Radio's storage and this month's listening against the free limits (from the last measure). */
export const getRadioUsage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const { canRunStudio } = await import("@/lib/porch/fm");
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const };
    const usage = await sql.query<{ storage_bytes: string | number; checked_at: string | null }>("select storage_bytes, checked_at from radio_usage where id = 1").catch(() => []);
    const heard = await sql.query<{ n: number }>(
      "select count(*)::int as n from fm_listen_hours where hour_start >= (date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala')",
    );
    const hours = Number(heard[0]?.n ?? 0);
    const cloud = Boolean(await (await import("@/lib/porch/audio-store.server")).cloudStore(sql));
    return {
      cloud,
      ok: true as const,
      storedGb: Number(usage[0]?.storage_bytes ?? 0) / 1024 ** 3,
      measured: Boolean(usage[0]?.checked_at),
      usedGb: hours * GB_PER_LISTEN_HOUR,
      hours,
      storageLimit: cloud ? R2_STORAGE_GB : BLOB_STORAGE_GB,
      transferLimit: cloud ? 0 : BLOB_TRANSFER_GB,
    };
  });
