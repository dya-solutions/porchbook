import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import { notifyOfficeHead } from "@/lib/porch/push.server";
import type { Seed } from "@/lib/porch/model";

export const HOO_DESKS = [
  { key: "admin", label: "Admin's Report", office: "administrator" },
  { key: "hof", label: "HOF's Report", office: "hof" },
  { key: "comm", label: "Comm's Report", office: "communications" },
  { key: "mission", label: "Mission's Report", office: "missions" },
  { key: "centre", label: "CentCord's Report", office: "centre" },
  { key: "family", label: "Family Dep's Report", office: "" },
  // Pastoral Support reports straight to the Pastor (not the H.O.O).
  { key: "pastoral", label: "Pastoral Support's Report", office: "pastoral" },
  { key: "pastor", label: "My Report to Pr.", office: "hoo" },
] as const;

export const HOO_FOLDERS = [
  { key: "red", label: "Need Urgency" },
  { key: "approval", label: "Pending your Approval" },
  { key: "attention", label: "What Needs attention" },
  { key: "status", label: "Departments' status" },
  { key: "working", label: "What's Working well" },
] as const;

export type HooDesk = (typeof HOO_DESKS)[number]["key"];
export type HooFolder = (typeof HOO_FOLDERS)[number]["key"];

export type HooNote = {
  id: number;
  body: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
  decision: "" | "yes" | "notyet";
  reason: string;
};

const DESKS = new Set<string>(HOO_DESKS.map((item) => item.key));
const FOLDERS = new Set<string>(HOO_FOLDERS.map((item) => item.key));

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

function deskOf(value: unknown): HooDesk | null {
  return typeof value === "string" && DESKS.has(value) ? (value as HooDesk) : null;
}

function folderOf(value: unknown): HooFolder | null {
  return typeof value === "string" && FOLDERS.has(value) ? (value as HooFolder) : null;
}

async function founderFlag(sql: Sql, userId: string): Promise<boolean> {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

async function officeHead(sql: Sql, key: string): Promise<string | null> {
  const rows = await sql.query<{ head_user_id: string | null }>("select head_user_id from offices where key = $1", [key]);
  return rows[0]?.head_user_id ?? null;
}

async function writerId(sql: Sql, desk: HooDesk): Promise<string | null> {
  if (desk === "family") {
    const rows = await sql.query<{ user_id: string }>("select user_id from hoo_writers where desk = 'family'");
    return rows[0]?.user_id ?? null;
  }
  const office = HOO_DESKS.find((item) => item.key === desk)?.office;
  if (!office) return null;
  return officeHead(sql, office);
}

async function readerId(sql: Sql, desk: HooDesk): Promise<string | null> {
  return officeHead(sql, desk === "pastor" || desk === "pastoral" ? "pastor" : "hoo");
}

function role(userId: string, writer: string | null, reader: string | null, founder: boolean) {
  return {
    isWriter: writer === userId,
    isReader: reader === userId || founder,
    isFounder: founder,
  };
}

export const loadHooBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const founder = await founderFlag(sql, context.userId);
    const visible: HooDesk[] = [];
    for (const desk of HOO_DESKS) {
      const access = role(context.userId, await writerId(sql, desk.key), await readerId(sql, desk.key), founder);
      if (access.isWriter || access.isReader) visible.push(desk.key);
    }
    const family = await sql.query<{ user_id: string; display_name: string }>(
      `select w.user_id, p.display_name
       from hoo_writers w
       join profiles p on p.user_id = w.user_id
       where w.desk = 'family'`,
    );
    const people = founder
      ? await sql.query<{ user_id: string; display_name: string }>(
          "select user_id, display_name from profiles order by lower(display_name)",
        )
      : [];
    return {
      desks: visible,
      isFounder: founder,
      familyWriterId: family[0]?.user_id ?? "",
      familyWriterName: family[0]?.display_name ?? "",
      people: people.map((person) => ({ userId: person.user_id, displayName: person.display_name })),
    };
  });

export const setFamilyWriter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: typeof raw.userId === "string" ? raw.userId : "", seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "hoo-family", "Tried to choose the Family writer.");
      return { ok: false as const, error: "Only the founder can choose the Family writer." };
    }
    if (!data.userId) return { ok: false as const, error: "Choose a person." };
    await sql`
      insert into hoo_writers (desk, user_id) values ('family', ${data.userId})
      on conflict (desk) do update set user_id = excluded.user_id
    `;
    return { ok: true as const };
  });

export const loadHooFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { desk: deskOf(raw.desk), folder: folderOf(raw.folder), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.desk || !data.folder) return { ok: false as const, error: "That folder is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const founder = await founderFlag(sql, context.userId);
    const writer = await writerId(sql, data.desk);
    const reader = await readerId(sql, data.desk);
    const access = role(context.userId, writer, reader, founder);
    if (!access.isWriter && !access.isReader) {
      noteAttempt(context.userId, "hoo-read", "Tried to open a report that is not theirs.");
      return { ok: false as const, error: "That report is not yours." };
    }
    const rows = await sql.query<{
      id: number;
      body: string;
      created_at: string;
      author_name: string;
      author_id: string;
      decision: string | null;
      reason: string | null;
    }>(
      `select r.id, r.body, r.author_id, p.display_name as author_name,
              to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              d.decision, d.reason
       from hoo_reports r
       join profiles p on p.user_id = r.author_id
       left join hoo_decisions d on d.report_id = r.id
       where r.desk = $1 and r.folder = $2
       order by r.created_at desc`,
      [data.desk, data.folder],
    );
    const who = writer
      ? await sql.query<{ display_name: string }>("select display_name from profiles where user_id = $1", [writer])
      : [];
    await sql`
      create table if not exists hoo_pages (
        desk text not null,
        folder text not null,
        body text not null default '',
        updated_at timestamptz not null default now(),
        primary key (desk, folder)
      )
    `;
    const saved = await sql.query<{ body: string }>("select body from hoo_pages where desk = $1 and folder = $2", [data.desk, data.folder]);
    const earlier = rows
      .slice()
      .reverse()
      .map((row) => row.body)
      .filter(Boolean)
      .join("\n\n");
    return {
      ok: true as const,
      canWrite: access.isWriter,
      canDecide: access.isReader && reader === context.userId,
      writerName: who[0]?.display_name ?? "",
      pages: saved[0]?.body || earlier,
      notes: rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        authorName: row.author_name,
        mine: row.author_id === context.userId,
        decision: row.decision === "yes" || row.decision === "notyet" ? row.decision : "",
        reason: row.reason ?? "",
      })) satisfies HooNote[],
    };
  });

export const saveHooNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      desk: deskOf(raw.desk),
      folder: folderOf(raw.folder),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.desk || !data.folder || !data.body) return { ok: false as const, error: "Write the note first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const writer = await writerId(sql, data.desk);
    if (writer !== context.userId) {
      noteAttempt(context.userId, "hoo-write", "Tried to write a report for another office.");
      return { ok: false as const, error: "Only that office can write this report." };
    }
    await sql`
      insert into hoo_reports (desk, folder, author_id, body)
      values (${data.desk}, ${data.folder}, ${context.userId}, ${data.body})
    `;
    if (data.folder === "red") {
      const reader = await readerId(sql, data.desk);
      const label = HOO_DESKS.find((item) => item.key === data.desk)?.label ?? "Report";
      if (reader) await notifyOfficeHead(sql, reader, context.userId, `Need Urgency · ${label}`, "/offices/hoo");
    }
    return { ok: true as const };
  });

export const saveHooPages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      desk: deskOf(raw.desk),
      folder: folderOf(raw.folder),
      body: typeof raw.body === "string" ? clip(raw.body, 5200) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.desk || !data.folder) return { ok: false as const, error: "That folder is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const writer = await writerId(sql, data.desk);
    if (writer !== context.userId) {
      noteAttempt(context.userId, "hoo-write", "Tried to write a report for another office.");
      return { ok: false as const, error: "Only that office can write this report." };
    }
    await sql`
      create table if not exists hoo_pages (
        desk text not null,
        folder text not null,
        body text not null default '',
        updated_at timestamptz not null default now(),
        primary key (desk, folder)
      )
    `;
    await sql`
      insert into hoo_pages (desk, folder, body, updated_at)
      values (${data.desk}, ${data.folder}, ${data.body}, now())
      on conflict (desk, folder) do update set body = ${data.body}, updated_at = now()
    `;
    if (data.folder === "red") {
      const reader = await readerId(sql, data.desk);
      const label = HOO_DESKS.find((item) => item.key === data.desk)?.label ?? "Report";
      if (reader) await notifyOfficeHead(sql, reader, context.userId, `Need Urgency · ${label}`, "/offices/hoo");
    }
    return { ok: true as const };
  });

export const decideHooNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const decision = raw.decision === "yes" || raw.decision === "notyet" ? raw.decision : "";
    return {
      reportId: typeof raw.reportId === "number" ? raw.reportId : Number(raw.reportId),
      decision,
      reason: typeof raw.reason === "string" ? clip(raw.reason, 500) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.reportId) || (data.decision !== "yes" && data.decision !== "notyet")) {
      return { ok: false as const, error: "That note is not here." };
    }
    if (data.decision === "notyet" && !data.reason) return { ok: false as const, error: "Say why not yet." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const rows = await sql.query<{ desk: string; author_id: string }>(
      "select desk, author_id from hoo_reports where id = $1",
      [data.reportId],
    );
    const report = rows[0];
    if (!report || !deskOf(report.desk)) return { ok: false as const, error: "That note is not here." };
    const desk = deskOf(report.desk)!;
    const reader = await readerId(sql, desk);
    if (reader !== context.userId || report.author_id === context.userId) {
      noteAttempt(context.userId, "hoo-decide", "Tried to approve a report they do not read.");
      return { ok: false as const, error: "Only the reader of this report can answer it." };
    }
    const reason = data.decision === "yes" ? "" : data.reason;
    await sql`
      insert into hoo_decisions (report_id, decision, reason, decider_id)
      values (${data.reportId}, ${data.decision}, ${reason}, ${context.userId})
      on conflict (report_id) do update
      set decision = excluded.decision, reason = excluded.reason, decider_id = excluded.decider_id, created_at = now()
    `;
    return { ok: true as const };
  });

