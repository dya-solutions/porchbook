import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import { claimAllLegacy, ensureLegacy, type LegacyMember } from "@/lib/porch/legacy-claim";
import type { Seed } from "@/lib/porch/model";

/** Founder: bring in the members backup downloaded from the old Grok Porchbook. */

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function parseSeed(raw: Record<string, unknown>): Seed {
  return {
    displayName: str(raw.displayName, 80).trim(),
    email: typeof raw.email === "string" ? raw.email.trim().slice(0, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl.trim().slice(0, 500) : null,
  };
}

function readBackup(text: string): LegacyMember[] {
  const parsed = asRecord(JSON.parse(text));
  const list = Array.isArray(parsed.members) ? parsed.members : [];
  const members: LegacyMember[] = [];
  for (const item of list) {
    const raw = asRecord(item);
    const email = str(raw.email, 200).trim().toLowerCase();
    if (!email || !email.includes("@") || email.endsWith("@example.com")) continue;
    members.push({
      name: str(raw.name, 120).trim(),
      email,
      joined: str(raw.joined, 40),
      posts: (Array.isArray(raw.posts) ? raw.posts : []).map((post) => {
        const p = asRecord(post);
        return { room: str(p.room, 20), body: str(p.body, 4000), createdAt: str(p.createdAt, 40), editedAt: str(p.editedAt, 40) || null };
      }),
      notes: (Array.isArray(raw.notes) ? raw.notes : []).map((note) => {
        const n = asRecord(note);
        return { title: str(n.title, 200), body: str(n.body, 60000), updatedAt: str(n.updatedAt, 40) };
      }),
    });
  }
  return members;
}

export const importLegacy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), text: str(raw.text, 4_000_000) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const me = await sql.query<{ is_founder: unknown }>("select is_founder from profiles where user_id = $1", [context.userId]);
    const flag = me[0]?.is_founder;
    if (!(flag === true || flag === "t" || flag === "true" || flag === 1)) return { ok: false as const, error: "Only the founder can do this." };
    let members: LegacyMember[];
    try {
      members = readBackup(data.text);
    } catch {
      return { ok: false as const, error: "That file isn't the members backup." };
    }
    if (!members.length) return { ok: false as const, error: "No members found in that file." };
    await ensureLegacy(sql);
    for (const member of members) {
      // Never change data someone has already received.
      await sql.query(
        `insert into legacy_members (email, name, data) values ($1, $2, $3)
         on conflict (email) do update set name = excluded.name, data = excluded.data
         where legacy_members.claimed_by is null`,
        [member.email, member.name, JSON.stringify(member)],
      );
    }
    const matched = await claimAllLegacy(sql);
    const counts = await sql.query<{ total: string; claimed: string }>(
      "select count(*)::text as total, count(claimed_by)::text as claimed from legacy_members",
    );
    const total = Number(counts[0]?.total ?? 0);
    const claimed = Number(counts[0]?.claimed ?? 0);
    return { ok: true as const, members: members.length, matchedNow: matched, claimed, waiting: total - claimed };
  });
