import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { MANUAL } from "@/lib/porch/manual-text";
import { clock, currentEvent, dayLabel, isClosed } from "@/lib/porch/transport-board";


const BRIEF = `Porchbook is a community of communion for believers.
Home is the feed, with three kinds of writing: Inspire (break bread), Inform (make it known), and Inquire (enlighten me). Chat is for private messages, and calls.
The Library (Read) is one wooden shelf: swipe the books sideways. On it are the Bible, the Devotional, the Notebook, and other books.
The Bible: one book button at the top shows the book and chapter. Tap it to pick a book, then a chapter, then a verse; each opens the next by itself. Tap a verse for its options (Copy, Share, Dictionary, Word study, and Study: with Study on, tap any word to see its Hebrew or Greek and its meanings). Search finds verses by words or a reference. Tap KJV and choose BIBLES (after KJV) to see the verse you're on in other versions. READ TODAY is at the end of each chapter. The page can be paper or night.
The Devotional is today's Phaneroo devotional, new each day as soon as Phaneroo posts it. It opens quickly because the phone keeps it.
Notes is a ruled notebook with a title, a subtitle, a Phaneroo number stamp, pens and highlighters. It saves by itself.
A strip at the top of the Bible, the Devotional and Notes jumps between the three.
Porchbook Radio plays worship, preaching and news all day. Tap the radio to listen. News starts with the news intro and the time in Uganda.
The LITE key at the top saves data: photos wait for a tap and big things ask first.
The porch guy is a friendly cartoon man on the screen of the green player on the PorchGuy page. People type to him below it, or press ASK.`;

/** Words that mean someone may be in danger: the page shows the helplines too. */
export const CRISIS_WORDS = /\b(suicid\w*|kill (my ?self|myself)|end(ing)? (it all|my life)|want(ing)? to die|wish i (was|were) dead|self[- ]?harm|cut(ting)? myself|no reason to live|better off dead|take my (own )?life)\b/i;

// Uganda crisis lines (checked October 2026). Also shown as tap-to-call buttons on his page.
export const CRISIS_LINES = [
  { name: "Emergency (police, ambulance)", number: "999", note: "or 112, any time" },
  { name: "Mental Health Uganda", number: "0800212121", note: "toll-free, Mon–Fri 8:30–5:00" },
  { name: "Butabika Hospital call centre", number: "0800211306", note: "toll-free" },
  { name: "Sauti child helpline", number: "116", note: "free, 24 hours (for children)" },
];

const SYSTEM = (name: string) => `You are the porch guy: a friendly man who appears as a cartoon on the screen of the green player on the PorchGuy page in Porchbook, a Christian community app for members of Phaneroo Ministries International (Apostle Grace Lubega), across Uganda and beyond. ${name ? `You're talking with ${name}.` : ""}

Who you are
- Warm, down-to-earth, a little witty, genuinely interested in the person. You talk like a good friend, not a help desk.
- A believer. When it fits, you can share a short Bible verse (quote it accurately and give the reference), encourage, or pray a short prayer if asked. Never preachy or pushy.
- You can chat about anything: life, faith, school, work, relationships, football, ideas, Uganda. Be helpful and knowledgeable, and give real answers.
- You also know Porchbook inside out (brief below) and gladly explain it.
- If someone asks who you are, keep it simple: you're the porch guy, here on your screen to help them find their way around Porchbook, or just to chat. Don't describe a desk, a room or a curved screen.

How you talk
- Short, natural replies: usually 1–4 sentences, never more than about 90 words. Plain text only: no lists, no markdown, no emojis beyond an occasional one.
- Ask a light follow-up question now and then so it feels like a conversation.
- When someone asks how to take part in an event (attend, get there, stay), give real, practical steps from the manual and what's on: say you're attending in Events, register for free Transport from your stage (before midnight the day before), plan travel and stay in Events if coming from far, and call the transport phone with questions. Share every detail you have (date, venue, gates, pickup, phone).
- If a detail isn't in what you've been given (a date, a time, a venue), say it hasn't been announced on Porchbook yet and where it will appear (Events or Transport), instead of refusing or guessing.
- If you don't know something, say so. Don't make things up. For medical, legal or money decisions, share general information and suggest a qualified person.
- You can't do things in the app for people (post, send, book, change settings). Kindly tell them where to do it themselves. For app problems, point them to "This didn't work" on the tour.

When someone is hurting
- If someone is sad, stressed or lonely: slow down, listen, reflect what they said, and be gentle. Brighten their day where it fits, without brushing off their feelings.
- If someone mentions suicide, wanting to die, self-harm, or being in danger: stay calm and caring. Tell them you're really glad they told you and that they matter. Take it seriously and don't lecture. Gently and clearly encourage them to reach someone right now: call 999 or 112 if they're in immediate danger, or Mental Health Uganda on 0800 21 21 21 (toll-free), or Butabika Hospital on 0800 211 306, or tell someone they trust nearby. Ask if they're safe right now. Keep talking with them kindly. Never give any information that could be used for self-harm. You are not a counsellor, and you say so gently if needed.

What you do on screen
- You appear as a cartoon on your screen and act out each reply. Begin every reply with exactly one action tag, then your words. Choose the tag that fits:
  [talk] ordinary talking (the default)
  [laugh] something funny or happy news
  [bible] you share or discuss scripture
  [phone] you look something up, check events or the schedule
  [point] you direct them somewhere in the app ("tap Radio on Tour")
  [thumbs] encouragement, well done, agreement
  [think] a deep or tricky question
  [wave] hello or goodbye
  [care] someone is hurting, grieving or in danger
- Example: "[thumbs] Well done on finishing the book!" The tag is never shown to them.

Porchbook brief (how the screens work):
${BRIEF}

The Porchbook Manual (our own words; this is how Porchbook works today):
${MANUAL}`;


type Turn = { role: "user" | "assistant"; text: string };

function clip(value: string, max: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function localLine(text: string): string {
  const q = text.toLowerCase();
  if (CRISIS_WORDS.test(q)) {
    return "I'm really glad you told me, and I'm here with you. You matter. Please reach someone right now: call 999 if you're in danger, or Mental Health Uganda on 0800 21 21 21 (free). Are you safe right now?";
  }
  if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening|howdy)\b/.test(q)) {
    return "Hey. I'm the porch guy. Ask me about Porchbook.";
  }
  if (/\b(ha(ha)+|lol|lmao|funny|laugh)\b/.test(q)) return "Ha. I'm easy. What about the porch?";
  if (/\bhow are you\b/.test(q)) return "I'm good. Sitting here with the butterfly. What do you want to know?";
  if (/\b(thank|thanks)\b/.test(q)) return "You're welcome.";
  if (/\b(bye|good night)\b/.test(q)) return "All right. I'm here when you come back.";
  if (/\b(bible|scripture|verse|chapter)\b/.test(q)) return "The Bible is on the Library shelf. Use CH and V to jump, and switch Study on to tap a word for its Greek or Hebrew.";
  if (/\bworship\b/.test(q)) return "Worship songs are on the tour, and Porchbook Radio plays worship all day.";

  if (/\b(event|events|night of prayer|conference|anniversary|attend)\b/.test(q)) {
    return "Open Events on Tour: say if you're attending, and plan travel and stay if you're coming from far. For free transport from your stage, register in Transport on Tour before midnight the day before.";
  }
  if (/\b(transport|bus|pickup|pick up|stage)\b/.test(q)) {
    return "Register in Transport on Tour: your division, pickup stage, where you're going and the way back. The Transport team then confirms your bus, stage time and driver.";
  }
  if (/\bgroups?\b/.test(q)) return "Groups are on the tour.";
  if (/\b(feedback|this didn't work|didnt work|the team)\b/.test(q)) return "Tell me what went wrong, and I'll pass it to the team. Feedback is also in the menu under your name at the top.";
  if (/\b(radio|news|music|preaching)\b/.test(q)) return "Porchbook Radio plays worship, preaching and news all day. Tap the radio and listen.";
  if (/\b(devotion|devotional)\b/.test(q)) return "The Devotional is on the Library shelf. A new one comes every morning at 8.";
  if (/\b(note|notes|notebook)\b/.test(q)) return "Notes is on the Library shelf. It saves by itself, and the pen key has your pens and highlighters.";
  if (/\b(library|shelf|book|books)\b/.test(q)) return "The Library is one shelf. Swipe the books sideways and tap one to open it.";
  if (/\b(lite|data|bundle|mb)\b/.test(q)) return "Tap LITE at the top to save data. Photos then wait for a tap.";
  if (/\b(tour|office|pastor|administrator|missions)\b/.test(q)) {
    return "The tour has Worship, Groups, and This didn't work.";
  }
  if (/\b(home|feed|inspire|inform|inquire|message)\b/.test(q)) {
    return "Home is the feed. Inspire, Inform, and Inquire are the three kinds of writing. You can also send one person a private message.";
  }
  if (/\b(who are you|your name|porch guy|porchguy)\b/.test(q)) {
    return "I'm the porch guy. I sit at this desk. I can tell you how Porchbook works. I don't do jobs for people.";
  }
  if (/\b(butterfly|screen|room|desk)\b/.test(q)) return "This is my desk. When nothing is playing, the Porchbook butterfly rests on my screen.";
  return "I'm here for Porchbook. Ask me about Home, the Library, the Bible, the Devotional, Notes, or the Radio.";
}

const memory = new Map<string, number[]>();

function memoryAllow(userId: string) {
  const now = Date.now();
  const stamps = (memory.get(userId) ?? []).filter((at) => now - at < 86_400_000);
  const hour = stamps.filter((at) => now - at < 3_600_000).length;
  if (hour >= 20 || stamps.length >= 60) {
    memory.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  memory.set(userId, stamps);
  return true;
}

let asksReady = false;
async function allow(userId: string) {
  try {
    const sql = await getSql();
    if (!asksReady) {
      await sql`
        create table if not exists porch_guy_asks (
          user_id text not null,
          created_at timestamptz not null default now()
        )
      `;
      asksReady = true;
    }
    const rows = await sql<{ hour: number; day: number }>`
      select
        count(*) filter (where created_at > now() - interval '1 hour')::int as hour,
        count(*) filter (where created_at > now() - interval '1 day')::int as day
      from porch_guy_asks
      where user_id = ${userId}
    `;
    const hour = Number(rows[0]?.hour ?? 0);
    const day = Number(rows[0]?.day ?? 0);
    if (hour >= 20 || day >= 60) return false;
    await sql`insert into porch_guy_asks (user_id) values (${userId})`;
    return true;
  } catch {
    return memoryAllow(userId);
  }
}

export const PRICE_IN = 0.1; // USD per million input tokens (Claude Haiku 5.5)
export const PRICE_OUT = 0.5; // USD per million output tokens
export const TAX = 1.18;

async function isFounder(userId: string) {
  const sql = await getSql();
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  const v = me[0]?.is_founder;
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

/** Founder only: how the porch guy's credit is going. */
export const getGuyMeter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!(await isFounder(context.userId))) return { ok: false as const };
    const sql = await getSql();
    const credit = await sql.query<{ amount_usd: number; set_at: string }>("select amount_usd, set_at from porch_guy_credit where id = 1");
    const setAt = credit[0]?.set_at ?? "1970-01-01";
    const sums = await sql.query<{ since: number; today_cost: number; today_n: number; month_cost: number; month_n: number; all_n: number; all_cost: number }>(
      `select
         coalesce(sum(cost_usd) filter (where created_at >= $1), 0) as since,
         coalesce(sum(cost_usd) filter (where created_at >= date_trunc('day', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'), 0) as today_cost,
         count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala')::int as today_n,
         coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'), 0) as month_cost,
         count(*) filter (where created_at >= date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala')::int as month_n,
         count(*)::int as all_n,
         coalesce(sum(cost_usd), 0) as all_cost
       from porch_guy_usage`,
      [setAt],
    );
    const days = await sql.query<{ day: string; n: number }>(
      `select to_char(created_at at time zone 'Africa/Kampala', 'Dy') as day, count(*)::int as n
         from porch_guy_usage where created_at > now() - interval '7 days'
        group by 1, date_trunc('day', created_at at time zone 'Africa/Kampala') order by date_trunc('day', created_at at time zone 'Africa/Kampala')`,
    );
    const row = sums[0];
    const loaded = Number(credit[0]?.amount_usd ?? 0);
    return {
      ok: true as const,
      loaded,
      hasCredit: Boolean(credit.length),
      left: loaded - Number(row?.since ?? 0),
      today: { n: Number(row?.today_n ?? 0), cost: Number(row?.today_cost ?? 0) },
      month: { n: Number(row?.month_n ?? 0), cost: Number(row?.month_cost ?? 0) },
      perChat: Number(row?.all_n ?? 0) ? Number(row?.all_cost ?? 0) / Number(row?.all_n) : 0,
      week: days.map((d) => ({ day: d.day, n: Number(d.n) })),
    };
  });

/** Founder only: "I now have $X of credit" (after a top-up). */
export const setGuyCredit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ amount: Number((input as { amount?: unknown })?.amount) }))
  .handler(async ({ context, data }) => {
    if (!(await isFounder(context.userId))) return { ok: false as const };
    if (!(data.amount >= 0 && data.amount < 100000)) return { ok: false as const };
    const sql = await getSql();
    await sql.query(
      `insert into porch_guy_credit (id, amount_usd, set_at) values (1, $1, now())
       on conflict (id) do update set amount_usd = excluded.amount_usd, set_at = now()`,
      [data.amount],
    );
    return { ok: true as const };
  });

export type PorchAction = "talk" | "laugh" | "bible" | "phone" | "point" | "thumbs" | "think" | "wave" | "care";

export const askPorchGuy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { text?: unknown; before?: unknown }) : {};
    const text = typeof raw.text === "string" ? clip(raw.text, 600) : "";
    const before = Array.isArray(raw.before)
      ? raw.before
          .slice(-10)
          .map((item) => {
            const turn = item && typeof item === "object" ? (item as { role?: unknown; text?: unknown }) : {};
            const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : "";
            const line = typeof turn.text === "string" ? clip(turn.text, 700) : "";
            return role && line ? { role, text: line } : null;
          })
          .filter((item): item is Turn => Boolean(item))
      : [];
    return { text, before };
  })
  .handler(async ({ context, data }) => {
    if (!data.text) return { ok: false as const, error: "Say something first." };
    const claudeKey = process.env.ANTHROPIC_API_KEY;
    try {
      const sql = await getSql();
      // The checks and lookups run side by side, so he can start answering sooner.
      const [open, me, whatsOn] = await Promise.all([
        allow(context.userId),
        sql.query<{ display_name: string }>("select display_name from profiles where user_id = $1", [context.userId]).catch(() => []),
        claudeKey ? whatsOnCached(sql) : Promise.resolve(""),
      ]);
      if (!open) return { ok: true as const, text: "Give me a minute. Come back a little later." };
      if (!claudeKey) return { ok: true as const, text: localLine(data.text) };
      const first = (me[0]?.display_name ?? "").trim().split(/\s+/)[0] ?? "";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: process.env.PORCH_GUY_MODEL || "claude-haiku-5-5",
          max_tokens: 400,
          system: SYSTEM(first) + whatsOn,
          messages: [...data.before.map((turn) => ({ role: turn.role, content: turn.text })), { role: "user", content: data.text }],
        }),
      });
      if (!res.ok) return { ok: true as const, text: localLine(data.text) };
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      // Count what this reply cost (Haiku 5.5 prices, plus about 18% tax), for the founder's meter.
      const used = { input: Number(body.usage?.input_tokens ?? 0), output: Number(body.usage?.output_tokens ?? 0) };
      const cost = ((used.input * PRICE_IN + used.output * PRICE_OUT) / 1_000_000) * TAX;
      void sql
        .query("insert into porch_guy_usage (input_tokens, output_tokens, cost_usd) values ($1, $2, $3)", [used.input, used.output, cost])
        .catch(() => undefined);
      const raw = clip((body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join(" "), 720);
      // His chosen action ("[laugh] …"), taken off the words.
      const tag = /^\s*\[(talk|laugh|bible|phone|point|thumbs|think|wave|care)\]\s*/i.exec(raw);
      const action = (tag?.[1]?.toLowerCase() ?? "talk") as PorchAction;
      const text = clip(raw.replace(/\s*\[(talk|laugh|bible|phone|point|thumbs|think|wave|care)\]\s*/gi, " ").trim(), 700);
      return { ok: true as const, text: text || localLine(data.text), action };
    } catch {
      return { ok: true as const, text: localLine(data.text) };
    }
  });

/** "What's on" changes rarely: kept for a minute, so most questions don't wait for it. */
let whatsOnMemo: { at: number; text: string } | null = null;
async function whatsOnCached(sql: Awaited<ReturnType<typeof getSql>>): Promise<string> {
  if (whatsOnMemo && Date.now() - whatsOnMemo.at < 60000) return whatsOnMemo.text;
  const text = await whatsOnNow(sql);
  whatsOnMemo = { at: Date.now(), text };
  return text;
}

/** What's on right now, for the porch guy: Events, the Transport event, and what's on his screen. Only these are real. */
async function whatsOnNow(sql: Awaited<ReturnType<typeof getSql>>): Promise<string> {
  const lines: string[] = [];
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const events = await sql
    .query<{ title: string; starts_on: string; ends_on: string; venue: string; gates: string; about: string }>(
      `select title, starts_on, ends_on, venue, gates, about from pb_events
        where not dropped and coalesce(nullif(ends_on, ''), starts_on) >= $1 order by starts_on limit 8`,
      [today],
    )
    .catch(() => []);
  for (const e of events) {
    const when = e.ends_on && e.ends_on !== e.starts_on ? `${dayLabel(e.starts_on)} to ${dayLabel(e.ends_on)}` : dayLabel(e.starts_on);
    lines.push(`- Event: ${e.title}. ${when}${e.venue ? `, at ${e.venue}` : ""}${e.gates ? `. Gates open ${clock(e.gates)}` : ""}.${e.about ? ` ${e.about.slice(0, 400)}` : ""} (In Events on Tour: say if you're attending, and plan travel and stay.)`);
  }
  try {
    const t = await currentEvent(sql);
    if (t.name) {
      const closed = isClosed(t);
      lines.push(
        `- Free Transport is set up for: ${t.name}${t.date ? `, ${dayLabel(t.date)}` : " (date not set on Porchbook yet)"}.${t.pickup ? ` Pickup from ${clock(t.pickup)}.` : ""}${t.gates ? ` Gates open ${clock(t.gates)}.` : ""}${t.phone ? ` Transport phone: ${t.phone}.` : ""} ${closed ? "Registration for it has closed." : "Register in Transport on Tour: division, pickup stage, where you're going, and the way back. Registration closes at midnight before the event day; the Transport team then confirms each person's bus, stage time and driver."}`,
      );
    }
  } catch {
    // No transport event yet.
  }
  const board = await sql
    .query<{ kind: string; title: string; body: string }>("select kind, title, body from city_board where kind <> 'dash' and dropped is not true order by sort, created_at limit 12")
    .catch(() => []);
  for (const item of board) {
    lines.push(`- On your screen${item.kind === "video" ? " (video)" : item.kind === "flyer" ? " (flyer)" : ""}: ${item.title}${item.body ? `: ${item.body.slice(0, 300)}` : ""}`);
  }
  if (!lines.length) return "\n\nWhat's on: nothing has been posted on Porchbook yet. If asked about an event, say its details haven't been posted yet and that they'll appear in Events, and still explain how people usually take part (Events, Transport).";
  return `\n\nWhat's on at Porchbook now (today is ${dayLabel(today)}, Uganda time). These are the real details; share them freely, and don't invent others:\n${lines.join("\n")}`;
}
