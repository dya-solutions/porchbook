import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const BATCH = 15;

type Contact = { name: string; phone: string };

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
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

function stamp(date: Date): string {
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Kampala",
  });
}

export function smsParts(text: string): number {
  const body = text.trim();
  if (!body) return 0;
  const plain = /^[\n\r\x20-\x7e]*$/.test(body);
  if (plain) return body.length <= 160 ? 1 : Math.ceil(body.length / 153);
  return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
}

async function ensureTables(sql: Sql) {
  await sql`
    create table if not exists mission_sends (
      id serial primary key,
      sender_id text not null references profiles (user_id) on delete cascade,
      body text not null,
      parts integer not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists mission_send_to (
      send_id integer not null references mission_sends (id) on delete cascade,
      person_name text not null default '',
      phone text not null
    )
  `;
  await sql`
    create table if not exists mission_reports (
      user_id text primary key references profiles (user_id) on delete cascade,
      body text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
}

async function missionsHead(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql.query<{ head_user_id: string | null }>(
    "select head_user_id from offices where key = 'missions'",
    [],
  );
  return rows[0]?.head_user_id === userId;
}

async function contacts(sql: Sql): Promise<Contact[]> {
  const rows = await sql.query<{ person_name: string; phone: string }>(
    "select person_name, phone from my_twenty where phone <> ''",
    [],
  );
  const byPhone = new Map<string, Contact>();
  for (const row of rows) {
    const digits = row.phone.replace(/\D/g, "");
    if (digits.length < 11) continue;
    const key = digits.slice(-9);
    const current = byPhone.get(key);
    if (!current) byPhone.set(key, { name: row.person_name.trim(), phone: `+${digits}` });
    else if (!current.name && row.person_name.trim()) current.name = row.person_name.trim();
  }
  return [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name) || a.phone.localeCompare(b.phone));
}

function batches(list: Contact[]): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < list.length; index += BATCH) {
    groups.push(list.slice(index, index + BATCH).map((item) => item.phone));
  }
  return groups;
}

export const loadMissionSms = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureTables(sql);
    if (!(await missionsHead(sql, context.userId))) {
      return { ok: true as const, isHead: false, count: 0, sends: [], report: "" };
    }
    const list = await contacts(sql);
    const sends = await sql.query<{ id: number; created_at: string; parts: number; n: number }>(
      `select s.id, to_char(s.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              s.parts, count(t.phone)::int as n
       from mission_sends s
       left join mission_send_to t on t.send_id = s.id
       where s.sender_id = $1
       group by s.id
       order by s.created_at desc
       limit 8`,
      [context.userId],
    );
    const saved = await sql.query<{ body: string }>("select body from mission_reports where user_id = $1", [
      context.userId,
    ]);
    return {
      ok: true as const,
      isHead: true,
      count: list.length,
      report: saved[0]?.body ?? "",
      sends: sends.map((row) => ({
        id: Number(row.id),
        when: stamp(new Date(row.created_at)),
        parts: Number(row.parts),
        count: Number(row.n),
      })),
    };
  });

export const prepareMissionSms = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { body: typeof raw.body === "string" ? clip(raw.body, 640) : "", seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.body) return { ok: false as const, error: "Write the message first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureTables(sql);
    if (!(await missionsHead(sql, context.userId))) {
      noteAttempt(context.userId, "mission-sms", "Tried to message every My 20 contact.");
      return { ok: false as const, error: "Only the Head of Missions can send this." };
    }
    const list = await contacts(sql);
    if (!list.length) return { ok: false as const, error: "No finished My 20 numbers yet." };
    const parts = smsParts(data.body);
    const inserted = await sql<{ id: number }>`
      insert into mission_sends (sender_id, body, parts)
      values (${context.userId}, ${data.body}, ${parts})
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) return { ok: false as const, error: "Couldn't prepare that message." };
    for (const contact of list) {
      await sql`
        insert into mission_send_to (send_id, person_name, phone)
        values (${id}, ${contact.name}, ${contact.phone})
      `;
    }
    return { ok: true as const, id: Number(id), count: list.length, parts, batches: batches(list) };
  });

function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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

export const missionSmsPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      sendId: typeof raw.sendId === "number" ? raw.sendId : Number(raw.sendId),
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.sendId)) return { ok: false as const, error: "That record is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureTables(sql);
    if (!(await missionsHead(sql, context.userId))) {
      noteAttempt(context.userId, "mission-pdf", "Tried to download a Missions send.");
      return { ok: false as const, error: "Only the Head of Missions can download this." };
    }
    const sends = await sql.query<{ body: string; parts: number; created_at: string; display_name: string }>(
      `select s.body, s.parts, p.display_name,
              to_char(s.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from mission_sends s
       join profiles p on p.user_id = s.sender_id
       where s.id = $1 and s.sender_id = $2`,
      [data.sendId, context.userId],
    );
    const send = sends[0];
    if (!send) return { ok: false as const, error: "That record is not here." };
    const people = await sql.query<{ person_name: string; phone: string }>(
      "select person_name, phone from mission_send_to where send_id = $1 order by person_name, phone",
      [data.sendId],
    );
    const left = 48;
    const pages: string[] = [];
    let ops: string[] = [];
    let y = 790;
    const flush = () => {
      pages.push(ops.join("\n"));
      ops = [];
      y = 790;
    };
    const write = (text: string, size: number, leading: number) => {
      if (y - leading < 56) flush();
      ops.push(`BT /F1 ${size} Tf ${left} ${y - size} Td (${pdfText(text)}) Tj ET`);
      y -= leading;
    };
    write("Missions message", 20, 28);
    write(send.display_name || "Head of Missions", 13, 20);
    write(stamp(new Date(send.created_at)), 11, 16);
    write(`${people.length} numbers. ${send.parts} SMS part${send.parts === 1 ? "" : "s"} each.`, 11, 16);
    write("Charged to the Head of Missions, from his phone.", 11, 16);
    write("Delivery is not confirmed.", 11, 18);
    y -= 6;
    write("Message", 12, 18);
    for (const line of send.body.split(/\n/)) write(line || " ", 11, 15);
    y -= 8;
    write("Numbers", 12, 18);
    people.forEach((person, index) => {
      write(`${index + 1}. ${person.person_name || "—"}   ${person.phone}`, 10, 14);
    });
    if (ops.length || pages.length === 0) flush();
    const bytes = finishPdf(pages);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { ok: true as const, pdf: btoa(binary), filename: "missions-message.pdf" };
  });

function groupReports(text: string): { heading: string; lines: string[] }[] {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const groups: { heading: string; lines: string[] }[] = [];
  const index = new Map<string, number>();
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const heading = lines[0].slice(0, 80);
    const key = heading.toLowerCase();
    let at = index.get(key);
    if (at == null) {
      at = groups.length;
      index.set(key, at);
      groups.push({ heading, lines: [] });
    }
    const body = lines.slice(1);
    if (body.length) groups[at].lines.push(...body);
  }
  return groups;
}

function wrapPdf(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const missionReportPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      body: typeof raw.body === "string" ? raw.body.replace(/\u0000/g, "").slice(0, 20000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureTables(sql);
    if (!(await missionsHead(sql, context.userId))) {
      noteAttempt(context.userId, "mission-report", "Tried to make a Missions report.");
      return { ok: false as const, error: "Only the Head of Missions can make this report." };
    }
    const body = data.body.trim();
    await sql`
      insert into mission_reports (user_id, body, updated_at)
      values (${context.userId}, ${body}, now())
      on conflict (user_id) do update set body = excluded.body, updated_at = now()
    `;
    const groups = groupReports(body);
    const left = 48;
    const pages: string[] = [];
    let ops: string[] = [];
    let y = 790;
    const flush = () => {
      if (ops.length) pages.push(ops.join("\n"));
      ops = [];
      y = 790;
    };
    const write = (text: string, size: number, leading: number) => {
      if (y - leading < 56) flush();
      ops.push(`BT /F1 ${size} Tf ${left} ${y - size} Td (${pdfText(text)}) Tj ET`);
      y -= leading;
    };
    write("REPORTS OF M&O", 18, 26);
    write("Head of Missions and outreach", 12, 18);
    write(stamp(new Date()), 11, 20);
    if (!groups.length) {
      write("No reports yet.", 12, 18);
    }
    for (const group of groups) {
      y -= 6;
      write(group.heading, 14, 20);
      const lines = group.lines.length ? group.lines : ["—"];
      for (const line of lines) {
        for (const piece of wrapPdf(line, 85)) write(piece, 11, 15);
      }
    }
    flush();
    if (!pages.length) pages.push("");
    const bytes = finishPdf(pages);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { ok: true as const, pdf: btoa(binary), filename: "reports-of-mo.pdf" };
  });

