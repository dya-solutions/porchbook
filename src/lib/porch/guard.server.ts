import { getSql } from "@/lib/db";

const GUARD_EMAIL = "masasiedison@gmail.com";

/** Record a blocked attempt and mail the founder. Never throws. */
export function noteAttempt(userId: string | null, kind: string, detail: string): void {
  void record(userId, kind.slice(0, 40), detail.slice(0, 240));
}

async function record(userId: string | null, kind: string, detail: string) {
  try {
    const sql = await getSql();
    const recent = await sql<{ id: number }>`
      select id from guard_attempts
      where kind = ${kind}
        and coalesce(user_id, '') = ${userId ?? ""}
        and created_at > now() - interval '15 minutes'
      limit 1
    `;
    await sql`
      insert into guard_attempts (user_id, kind, detail)
      values (${userId}, ${kind}, ${detail})
    `;
    if (recent.length) return;
    await fetch(`https://formsubmit.co/ajax/${GUARD_EMAIL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: "Porchbook: someone tried to interfere",
        _template: "box",
        _captcha: "false",
        message: `${detail}\n\nThis was blocked.`,
      }),
    });
  } catch {
    // A failed note must not stop the porch.
  }
}
