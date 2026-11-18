import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";
import { rideNotice } from "@/lib/porch/transport-points";
import { canArrange, clock, currentEvent, dayLabel, driverSheets, ensureBoard, isClosed, myRide, type TransportEvent } from "@/lib/porch/transport-board";

const WAITING = "Your location will soon be considered for free transportation.";

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
    create table if not exists transport_locations (
      user_id text primary key references profiles (user_id) on delete cascade,
      place text not null default '',
      notice text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
  await sql`alter table transport_locations add column if not exists phone text not null default ''`;
  await sql`alter table transport_locations add column if not exists venue text not null default ''`;
  await sql`alter table transport_locations add column if not exists venue_note text not null default ''`;
  await sql`alter table transport_locations add column if not exists ride_back boolean not null default true`;
  await sql`
    create table if not exists transport_stages (
      id serial primary key,
      place text not null,
      stage text not null
    )
  `;
  await ensureBoard(sql);
}

function noticeFor(place: string, stages: { place: string; stage: string }[]): string {
  const known = rideNotice(place);
  if (known) return known;
  const key = place.toLowerCase();
  const hit = stages.find((stage) => stage.place.trim().toLowerCase() === key);
  return hit?.stage.trim() || WAITING;
}

async function locationReport(sql: Awaited<ReturnType<typeof getSql>>, event: TransportEvent) {
  const rows = await sql.query<{ place: string; display_name: string; phone: string; venue: string; venue_note: string; ride_back: unknown }>(
    `select t.place, p.display_name, t.phone, t.venue, t.venue_note, t.ride_back
     from transport_locations t
     join profiles p on p.user_id = t.user_id
     where trim(t.place) <> '' and t.event_id = $1
     order by p.display_name`,
    [event.id],
  );
  const groups = new Map<string, { label: string; people: { name: string; place: string; phone: string; rideBack: boolean }[] }>();
  for (const row of rows) {
    const label = venueLabel(row.venue, row.venue_note, event.name);
    const current = groups.get(label) ?? { label, people: [] };
    current.people.push({
      name: row.display_name || "Teammate",
      place: row.place.trim(),
      phone: row.phone || "",
      rideBack: boolish(row.ride_back),
    });
    groups.set(label, current);
  }
  return [...groups.values()]
    .map((group) => ({ label: group.label, count: group.people.length, people: group.people }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function stageNote(stage: string, rideBack: boolean) {
  return rideBack
    ? `Free transport. Find this stage: ${stage}. The same stage brings you back.`
    : `Free transport. Find this stage: ${stage}. You have your own way back.`;
}

async function tellInbox(sql: Awaited<ReturnType<typeof getSql>>, fromId: string, toId: string, body: string) {
  if (!fromId || !toId || fromId === toId || !body.trim()) return;
  const { ensureChat } = await import("@/lib/porch/chat");
  await ensureChat(sql);
  const rows = await sql.query<{ id: number }>(
    `insert into conversations (low_user_id, high_user_id)
     values (least($1, $2), greatest($1, $2))
     on conflict (low_user_id, high_user_id) do update set updated_at = now()
     returning id`,
    [fromId, toId],
  );
  const id = rows[0]?.id;
  if (id == null) return;
  await sql`insert into messages (conversation_id, author_id, body) values (${Number(id)}, ${fromId}, ${body})`;
  const { notifyPrivateNote } = await import("@/lib/porch/push.server");
  await notifyPrivateNote(sql, toId, fromId);
}

async function founderId(sql: Awaited<ReturnType<typeof getSql>>) {
  const rows = await sql.query<{ user_id: string; is_founder: unknown }>("select user_id, is_founder from profiles");
  return rows.find((row) => boolish(row.is_founder))?.user_id ?? "";
}

function venueLabel(code: string, note: string, eventName = "The event") {
  const named = note.trim().replace(/^manifest\s+/i, "");
  if (code === "pmi") return "Phaneroo Grounds - PMI";
  if (code === "pmm") return "Phaneroo Mbarara - PMM";
  if (code === "anniversary") return eventName;
  if (code === "manifest") return named ? `Manifest ${named}` : "Manifest";
  if (code === "other") return note.trim() ? `Other - ${note.trim()}` : "Other";
  return "No destination";
}

export const loadTransport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ready(sql);
    const who = await canArrange(sql, context.userId);
    const event = await currentEvent(sql);
    const saved = await sql.query<{ place: string; notice: string; phone: string; venue: string; venue_note: string; ride_back: unknown }>(
      "select place, notice, phone, venue, venue_note, ride_back from transport_locations where user_id = $1 and event_id = $2",
      [context.userId, event.id],
    );
    const founder = who.founder;
    const stageRows = await sql.query<{ id: number; place: string; stage: string }>("select id, place, stage from transport_stages order by id");
    const live = saved[0]?.place ? noticeFor(saved[0].place, stageRows) : "";
    const groups = who.arrange ? await locationReport(sql, event) : [];
    return {
      founder,
      arrange: who.arrange,
      event: { ...event, dateLabel: dayLabel(event.date), pickupLabel: clock(event.pickup), gatesLabel: clock(event.gates) },
      closed: isClosed(event),
      ride: await myRide(sql, context.userId, event.id),
      place: saved[0]?.place ?? "",
      notice: live && live !== WAITING ? live : saved[0] ? WAITING : "",
      stage: live && live !== WAITING ? live : "",
      stages: founder ? stageRows : [],
      groups,
      phone: saved[0]?.phone ?? "",
      venue: saved[0]?.venue ?? "",
      venueNote: saved[0]?.venue_note ?? "",
      rideBack: saved[0] ? boolish(saved[0].ride_back) : true,
    };
  });

export const saveTransport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(input),
      place: typeof raw.place === "string" ? clip(raw.place, 120) : "",
      phone: typeof raw.phone === "string" ? clip(raw.phone, 20) : "",
      venue: typeof raw.venue === "string" && ["pmi", "pmm", "manifest", "anniversary", "other"].includes(raw.venue) ? raw.venue : "",
      venueNote: typeof raw.venueNote === "string" ? clip(raw.venueNote, 80) : "",
      rideBack: raw.rideBack !== false,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.place) return { ok: false as const, error: "Type your location." };
    if (data.venue === "manifest" && !data.venueNote) return { ok: false as const, error: "Type which Manifest." };
    if (data.venue === "other" && !data.venueNote) return { ok: false as const, error: "Type the other venue." };
    if (data.phone && !/^\+\d{10,16}$/.test(data.phone)) return { ok: false as const, error: "A red number is not finished. It needs nine figures." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    const event = await currentEvent(sql);
    if (isClosed(event)) return { ok: false as const, error: `Registration for ${event.name} has closed. Call ${event.phone || "the Transport team"}.` };
    const stages = await sql.query<{ place: string; stage: string }>("select place, stage from transport_stages");
    const notice = noticeFor(data.place, stages);
    const note = data.venue === "other" || data.venue === "manifest" ? data.venueNote.replace(/^manifest\s+/i, "") : "";
    await sql`
      insert into transport_locations (user_id, place, phone, notice, venue, venue_note, ride_back, event_id, updated_at)
      values (${context.userId}, ${data.place}, ${data.phone}, ${notice}, ${data.venue}, ${note}, ${data.rideBack}, ${event.id}, now())
      on conflict (user_id) do update set place = ${data.place}, phone = ${data.phone}, notice = ${notice}, venue = ${data.venue}, venue_note = ${note}, ride_back = ${data.rideBack}, event_id = ${event.id}, updated_at = now()
    `;
    // The Transport team confirms each traveller's bus; nothing is sent from here.
    return { ok: true as const, notice, stage: "" };
  });

export const saveTransportStage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(input),
      place: typeof raw.place === "string" ? clip(raw.place, 120) : "",
      stage: typeof raw.stage === "string" ? clip(raw.stage, 200) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const me = await sql.query<{ is_founder: boolean }>("select is_founder from profiles where user_id = $1", [context.userId]);
    if (!boolish(me[0]?.is_founder)) return { ok: false as const, error: "Only the founder can name a stage." };
    if (!data.place || !data.stage) return { ok: false as const, error: "Name the place and the stage." };
    await ready(sql);
    await sql`insert into transport_stages (place, stage) values (${data.place}, ${data.stage})`;
    const people = await sql.query<{ user_id: string; place: string; phone: string; ride_back: unknown }>(
      "select user_id, place, phone, ride_back from transport_locations",
    );
    const key = data.place.trim().toLowerCase();
    const matched = people.filter((person) => person.place.trim().toLowerCase() === key);
    for (const person of matched) {
      await sql`update transport_locations set notice = ${data.stage.trim()} where user_id = ${person.user_id}`;
    }
    const quiet = matched.filter((person) => !person.phone.trim());
    const called = matched.filter((person) => person.phone.trim()).map((person) => person.user_id);
    try {
      for (const person of quiet) {
        await tellInbox(sql, context.userId, person.user_id, stageNote(data.stage.trim(), boolish(person.ride_back)));
      }
      const { notifyPeople } = await import("@/lib/porch/push.server");
      await notifyPeople(sql, called, "Porchbook", data.stage.trim(), "/next");
    } catch {
      // The stage still shows when they open Transport.
    }
    return { ok: true as const };
  });

function latin(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, "?");
}

function pdfText(value: string): string {
  return latin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function locationsPdf(
  groups: { label: string; count: number; people: { name: string; place: string; phone: string; rideBack: boolean }[] }[],
  sheets: Awaited<ReturnType<typeof driverSheets>> = [],
  event?: TransportEvent,
): string {
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
  const write = (text: string, size: number, x: number, leading: number) => {
    if (y - leading < bottom) flush();
    ops.push(`BT /F1 ${size} Tf ${x} ${y - size} Td (${pdfText(text)}) Tj ET`);
    y -= leading;
  };
  // One page per driver: his stages in pickup order, and who is at each.
  for (const sheet of sheets) {
    if (!sheet.stops.length) continue;
    if (ops.length) flush();
    write(`${sheet.bus.name}${sheet.bus.plate ? ` - ${sheet.bus.plate}` : ""}`, 22, left, 30);
    write(`Driver: ${sheet.bus.driver}  ${sheet.bus.driverPhone}`, 13, left, 20);
    if (event) write(`${event.name}${event.date ? ` - ${dayLabel(event.date)}` : ""}${event.gates ? ` - gates ${clock(event.gates)}` : ""}`, 11, left, 22);
    write(`${sheet.bus.riders} travellers${sheet.bus.seats ? ` of ${sheet.bus.seats} seats` : ""}`, 11, left, 24);
    for (const stop of sheet.stops) {
      if (y - 40 < bottom) flush();
      write(`${clock(stop.pickup)}  ${stop.stage} - ${stop.people.length}`, 14, left, 22);
      for (const person of stop.people) {
        if (y - 16 < bottom) flush();
        ops.push(`BT /F1 12 Tf ${left + 12} ${y - 12} Td (${pdfText(person.rideBack ? person.name : `${person.name} - own way back`)}) Tj ET`);
        if (person.phone) ops.push(`BT /F1 11 Tf 360 ${y - 12} Td (${pdfText(person.phone)}) Tj ET`);
        y -= 16;
      }
      y -= 8;
    }
  }
  if (ops.length) flush();
  write("Locations", 22, left, 30);
  if (groups.length === 0) {
    flush();
  } else {
    for (const group of groups) {
      if (y - 40 < bottom) flush();
      write(`${group.label} - ${group.count}`, 14, left, 22);
      for (const person of group.people) {
        if (y - 16 < bottom) flush();
        ops.push(`BT /F1 12 Tf ${left} ${y - 12} Td (${pdfText(person.rideBack ? person.name : `${person.name} - own way back`)}) Tj ET`);
        ops.push(`BT /F1 11 Tf 220 ${y - 12} Td (${pdfText(person.place)}) Tj ET`);
        if (person.phone) ops.push(`BT /F1 11 Tf 400 ${y - 12} Td (${pdfText(person.phone)}) Tj ET`);
        y -= 16;
      }
      y -= 8;
    }
    if (ops.length) flush();
  }
  const pageW = 595;
  const pageH = 842;
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
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
  return Buffer.from(pdf).toString("base64");
}

export const downloadTransport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ready(sql);
    const who = await canArrange(sql, context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team can take this list." };
    const event = await currentEvent(sql);
    const groups = await locationReport(sql, event);
    const sheets = await driverSheets(sql, event.id);
    const name = event.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "transport";
    return { ok: true as const, pdf: locationsPdf(groups, sheets, event), filename: `${name}-transport.pdf` };
  });

