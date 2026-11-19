import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const SLOTS = 20;

export type TwentyRow = { name: string; phone: string };

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

function parseRows(input: unknown): TwentyRow[] {
  const raw = asRecord(input);
  const list = Array.isArray(raw.rows) ? raw.rows : [];
  return Array.from({ length: SLOTS }, (_, index) => {
    const row = asRecord(list[index]);
    return {
      name: typeof row.name === "string" ? clip(row.name, 80) : "",
      phone: typeof row.phone === "string" ? clip(row.phone, 32) : "",
    };
  });
}

function blankRows(): TwentyRow[] {
  return Array.from({ length: SLOTS }, () => ({ name: "", phone: "" }));
}

export const loadMyTwenty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    const saved = await sql.query<{ n: string }>(
      "select count(*)::text as n from my_twenty where user_id = $1 and (person_name <> '' or phone <> '')",
      [context.userId],
    );
    return { rows: blankRows(), sent: Number(saved[0]?.n ?? 0), isFounder: boolish(me[0]?.is_founder) };
  });

export const saveMyTwenty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(input),
      rows: parseRows(input),
      centre: typeof raw.centre === "string" ? clip(raw.centre, 80) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await sql`alter table my_twenty add column if not exists centre text not null default ''`;
    const next = await sql.query<{ batch: string }>(
      "select (coalesce(max(batch), 0) + 1)::text as batch from my_twenty where user_id = $1",
      [context.userId],
    );
    const batch = Number(next[0]?.batch ?? 1);
    for (let index = 0; index < data.rows.length; index += 1) {
      const row = data.rows[index];
      if (!row.name && !row.phone) continue;
      await sql`
        insert into my_twenty (user_id, batch, slot, person_name, phone, centre)
        values (${context.userId}, ${batch}, ${index + 1}, ${row.name}, ${row.phone}, ${data.centre})
      `;
    }
    const saved = await sql.query<{ n: string }>(
      "select count(*)::text as n from my_twenty where user_id = $1 and (person_name <> '' or phone <> '')",
      [context.userId],
    );
    return { ok: true as const, sent: Number(saved[0]?.n ?? 0) };
  });

type Group = {
  id: string;
  name: string;
  centre: string;
  when: string;
  rows: { slot: number; name: string; phone: string }[];
};

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

function buildPdf(groups: Group[], taken: string, heading = "Every list sent"): Uint8Array {
  const left = 48;
  const top = 790;
  const bottom = 56;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = top;

  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = top;
  };
  const need = (height: number) => {
    if (y - height < bottom) flush();
  };
  const write = (text: string, size: number, x: number, leading: number) => {
    need(leading);
    ops.push(`BT /F1 ${size} Tf ${x} ${y - size} Td (${pdfText(text)}) Tj ET`);
    y -= leading;
  };

  const cover = () => {
    write("My 20", 22, left, 28);
    write("31st Night of Prayer", 13, left, 20);
    write(heading, 12, left, 18);
    write(taken, 10, left, 16);
    y -= 8;
  };

  cover();
  if (groups.length === 0) {
    flush();
    return finishPdf(pages);
  }
  write(`${groups.length} ${groups.length === 1 ? "person" : "people"}`, 11, left, 16);
  y -= 6;

  const rowLead = 20;
  const blockHeight = (count: number) => 22 + 16 + 14 + 2 + 16 + count * rowLead + 10;

  for (const group of groups) {
    const height = blockHeight(Math.max(group.rows.length, 1));
    if (y - height < bottom && y < top - 30) flush();
    write(group.name, 16, left, 22);
    write(group.centre || "Manifest centre not named", 12, left, 16);
    write(`Sent ${group.when}`, 11, left, 14);
    y -= 2;
    ops.push(`BT /F1 12 Tf ${left} ${y - 12} Td (No.) Tj ET`);
    ops.push(`BT /F1 12 Tf ${left + 32} ${y - 12} Td (Name) Tj ET`);
    ops.push(`BT /F1 12 Tf 360 ${y - 12} Td (Number) Tj ET`);
    y -= 16;
    if (group.rows.length === 0) {
      write("No names yet.", 13, left + 32, rowLead);
    }
    for (const row of group.rows) {
      if (y - rowLead < bottom) {
        flush();
        write(`${group.name} continued`, 13, left, 18);
      }
      ops.push(`BT /F1 13 Tf ${left} ${y - 13} Td (${pdfText(String(row.slot))}) Tj ET`);
      ops.push(`BT /F1 13 Tf ${left + 32} ${y - 13} Td (${pdfText(row.name || "-")}) Tj ET`);
      ops.push(`BT /F1 13 Tf 360 ${y - 13} Td (${pdfText(row.phone)}) Tj ET`);
      y -= rowLead;
    }
    y -= 10;
  }

  if (ops.length) flush();
  if (pages.length === 0) pages.push("");
  return finishPdf(pages);
}

function finishPdf(pages: string[]): Uint8Array {
  const pageW = 595;
  const pageH = 842;
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const content of pages) {
    const contentId = next;
    next += 1;
    const pageId = next;
    next += 1;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  const size = objects.length;
  pdf += `xref\n0 ${size}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < size; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

type SharedContact = { label: string; phone: string; names: string[]; people: string[] };

function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : "";
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sharedContacts(groups: Group[]): SharedContact[] {
  const items = groups.flatMap((group) =>
    group.rows.map((row) => ({
      name: row.name.trim(),
      phone: row.phone.trim(),
      phoneKey: phoneKey(row.phone),
      nameKey: nameKey(row.name),
      by: group.name,
      byId: group.id,
    })),
  );
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const join = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].byId === items[j].byId) continue;
      const samePhone = items[i].phoneKey !== "" && items[i].phoneKey === items[j].phoneKey;
      const sameName = items[i].nameKey.length >= 3 && items[i].nameKey === items[j].nameKey;
      const bothPhones = items[i].phoneKey !== "" && items[j].phoneKey !== "";
      if (samePhone || (sameName && !bothPhones)) join(i, j);
    }
  }
  const clusters = new Map<number, typeof items>();
  items.forEach((item, index) => {
    const root = find(index);
    const list = clusters.get(root) ?? [];
    list.push(item);
    clusters.set(root, list);
  });
  const shared: SharedContact[] = [];
  for (const list of clusters.values()) {
    const people = [...new Set(list.map((item) => item.by))];
    if (new Set(list.map((item) => item.byId)).size < 2) continue;
    const names = [...new Set(list.map((item) => item.name).filter(Boolean))];
    const phones = [...new Set(list.map((item) => item.phone).filter(Boolean))];
    shared.push({ label: names[0] || phones[0] || "Contact", phone: phones[0] ?? "", names, people });
  }
  shared.sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));
  return shared;
}

function buildSamePdf(shared: SharedContact[], taken: string): Uint8Array {
  const left = 48;
  const top = 790;
  const bottom = 56;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = top;
  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = top;
  };
  const need = (height: number) => {
    if (y - height < bottom) flush();
  };
  const write = (text: string, size: number, leading: number) => {
    need(leading);
    ops.push(`BT /F1 ${size} Tf ${left} ${y - size} Td (${pdfText(text)}) Tj ET`);
    y -= leading;
  };

  write("My 20", 22, 28);
  write("31st Night of Prayer", 13, 20);
  write("Same contacts", 13, 18);
  write(taken, 10, 18);
  y -= 8;
  if (shared.length === 0) {
    flush();
    return finishPdf(pages);
  }
  if (shared.length >= 6) {
    write(`${shared.length} contacts were entered by two or more people`, 12, 20);
    for (const contact of shared) write(`${contact.label}  —  ${contact.people.length} people`, 11, 16);
    flush();
  }
  shared.forEach((contact, index) => {
    if (shared.length >= 6 || (index > 0 && y < 160)) {
      if (ops.length) flush();
    } else if (index > 0) y -= 12;
    write(contact.label, 16, 22);
    if (contact.phone) write(contact.phone, 12, 18);
    if (contact.names.length > 1) write(`Also written as ${contact.names.slice(1).join(", ")}`, 11, 16);
    write(`Entered by ${contact.people.join(", ")}`, 11, 16);
  });
  if (ops.length || pages.length === 0) flush();
  return finishPdf(pages);
}

function pdfBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

export const downloadMyTwenty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    if (!boolish(me[0]?.is_founder)) {
      noteAttempt(context.userId, "my20-pdf", "Tried to download My 20 without being the founder.");
      return { ok: false as const, error: "Only the founder can download My 20." };
    }
    await sql`alter table my_twenty add column if not exists centre text not null default ''`;
    const saved = await sql.query<{
      user_id: string;
      display_name: string;
      slot: number;
      person_name: string;
      phone: string;
      centre: string;
      updated_at: string;
    }>(
      `select p.user_id, p.display_name, n.slot, n.person_name, n.phone, n.centre,
              to_char(n.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from my_twenty n
       join profiles p on p.user_id = n.user_id
       where n.porch_id = my_porch($1) and (n.person_name <> '' or n.phone <> '')
       order by lower(p.display_name), n.batch, n.slot`,
      [context.userId],
    );
    const groups: Group[] = [];
    for (const row of saved) {
      let group = groups.find((item) => item.id === row.user_id);
      if (!group) {
        group = {
          id: row.user_id,
          name: row.display_name || "Teammate",
          centre: row.centre || "",
          when: stamp(new Date(row.updated_at)),
          rows: [],
        };
        groups.push(group);
      }
      if (row.centre) group.centre = row.centre;
      group.rows.push({ slot: group.rows.length + 1, name: row.person_name, phone: row.phone });
    }
    const taken = `Taken ${stamp(new Date())}`;
    return {
      ok: true as const,
      pdf: pdfBase64(buildPdf(groups, taken)),
      filename: "my20.pdf",
      same: pdfBase64(buildSamePdf(sharedContacts(groups), taken)),
      sameName: "my20-same.pdf",
    };
  });

export const resetMyTwenty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    if (!boolish(me[0]?.is_founder)) {
      noteAttempt(context.userId, "my20-reset", "Tried to reset My 20 without being the founder.");
      return { ok: false as const, error: "Only the founder can reset My 20." };
    }
    await sql`alter table my_twenty add column if not exists centre text not null default ''`;
    const saved = await sql.query<{
      user_id: string;
      display_name: string;
      slot: number;
      person_name: string;
      phone: string;
      centre: string;
      updated_at: string;
    }>(
      `select p.user_id, p.display_name, n.slot, n.person_name, n.phone, n.centre,
              to_char(n.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from my_twenty n
       join profiles p on p.user_id = n.user_id
       where n.porch_id = my_porch($1) and (n.person_name <> '' or n.phone <> '')
       order by lower(p.display_name), n.batch, n.slot`,
      [context.userId],
    );
    const groups: Group[] = [];
    for (const row of saved) {
      let group = groups.find((item) => item.id === row.user_id);
      if (!group) {
        group = {
          id: row.user_id,
          name: row.display_name || "Teammate",
          centre: row.centre || "",
          when: stamp(new Date(row.updated_at)),
          rows: [],
        };
        groups.push(group);
      }
      if (row.centre) group.centre = row.centre;
      group.rows.push({ slot: group.rows.length + 1, name: row.person_name, phone: row.phone });
    }
    const taken = `Taken ${stamp(new Date())}`;
    const pdf = pdfBase64(buildPdf(groups, taken, "All before Delete"));
    if (!pdf) return { ok: false as const, error: "Couldn't make All before Delete. Nothing was deleted." };
    // Only this church's lists (never another church's).
    await sql`delete from my_twenty where porch_id = my_porch(${context.userId})`;
    return { ok: true as const, pdf, filename: "All before Delete.pdf" };
  });

export const downloadOwnTwenty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await sql`alter table my_twenty add column if not exists centre text not null default ''`;
    const me = await sql.query<{ display_name: string }>("select display_name from profiles where user_id = $1", [context.userId]);
    const saved = await sql.query<{
      person_name: string;
      phone: string;
      centre: string;
      updated_at: string;
    }>(
      `select n.person_name, n.phone, n.centre,
              to_char(n.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from my_twenty n
       where n.user_id = $1 and (n.person_name <> '' or n.phone <> '')
       order by n.batch, n.slot`,
      [context.userId],
    );
    const group: Group = {
      id: context.userId,
      name: me[0]?.display_name || "Teammate",
      centre: "",
      when: saved[0] ? stamp(new Date(saved[saved.length - 1].updated_at)) : stamp(new Date()),
      rows: [],
    };
    for (const row of saved) {
      if (row.centre) group.centre = row.centre;
      group.rows.push({ slot: group.rows.length + 1, name: row.person_name, phone: row.phone });
    }
    return {
      ok: true as const,
      pdf: pdfBase64(buildPdf([group], `Taken ${stamp(new Date())}`, "Your list")),
      filename: "my-list.pdf",
    };
  });
