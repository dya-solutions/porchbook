import type { ReactionKind } from "@/lib/porch/model";
import type { Sql } from "@/lib/db";

type WebPush = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  generateVAPIDKeys: () => { publicKey: string; privateKey: string };
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
};

const ALLOWED_HOST = /(^|\.)((googleapis|mozilla|windows|apple)\.com)$/;

function allowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && ALLOWED_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

async function webPush(): Promise<WebPush> {
  const loaded = await import("web-push");
  return (loaded.default ?? loaded) as WebPush;
}

export async function publicKey(sql: Sql): Promise<string> {
  const keys = await loadKeys(sql);
  return keys.publicKey;
}

async function loadKeys(sql: Sql): Promise<{ publicKey: string; privateKey: string }> {
  const existing = await sql.query<{ public_key: string; private_key: string }>(
    "select public_key, private_key from push_keys where id = 1",
  );
  if (existing[0]) {
    return { publicKey: existing[0].public_key, privateKey: existing[0].private_key };
  }
  const generated = (await webPush()).generateVAPIDKeys();
  await sql.query(
    `insert into push_keys (id, public_key, private_key)
     values (1, $1, $2)
     on conflict (id) do nothing`,
    [generated.publicKey, generated.privateKey],
  );
  const stored = await sql.query<{ public_key: string; private_key: string }>(
    "select public_key, private_key from push_keys where id = 1",
  );
  const row = stored[0];
  if (!row) throw new Error("Push keys were not saved.");
  return { publicKey: row.public_key, privateKey: row.private_key };
}

export async function saveSubscription(
  sql: Sql,
  userId: string,
  subscription: { endpoint: string; p256dh: string; auth: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!allowedEndpoint(subscription.endpoint)) {
    return { ok: false, error: "That browser can't receive alerts." };
  }
  if (subscription.p256dh.length < 8 || subscription.auth.length < 8) {
    return { ok: false, error: "That browser can't receive alerts." };
  }
  await sql.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4)
     on conflict (endpoint) do update
       set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, subscription.endpoint, subscription.p256dh, subscription.auth],
  );
  await sql.query(
    `delete from push_subscriptions
     where user_id = $1
       and id not in (
         select id from push_subscriptions
         where user_id = $1
         order by created_at desc
         limit 8
       )`,
    [userId],
  );
  return { ok: true };
}

function reactionLine(name: string, kind: ReactionKind, target: "post" | "reply"): string {
  const place = target === "post" ? "post" : "reply";
  if (kind === "care") return `${name} loved your ${place}`;
  if (kind === "thanks") return `${name} liked your ${place}`;
  if (kind === "insight") return `${name} marked your ${place} Touching`;
  return `${name} marked your ${place} Deep`;
}

async function deliver(
  sql: Sql,
  rows: { id: number; endpoint: string; p256dh: string; auth: string }[],
  payload: string,
): Promise<void> {
  if (!rows.length) return;
  const keys = await loadKeys(sql);
  const push = await webPush();
  push.setVapidDetails("mailto:notes@porchbook.app", keys.publicKey, keys.privateKey);
  await Promise.all(
    rows.map(async (row) => {
      try {
        // A slow phone service must not hold up the post, reply or message that caused the alert.
        await push.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          { timeout: 4000 },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sql.query("delete from push_subscriptions where id = $1", [row.id]);
        }
      }
    }),
  );
}

/**
 * Chrome marks a site as spam when it sends too many alerts. Calls always ring; everything else is
 * held to at most 6 alerts per person in 30 minutes (and the extra ones simply wait for the app).
 */
const ALERTS_PER_WINDOW = 6;
let alertLogReady = false;
async function allowAlert(sql: Sql, userId: string): Promise<boolean> {
  try {
    if (!alertLogReady) {
      await sql.query("create table if not exists push_alert_log (user_id text not null, sent_at timestamptz not null default now())");
      await sql.query("create index if not exists push_alert_log_user on push_alert_log (user_id, sent_at)");
      alertLogReady = true;
    }
    const recent = await sql.query<{ n: string | number }>(
      "select count(*) as n from push_alert_log where user_id = $1 and sent_at > now() - interval '30 minutes'",
      [userId],
    );
    if (Number(recent[0]?.n ?? 0) >= ALERTS_PER_WINDOW) return false;
    await sql.query("insert into push_alert_log (user_id) values ($1)", [userId]);
    if (Math.random() < 0.02) await sql.query("delete from push_alert_log where sent_at < now() - interval '1 day'");
    return true;
  } catch {
    return true;
  }
}

async function subscriptions(sql: Sql, userId: string, urgent = false) {
  if (!urgent && !(await allowAlert(sql, userId))) return [];
  return sql.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    "select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1",
    [userId],
  );
}

async function personName(sql: Sql, userId: string): Promise<string> {
  const people = await sql.query<{ display_name: string }>(
    "select display_name from profiles where user_id = $1",
    [userId],
  );
  return people[0]?.display_name?.trim() || "Someone";
}

export async function notifyReaction(
  sql: Sql,
  recipientId: string,
  senderId: string,
  kind: ReactionKind,
  target: "post" | "reply",
): Promise<void> {
  if (!recipientId || recipientId === senderId) return;
  try {
    const name = await personName(sql, senderId);
    const rows = await subscriptions(sql, recipientId);
    await deliver(
      sql,
      rows,
      JSON.stringify({
        title: "Porchbook",
        body: reactionLine(name, kind, target),
        url: "/",
        tag: `reaction-${target}-${Date.now()}`,
        renotify: true,
      }),
    );
  } catch {
    // A failed alert must not block the reaction.
  }
}

export async function notifyIncomingCall(sql: Sql, recipientId: string, senderId: string, video = false): Promise<void> {
  if (!recipientId || recipientId === senderId) return;
  try {
    const name = await personName(sql, senderId);
    const rows = await subscriptions(sql, recipientId, true);
    await deliver(
      sql,
      rows,
      JSON.stringify({
        title: name,
        body: video ? "Incoming video call" : "Incoming voice call",
        url: `/call?userId=${encodeURIComponent(senderId)}&join=1&pick=1${video ? "&video=1" : ""}`,
        call: true,
      }),
    );
  } catch {
    // A failed alert must not block the call.
  }
}

export async function notifyCallAsk(sql: Sql, recipientId: string, senderId: string): Promise<void> {
  if (!recipientId || recipientId === senderId) return;
  try {
    const name = await personName(sql, senderId);
    const rows = await subscriptions(sql, recipientId);
    await deliver(
      sql,
      rows,
      JSON.stringify({ title: "Porchbook", body: `${name} asked to call you`, url: "/" }),
    );
  } catch {
    // A failed alert must not block the request.
  }
}

export async function notifyPrivateNote(sql: Sql, recipientId: string, senderId: string): Promise<void> {
  try {
    const name = await personName(sql, senderId);
    const rows = await subscriptions(sql, recipientId);
    await deliver(
      sql,
      rows,
      JSON.stringify({ title: "Porchbook", body: `${name} sent a private message`, url: "/messages" }),
    );
  } catch {
    // A failed alert must not block the note itself.
  }
}

export async function notifyOfficeHead(
  sql: Sql,
  headId: string,
  senderId: string,
  officeName: string,
  url: string,
): Promise<void> {
  if (!headId || headId === senderId) return;
  try {
    const name = await personName(sql, senderId);
    const rows = await subscriptions(sql, headId);
    await deliver(
      sql,
      rows,
      JSON.stringify({
        title: officeName,
        body: `${name} wrote to ${officeName}`,
        url: url.startsWith("/") ? url : "/offices",
      }),
    );
  } catch {
    // A failed alert must not block the note itself.
  }
}

export async function notifyTeam(sql: Sql, senderId: string, body: string): Promise<void> {
  try {
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 140);
    const rows = await sql.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      "select id, endpoint, p256dh, auth from push_subscriptions where user_id <> $1 and same_porch(user_id, $1)",
      [senderId],
    );
    if (!preview) return;
    await deliver(sql, rows, JSON.stringify({ title: "Porchbook", body: preview, url: "/messages" }));
  } catch {
    // A failed alert must not block the message itself.
  }
}

export async function notifyPeople(
  sql: Sql,
  recipientIds: string[],
  title: string,
  body: string,
  url: string,
): Promise<void> {
  const ids = [...new Set(recipientIds.filter(Boolean))];
  if (!ids.length || !body.trim()) return;
  try {
    const payload = JSON.stringify({
      title,
      body,
      url: url.startsWith("/") ? url : "/",
    });
    for (const recipientId of ids) {
      const rows = await subscriptions(sql, recipientId);
      await deliver(sql, rows, payload);
    }
  } catch {
    // A failed alert must not block the message itself.
  }
}

/**
 * Ring a member whose Porchbook is closed. Opens straight onto the Calls page,
 * where the caller's ring arrives once their phone joins the line.
 * Returns how many of their devices were reached.
 */
export async function notifyLineCall(sql: Sql, recipientId: string, senderId: string, video = false): Promise<number> {
  if (!recipientId || recipientId === senderId) return 0;
  const name = await personName(sql, senderId);
  const rows = await subscriptions(sql, recipientId, true);
  await deliver(
    sql,
    rows,
    JSON.stringify({
      title: name,
      body: video ? "Video call on Porchbook. Tap to answer" : "Calling you on Porchbook. Tap to answer",
      url: `/calls?answer=${encodeURIComponent(senderId)}${video ? "&video=1" : ""}`,
      call: true,
      tag: "porch-line-call",
    }),
  );
  return rows.length;
}

/** Porchbook Radio: "your request is about to play" / "… dedicated a song to you". Tapping opens the radio, playing. */
export async function notifyRadio(sql: Sql, userId: string, body: string, tag: string): Promise<void> {
  try {
    const rows = await subscriptions(sql, userId);
    await deliver(sql, rows, JSON.stringify({ title: "Porchbook Radio", body, url: "/next?tune=1", tag, renotify: true }));
  } catch {
    // A failed alert must not stop the radio.
  }
}

/** Porchbook Clinic: an answer, a vote, a new question. Tapping opens the Clinic. */
export async function notifyClinic(sql: Sql, userId: string, body: string, tag: string): Promise<void> {
  try {
    const rows = await subscriptions(sql, userId);
    await deliver(sql, rows, JSON.stringify({ title: "Porchbook Clinic", body, url: "/next?clinic=1", tag, renotify: true }));
  } catch {
    // A failed alert must not get in the way.
  }
}

/** For the founder: someone waiting for their radio request is online. Tapping opens the radio's requests. */
export async function notifyStudio(sql: Sql, userId: string, body: string, tag: string): Promise<void> {
  try {
    const rows = await subscriptions(sql, userId);
    await deliver(sql, rows, JSON.stringify({ title: "Porchbook Radio · Requests", body, url: "/next?radio=requests", tag, renotify: true }));
  } catch {
    // A failed alert must not get in the way.
  }
}
