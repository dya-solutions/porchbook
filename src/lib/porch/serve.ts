import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

export const SERVE_DEPARTMENTS = [
  "Administration",
  "Family",
  "Communications",
  "Missions and outreach",
  "Centre coordination",
  "Wherever I am needed",
] as const;

export const SERVE_SPAN = ["I am new", "Under a year", "1 to 3 years", "More than 3 years"] as const;

export type ServeForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  gender: string;
  bornOn: string;
  city: string;
  discipleship: string;
  howLong: string;
  department: string;
  servesElsewhere: string;
  elsewhere: string;
  profession: string;
  skills: string;
  consent: string;
};

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "";
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const emailRaw = clip(raw.email, 200);
  return {
    displayName: clip(raw.displayName, 60),
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("http") ? raw.imageUrl.slice(0, 500) : null,
  };
}

function parseForm(input: unknown): ServeForm {
  const raw = asRecord(asRecord(input).form);
  return {
    firstName: clip(raw.firstName, 40),
    lastName: clip(raw.lastName, 40),
    phone: clip(raw.phone, 20),
    email: clip(raw.email, 120),
    gender: clip(raw.gender, 20),
    bornOn: clip(raw.bornOn, 12),
    city: clip(raw.city, 80),
    discipleship: clip(raw.discipleship, 20),
    howLong: clip(raw.howLong, 40),
    department: clip(raw.department, 80),
    servesElsewhere: clip(raw.servesElsewhere, 8),
    elsewhere: clip(raw.elsewhere, 80),
    profession: clip(raw.profession, 80),
    skills: clip(raw.skills, 240),
    consent: clip(raw.consent, 8),
  };
}

async function ensureServe(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists serve_forms (
      user_id text primary key,
      first_name text not null,
      last_name text not null,
      phone text not null,
      email text not null,
      gender text not null,
      born_on text not null,
      city text not null,
      discipleship text not null,
      how_long text not null,
      department text not null,
      serves_elsewhere text not null,
      elsewhere text not null default '',
      profession text not null default '',
      skills text not null default '',
      consent text not null,
      updated_at timestamptz not null default now()
    )
  `;
  // N2: a Serve form belongs to the church it was filled in for. Forms filled in before take the
  // person's church once; a form follows nobody to another church (leaving a church deletes it).
  await sql`alter table serve_forms add column if not exists porch_id integer references porches (id) on delete cascade`;
  await sql`
    with done as (insert into porch_steps (step) values ('serve-forms-per-church-v1') on conflict (step) do nothing returning step)
    update serve_forms s set porch_id = church_of(s.user_id) where s.porch_id is null and exists (select 1 from done)
  `;
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

const empty: ServeForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  gender: "",
  bornOn: "",
  city: "",
  discipleship: "",
  howLong: "",
  department: "",
  servesElsewhere: "",
  elsewhere: "",
  profession: "",
  skills: "",
  consent: "",
};

export const loadServe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureServe(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{
      first_name: string;
      last_name: string;
      phone: string;
      email: string;
      gender: string;
      born_on: string;
      city: string;
      discipleship: string;
      how_long: string;
      department: string;
      serves_elsewhere: string;
      elsewhere: string;
      profession: string;
      skills: string;
      consent: string;
    }>(
      `select first_name, last_name, phone, email, gender, born_on, city, discipleship, how_long,
              department, serves_elsewhere, elsewhere, profession, skills, consent
       from serve_forms where user_id = $1 and porch_id = my_porch($1)`,
      [context.userId],
    );
    const row = rows[0];
    const form: ServeForm = row
      ? {
          firstName: row.first_name,
          lastName: row.last_name,
          phone: row.phone,
          email: row.email,
          gender: row.gender,
          bornOn: row.born_on,
          city: row.city,
          discipleship: row.discipleship,
          howLong: row.how_long,
          department: row.department,
          servesElsewhere: row.serves_elsewhere,
          elsewhere: row.elsewhere,
          profession: row.profession,
          skills: row.skills,
          consent: row.consent,
        }
      : empty;
    return { founder, sent: Boolean(row), form };
  });

function valid(form: ServeForm): string {
  if (!form.firstName || !form.lastName) return "Put your first and last name.";
  if (form.phone.replace(/\D/g, "").length < 9) return "Put a full phone number.";
  if (!form.email.includes("@")) return "Put an email address.";
  if (form.gender !== "Female" && form.gender !== "Male") return "Choose female or male.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.bornOn)) return "Put your date of birth.";
  if (!form.city) return "Put the city where you live.";
  if (form.discipleship !== "Yes" && form.discipleship !== "Not yet") return "Say if you have attended discipleship.";
  if (!SERVE_SPAN.includes(form.howLong as (typeof SERVE_SPAN)[number])) return "Say how long you have been in the ministry.";
  if (!form.department) return "Choose a department.";
  if (form.servesElsewhere !== "Yes" && form.servesElsewhere !== "No") return "Say if you already serve in a department.";
  if (form.servesElsewhere === "Yes" && !form.elsewhere) return "Name the department you already serve in.";
  if (form.consent !== "Yes") return "Consent is needed before this can be sent.";
  return "";
}

export const saveServe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ seed: parseSeed(input), form: parseForm(input) }))
  .handler(async ({ context, data }) => {
    const problem = valid(data.form);
    if (problem) return { ok: false as const, error: problem };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureServe(sql);
    const church = await sql.query<{ porch_id: number | null }>("select my_porch($1) as porch_id", [context.userId]);
    if (!church[0]?.porch_id) return { ok: false as const, error: "Join your church first: the Serve form goes to your church." };
    const form = data.form;
    await sql`
      insert into serve_forms (
        user_id, porch_id, first_name, last_name, phone, email, gender, born_on, city, discipleship, how_long,
        department, serves_elsewhere, elsewhere, profession, skills, consent, updated_at
      )
      values (
        ${context.userId}, ${church[0].porch_id}, ${form.firstName}, ${form.lastName}, ${form.phone}, ${form.email}, ${form.gender},
        ${form.bornOn}, ${form.city}, ${form.discipleship}, ${form.howLong}, ${form.department},
        ${form.servesElsewhere}, ${form.elsewhere}, ${form.profession}, ${form.skills}, ${form.consent}, now()
      )
      on conflict (user_id) do update set
        porch_id = excluded.porch_id,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        email = excluded.email,
        gender = excluded.gender,
        born_on = excluded.born_on,
        city = excluded.city,
        discipleship = excluded.discipleship,
        how_long = excluded.how_long,
        department = excluded.department,
        serves_elsewhere = excluded.serves_elsewhere,
        elsewhere = excluded.elsewhere,
        profession = excluded.profession,
        skills = excluded.skills,
        consent = excluded.consent,
        updated_at = now()
    `;
    return { ok: true as const };
  });

function latin(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfText(value: string): string {
  return latin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function finishPdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const content of pages) {
    const contentId = next;
    next += 1;
    const pageId = next;
    next += 1;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export const downloadServe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureServe(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "serve-pdf", "Tried to download volunteers without being an admin.");
      return { ok: false as const, error: "Only an admin can download the volunteers." };
    }
    const rows = await sql.query<{
      display_name: string;
      first_name: string;
      last_name: string;
      phone: string;
      email: string;
      gender: string;
      born_on: string;
      city: string;
      discipleship: string;
      how_long: string;
      department: string;
      serves_elsewhere: string;
      elsewhere: string;
      profession: string;
      skills: string;
    }>(
      `select p.display_name, s.first_name, s.last_name, s.phone, s.email, s.gender, s.born_on, s.city,
              s.discipleship, s.how_long, s.department, s.serves_elsewhere, s.elsewhere, s.profession, s.skills
       from serve_forms s
       join profiles p on p.user_id = s.user_id
       where s.porch_id = my_porch($1)
       order by lower(s.last_name), lower(s.first_name)`,
      [context.userId],
    );
    const pages: string[] = [];
    if (rows.length === 0) {
      pages.push("BT /F1 18 Tf 48 760 Td (Volunteers) Tj ET\nBT /F1 12 Tf 48 730 Td (Phaneroo Ministries Mbarara) Tj ET\nBT /F1 12 Tf 48 700 Td (No one has asked to serve yet.) Tj ET");
    }
    for (const row of rows) {
      const lines = [
        [18, `${row.first_name} ${row.last_name}`],
        [12, "Phaneroo Ministries Mbarara"],
        [11, `Phone  ${row.phone}`],
        [11, `Email  ${row.email}`],
        [11, `Gender  ${row.gender}`],
        [11, `Born  ${row.born_on}`],
        [11, `Lives in  ${row.city}`],
        [11, `Discipleship  ${row.discipleship}`],
        [11, `In the ministry  ${row.how_long}`],
        [11, `Wants to serve in  ${row.department}`],
        [11, `Already serves  ${row.serves_elsewhere}${row.elsewhere ? ` — ${row.elsewhere}` : ""}`],
        [11, `Profession  ${row.profession || "-"}`],
        [11, `Skills  ${row.skills || "-"}`],
        [10, `Sent from  ${row.display_name || "a member"}`],
      ] as const;
      let y = 780;
      const ops: string[] = [];
      for (const [size, text] of lines) {
        ops.push(`BT /F1 ${size} Tf 48 ${y} Td (${pdfText(text)}) Tj ET`);
        y -= size + 10;
      }
      pages.push(ops.join("\n"));
    }
    let binary = "";
    for (const byte of finishPdf(pages)) binary += String.fromCharCode(byte);
    return { ok: true as const, pdf: btoa(binary), filename: "volunteers.pdf" };
  });
