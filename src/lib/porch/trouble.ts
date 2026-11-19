import { createServerFn } from "@tanstack/react-start";
import { porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const emailRaw = typeof raw.email === "string" ? clip(raw.email, 200) : "";
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 60) : "",
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("http") ? raw.imageUrl.slice(0, 500) : null,
  };
}

async function ready(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists trouble_reports (
      id serial primary key,
      user_id text not null references profiles (user_id) on delete cascade,
      page text not null default '',
      words text not null default '',
      shown text not null default '',
      picture text not null default '',
      created_at timestamptz not null default now()
    )
  `;
  await sql`alter table trouble_reports add column if not exists kind text not null default 'missed'`;
  await sql`alter table trouble_reports add column if not exists handled_at timestamptz`;
  await sql`alter table trouble_reports add column if not exists reply text not null default ''`;
  await sql`alter table trouble_reports add column if not exists reply_seen boolean not null default false`;
  await porchTables(sql, { tag: [["trouble_reports", "user_id"]] });
}
async function founder(userId: string) {
  const sql = await getSql();
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const sendTrouble = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const picture = typeof raw.picture === "string" && raw.picture.startsWith("data:image/jpeg;base64,") && raw.picture.length <= 500_000 ? raw.picture : "";
    return {
      seed: parseSeed(input),
      page: typeof raw.page === "string" ? clip(raw.page, 200) : "",
      words: typeof raw.words === "string" ? clip(raw.words, 1000) : "",
      shown: typeof raw.shown === "string" ? clip(raw.shown, 500) : "",
      picture,
      kind: raw.kind === "urgent" || raw.kind === "unclear" || raw.kind === "local" || raw.kind === "praise" ? raw.kind : "unclear",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.words) return { ok: false as const, error: "Write what happened." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    await sql`
      insert into trouble_reports (user_id, page, words, shown, picture, kind)
      values (${context.userId}, ${data.page}, ${data.words}, ${data.shown}, ${data.picture}, ${data.kind})
    `;
    return { ok: true as const };
  });

export const askPorch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(input),
      page: typeof raw.page === "string" ? clip(raw.page, 200) : "",
      words: typeof raw.words === "string" ? clip(raw.words, 600) : "",
      shown: typeof raw.shown === "string" ? clip(raw.shown, 300) : "",
    };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey || !data.words) return { ok: false as const, error: "He could not answer just now." };
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 160,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are the Porchbook cartoon helping a member use the app. Prefer to answer. Give the one step they can take, in two short sentences. Answer how-to questions about the feed, Mine, Pin, Tour, Pray, My 20, upcoming events, Serve, Transport, messages, groups, offices, and calls. A red number needs 9 digits. Uganda is the usual code. My 20 needs a Manifest centre. Paste puts one name and one number on each line. Calls need the microphone allowed in the phone settings. Alerts need notification permission. A list opens from its button. A large video needs a shorter file or a link. Do not say you will pass it on if they can do something themselves. Use action answer for those. Use action needs only when the app itself is broken and no step they can take will fix it. Use action none only when they never said what failed. Use action missed only when the words are another language or have no meaning. Never invent a fix. Reply with JSON only: {\"action\":\"answer\",\"reply\":\"...\"} or {\"action\":\"needs\",\"reply\":\"I will pass this to the team.\"} or {\"action\":\"none\",\"reply\":\"Tell me what did not work.\"} or {\"action\":\"missed\",\"reply\":\"Please write it in English, and say what did not work.\"}.",
          },
          {
            role: "user",
            content: `Page: ${data.page}\nPorchbook was saying: ${data.shown || "Nothing"}\nThey wrote: ${data.words}`,
          },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: "He could not answer just now." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: true as const, action: "none" as const, reply: "Tell me what did not work." };
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { action?: string; reply?: string };
      const action = parsed.action === "answer" || parsed.action === "needs" || parsed.action === "none" ? parsed.action : "missed";
      const reply = typeof parsed.reply === "string" ? parsed.reply.replace(/\s+/g, " ").trim().slice(0, 320) : "";
      if (/pass this to the team/i.test(reply) && action !== "needs") {
        return { ok: true as const, action: "none" as const, reply: "Tell me what did not work." };
      }
      if (action === "answer" && reply.length < 8) return { ok: true as const, action: "none" as const, reply: "Tell me what did not work." };
      return { ok: true as const, action, reply: reply || "Tell me what did not work." };
    } catch {
      return { ok: true as const, action: "none" as const, reply: "Tell me what did not work." };
    }
  });

export type TroubleReport = {
  id: number;
  name: string;
  page: string;
  words: string;
  shown: string;
  picture: string;
  createdAt: string;
  handled: boolean;
  reply: string;
};

export const loadTrouble = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(input), reports: raw.reports === true, kind: raw.kind === "urgent" || raw.kind === "unclear" || raw.kind === "local" || raw.kind === "praise" ? raw.kind : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (!(await founder(context.userId))) return { ok: true as const, founder: false, reports: [] as TroubleReport[] };
    if (!data.reports) return { ok: true as const, founder: true, reports: [] as TroubleReport[] };
    const rows = await sql.query<{
      id: number;
      display_name: string;
      page: string;
      words: string;
      shown: string;
      picture: string;
      kind: string;
      created_at: string;
      handled: boolean;
      reply: string;
    }>(
      `select r.id, p.display_name, r.page, r.words, r.shown, r.picture, r.kind, r.handled_at is not null as handled, r.reply,
              to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from trouble_reports r
       join profiles p on p.user_id = r.user_id
       where (
         $1 = ''
         or ($1 = 'urgent' and r.kind in ('urgent', 'needs'))
         or ($1 = 'unclear' and r.kind in ('unclear', 'none'))
         or ($1 = 'local' and r.kind in ('local', 'missed'))
         or ($1 = 'praise' and r.kind = 'praise')
       )
         and r.porch_id = my_porch($2)
       order by (r.handled_at is not null), r.created_at desc
       limit 80`,
      [data.kind, context.userId],
    );
    return {
      ok: true as const,
      founder: true,
      reports: rows.map((row) => ({
        id: row.id,
        name: row.display_name || "Teammate",
        page: row.page,
        words: row.words,
        shown: row.shown,
        picture: row.picture,
        createdAt: row.created_at,
        handled: boolish(row.handled),
        reply: row.reply ?? "",
      })),
    };
  });

export const THANKS = "Thank you for your feedback. It's been handled.";

/** The founder ticks a report as handled, with an optional line the sender will read. */
export const handleTrouble = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: Number(raw.id) || 0, line: typeof raw.line === "string" ? clip(raw.line, 300) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!(await founder(context.userId))) return { ok: false as const, error: "Only an admin handles feedback." };
    const sql = await getSql();
    await ready(sql);
    const rows = await sql.query<{ id: number }>(
      "update trouble_reports set handled_at = now(), reply = $2, reply_seen = false where id = $1 and handled_at is null and porch_id = my_porch($3) returning id",
      [data.id, data.line, context.userId],
    );
    if (!rows.length) return { ok: false as const, error: "That one is already handled." };
    return { ok: true as const };
  });

/** Thank-you notes waiting for the signed-in person. */
export const myThanks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ready(sql);
    const rows = await sql.query<{ id: number; words: string; reply: string }>(
      "select id, words, reply from trouble_reports where user_id = $1 and handled_at is not null and not reply_seen order by handled_at limit 5",
      [context.userId],
    );
    return { notes: rows.map((row) => ({ id: row.id, words: row.words, text: row.reply ? `${THANKS} ${row.reply}` : THANKS })) };
  });

export const seenThanks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ ids: (Array.isArray(asRecord(input).ids) ? (asRecord(input).ids as unknown[]) : []).map(Number).filter((n) => n > 0).slice(0, 20) }))
  .handler(async ({ context, data }) => {
    if (!data.ids.length) return { ok: true as const };
    const sql = await getSql();
    await ready(sql);
    await sql.query("update trouble_reports set reply_seen = true where user_id = $1 and id = any($2::int[])", [context.userId, data.ids]);
    return { ok: true as const };
  });
