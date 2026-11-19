import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

async function ensureRoll(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists removed_members (
      user_id text primary key,
      email text,
      removed_at timestamptz not null default now()
    )
  `;
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string): Promise<boolean> {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const porchStanding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await ensureRoll(sql);
    const email = seed.email?.trim().toLowerCase() ?? "";
    try {
      const blocked = await sql.query<{ user_id: string }>(
        `select user_id from removed_members
         where user_id = $1 or ($2 <> '' and lower(coalesce(email, '')) = $2)
         limit 1`,
        [context.userId, email],
      );
      if (blocked.length) return { removed: true as const };
    } catch {
      return { removed: false as const };
    }
    await touchProfile(sql, context.userId, seed);
    return { removed: false as const };
  });

export type RollPerson = {
  userId: string;
  displayName: string;
  imageUrl: string | null;
  role: string;
  team: string;
  offices: string;
  founder: boolean;
  joinedAt: string;
};

export const listRoll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await ensureRoll(sql);
    await touchProfile(sql, context.userId, seed);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "roll", "Tried to open the roll.");
      return { ok: false as const, error: "Only an admin can see the roll." };
    }
    const rows = await sql.query<{
      user_id: string;
      display_name: string;
      image_url: string | null;
      role: string | null;
      team: string | null;
      offices: string | null;
      is_founder: boolean;
      joined_at: string;
    }>(
      `select p.user_id, p.display_name, p.image_url, p.role, p.team, is_porch_admin(p.user_id) as is_founder,
              coalesce(string_agg(o.name, ', ' order by o.sort), '') as offices,
              to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as joined_at
       from profiles p
       left join offices o on o.head_user_id = p.user_id
       where p.porch_id = my_porch($1)
       group by p.user_id, p.display_name, p.image_url, p.role, p.team, p.created_at
       order by is_porch_admin(p.user_id) desc, lower(p.display_name) asc`,
      [context.userId],
    );
    const people: RollPerson[] = rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      imageUrl: row.image_url,
      role: row.role ?? "",
      team: row.team ?? "",
      offices: row.offices ?? "",
      founder: boolish(row.is_founder),
      joinedAt: row.joined_at,
    }));
    return { ok: true as const, people };
  });

export const listPorch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const rows = await sql.query<{
      user_id: string;
      display_name: string;
      image_url: string | null;
      offices: string | null;
    }>(
      `select p.user_id, p.display_name, p.image_url,
              coalesce(string_agg(o.name, ', ' order by o.sort), '') as offices
       from profiles p
       left join offices o on o.head_user_id = p.user_id
       where p.porch_id = my_porch($1)
       group by p.user_id, p.display_name, p.image_url
       order by lower(p.display_name) asc`,
      [context.userId],
    );
    return {
      people: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        imageUrl: row.image_url,
        offices: row.offices ?? "",
      })),
    };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: typeof raw.userId === "string" ? clip(raw.userId, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, error: "Choose a person." };
    if (data.userId === context.userId) return { ok: false as const, error: "You stay on the porch." };
    const sql = await getSql();
    await ensureRoll(sql);
    await touchProfile(sql, context.userId, data.seed);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "roll-remove", "Tried to remove someone from the roll.");
      return { ok: false as const, error: "Only an admin can remove someone." };
    }
    const found = await sql.query<{ email: string | null; is_founder: boolean }>(
      "select email, is_porch_admin(user_id) as is_founder from profiles where user_id = $1",
      [data.userId],
    );
    const person = found[0];
    if (!person) return { ok: false as const, error: "That person is not on the porch." };
    if (boolish(person.is_founder)) return { ok: false as const, error: "The admin stays." };
    await sql`
      insert into removed_members (user_id, email)
      values (${data.userId}, ${person.email})
      on conflict (user_id) do update set email = excluded.email
    `;
    await sql`delete from "session" where "userId" = ${data.userId}`;
    await sql`delete from profiles where user_id = ${data.userId}`;
    return { ok: true as const };
  });
