import { createServerFn } from "@tanstack/react-start";
import { porchTables } from "@/lib/porch/porch-foundation";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { TRANSPORT_PHONE } from "@/lib/porch/transport-points";

/**
 * Transport, run by the Transport team: the event (name, date, pickup and gates times, phone),
 * the buses with their drivers, which pickup stage rides on which bus and at what time,
 * and the confirmations the team sends to the travellers on each bus.
 * Nothing reaches a traveller until the team sends it.
 */

function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
/** "06:25" (24-hour, from a time box) or "". */
function hhmm(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : "";
}
function ymd(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

/** "06:25" → "6:25 AM". Anything else is shown as given. */
export function clock(value: string) {
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return value;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
/** "2026-11-14" → "Sat 14 Nov 2026". */
export function dayLabel(value: string) {
  if (!value) return "";
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
/** Today in Kampala, "YYYY-MM-DD". */
function kampalaToday() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}

export type TransportEvent = { id: number; name: string; date: string; pickup: string; gates: string; phone: string };

let ready = false;
export async function ensureBoard(sql: Sql) {
  if (ready) return;
  await sql.query(`create table if not exists transport_events (
    id serial primary key,
    name text not null default '',
    event_date text not null default '',
    pickup text not null default '',
    gates text not null default '',
    phone text not null default '',
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table transport_locations add column if not exists event_id integer not null default 0");
  await sql.query("alter table profiles add column if not exists is_transport boolean not null default false");
  await sql.query(`create table if not exists transport_buses (
    id serial primary key,
    event_id integer not null,
    name text not null default '',
    plate text not null default '',
    driver text not null default '',
    driver_phone text not null default '',
    seats integer not null default 0,
    note text not null default '',
    sent_at timestamptz,
    changed_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists transport_stops (
    event_id integer not null,
    stage text not null,
    bus_id integer not null,
    pickup text not null default '',
    primary key (event_id, stage)
  )`);
  await sql.query(`create table if not exists transport_rides (
    event_id integer not null,
    user_id text not null references profiles (user_id) on delete cascade,
    bus_id integer not null,
    stage text not null default '',
    pickup text not null default '',
    bus_name text not null default '',
    plate text not null default '',
    driver text not null default '',
    driver_phone text not null default '',
    note text not null default '',
    ride_back boolean not null default true,
    sent_at timestamptz not null default now(),
    seen boolean not null default false,
    primary key (event_id, user_id)
  )`);
  // The first time: today's event (as it was written in the code) holds everyone already registered.
  const any = await sql.query<{ id: number }>("select id from transport_events order by id desc limit 1");
  if (!any.length) {
    const made = await sql.query<{ id: number }>(
      "insert into transport_events (name, event_date, pickup, gates, phone) values ($1, '', '07:00', '08:00', $2) returning id",
      ["31st Night of Prayer", TRANSPORT_PHONE],
    );
    await sql.query("update transport_locations set event_id = $1 where event_id = 0", [Number(made[0].id)]);
  }
  await porchTables(sql, { own: ["transport_events"] });
  ready = true;
}

/**
 * The current transport event of the viewer's own church porch (Stage 3b). A church without one
 * gets an empty one to fill in. (The PorchGuy, on hold, passes no viewer and reads Phaneroo's.)
 */
export async function currentEvent(sql: Sql, viewer: string): Promise<TransportEvent> {
  await ensureBoard(sql);
  const read = () =>
    sql.query<{ id: number; name: string; event_date: string; pickup: string; gates: string; phone: string }>(
      "select id, name, event_date, pickup, gates, phone from transport_events where porch_id = coalesce(my_porch($1), 1) order by id desc limit 1",
      [viewer],
    );
  let rows = await read();
  if (!rows.length) {
    await sql.query("insert into transport_events (porch_id, name, event_date, pickup, gates, phone) values (coalesce(my_porch($1), 1), 'Our next event', '', '07:00', '08:00', '')", [viewer]);
    rows = await read();
  }
  const r = rows[0];
  return { id: Number(r.id), name: r.name, date: r.event_date, pickup: r.pickup, gates: r.gates, phone: r.phone };
}

/** Registration closes at midnight before the event day. */
export function isClosed(event: TransportEvent) {
  return Boolean(event.date) && kampalaToday() >= event.date;
}

export async function canArrange(sql: Sql, userId: string) {
  await ensureBoard(sql);
  const me = await sql.query<{ is_founder: unknown; is_transport: unknown }>("select is_porch_admin(user_id) as is_founder, is_transport from profiles where user_id = $1", [userId]);
  return { founder: boolish(me[0]?.is_founder), arrange: boolish(me[0]?.is_founder) || boolish(me[0]?.is_transport) };
}

export type MyRide = {
  busName: string;
  plate: string;
  stage: string;
  pickup: string;
  driver: string;
  driverPhone: string;
  note: string;
  rideBack: boolean;
};

export async function myRide(sql: Sql, userId: string, eventId: number): Promise<MyRide | null> {
  const rows = await sql.query<{ bus_name: string; plate: string; stage: string; pickup: string; driver: string; driver_phone: string; note: string; ride_back: unknown }>(
    "select bus_name, plate, stage, pickup, driver, driver_phone, note, ride_back from transport_rides where event_id = $1 and user_id = $2",
    [eventId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { busName: r.bus_name, plate: r.plate, stage: r.stage, pickup: clock(r.pickup), driver: r.driver, driverPhone: r.driver_phone, note: r.note, rideBack: boolish(r.ride_back) };
}

// ---- The event and the team

export const saveTransportEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      fresh: raw.fresh === true,
      name: text(raw.name, 80),
      date: ymd(raw.date),
      pickup: hhmm(raw.pickup),
      gates: hhmm(raw.gates),
      phone: text(raw.phone, 24),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const who = await canArrange(sql, context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team sets the event." };
    if (!data.name) return { ok: false as const, error: "Name the event." };
    if (!data.date) return { ok: false as const, error: "Choose the event's date." };
    if (data.date <= kampalaToday()) return { ok: false as const, error: "The date must be after today, so people can register a day before." };
    if (data.fresh) {
      await sql.query("insert into transport_events (porch_id, name, event_date, pickup, gates, phone) values (my_porch($6), $1, $2, $3, $4, $5)", [
        data.name,
        data.date,
        data.pickup,
        data.gates,
        data.phone,
        context.userId,
      ]);
    } else {
      const event = await currentEvent(sql, context.userId);
      await sql.query("update transport_events set name = $2, event_date = $3, pickup = $4, gates = $5, phone = $6 where id = $1", [
        event.id,
        data.name,
        data.date,
        data.pickup,
        data.gates,
        data.phone,
      ]);
    }
    return { ok: true as const, event: await currentEvent(sql, context.userId) };
  });

export const listTransportTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const who = await canArrange(sql, context.userId);
    if (!who.founder) return { ok: false as const, ids: [] as string[] };
    const rows = await sql.query<{ user_id: string }>("select user_id from profiles where is_transport and porch_id = my_porch($1)", [context.userId]);
    return { ok: true as const, ids: rows.map((r) => r.user_id) };
  });

export const setTransportTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ userId: text(rec(input).userId, 80), on: rec(input).on === true }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const who = await canArrange(sql, context.userId);
    if (!who.founder) return { ok: false as const, error: "Only the founder chooses the Transport team." };
    await sql.query("update profiles set is_transport = $2 where user_id = $1 and same_porch(user_id, $3)", [data.userId, data.on, context.userId]);
    return { ok: true as const };
  });

// ---- The board: buses, stages, travellers

export type BoardBus = {
  id: number;
  name: string;
  plate: string;
  driver: string;
  driverPhone: string;
  seats: number;
  note: string;
  stops: { stage: string; pickup: string; riders: number }[];
  riders: number;
  sent: boolean;
  changed: boolean; // changed since the last send
};
export type BoardStage = { stage: string; riders: number; busId: number };

type Traveller = { userId: string; name: string; place: string; phone: string; rideBack: boolean };

async function travellers(sql: Sql, eventId: number): Promise<Traveller[]> {
  const rows = await sql.query<{ user_id: string; display_name: string | null; place: string; phone: string; ride_back: unknown }>(
    `select t.user_id, p.display_name, t.place, t.phone, t.ride_back
       from transport_locations t join profiles p on p.user_id = t.user_id
      where t.event_id = $1 and trim(t.place) <> '' order by p.display_name`,
    [eventId],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.display_name || "Teammate", place: r.place.trim(), phone: r.phone, rideBack: boolish(r.ride_back) }));
}

async function readBoard(sql: Sql, eventId: number) {
  const people = await travellers(sql, eventId);
  const count = new Map<string, number>();
  for (const person of people) count.set(person.place, (count.get(person.place) ?? 0) + 1);
  const busRows = await sql.query<{ id: number; name: string; plate: string; driver: string; driver_phone: string; seats: number; note: string; sent_at: string | null; changed: unknown }>(
    `select id, name, plate, driver, driver_phone, seats, note, sent_at, (sent_at is not null and changed_at > sent_at) as changed
       from transport_buses where event_id = $1 order by id`,
    [eventId],
  );
  const stopRows = await sql.query<{ stage: string; bus_id: number; pickup: string }>(
    "select stage, bus_id, pickup from transport_stops where event_id = $1 order by pickup, stage",
    [eventId],
  );
  const buses: BoardBus[] = busRows.map((b) => {
    const stops = stopRows
      .filter((s) => Number(s.bus_id) === Number(b.id))
      .map((s) => ({ stage: s.stage, pickup: s.pickup, riders: count.get(s.stage) ?? 0 }))
      .sort((x, y) => (x.pickup || "99").localeCompare(y.pickup || "99"));
    return {
      id: Number(b.id),
      name: b.name,
      plate: b.plate,
      driver: b.driver,
      driverPhone: b.driver_phone,
      seats: Number(b.seats) || 0,
      note: b.note,
      stops,
      riders: stops.reduce((sum, s) => sum + s.riders, 0),
      sent: Boolean(b.sent_at),
      changed: boolish(b.changed),
    };
  });
  const onBus = new Map(stopRows.map((s) => [s.stage, Number(s.bus_id)]));
  const stages: BoardStage[] = [...count.entries()]
    .map(([stage, riders]) => ({ stage, riders, busId: onBus.get(stage) ?? 0 }))
    .sort((a, b) => b.riders - a.riders || a.stage.localeCompare(b.stage));
  return { buses, stages, people };
}

async function guard(userId: string) {
  const sql = await getSql();
  const who = await canArrange(sql, userId);
  const event = await currentEvent(sql, userId);
  return { sql, who, event };
}

export const loadTransportBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, who, event } = await guard(context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team sees this." };
    const board = await readBoard(sql, event.id);
    return {
      ok: true as const,
      founder: who.founder,
      event,
      buses: board.buses,
      stages: board.stages,
      people: board.people.map((p) => ({ name: p.name, place: p.place, phone: p.phone, rideBack: p.rideBack })),
    };
  });

export const saveTransportBus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      id: Number(raw.id) || 0,
      name: text(raw.name, 40),
      plate: text(raw.plate, 20).toUpperCase(),
      driver: text(raw.driver, 60),
      driverPhone: text(raw.driverPhone, 24),
      seats: Math.max(0, Math.min(200, Math.round(Number(raw.seats) || 0))),
    };
  })
  .handler(async ({ context, data }) => {
    const { sql, who, event } = await guard(context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team changes buses." };
    if (!data.name) return { ok: false as const, error: "Name the bus, e.g. Bus 1." };
    if (!data.driver || !data.driverPhone) return { ok: false as const, error: "Add the driver's name and phone." };
    if (data.id) {
      await sql.query(
        "update transport_buses set name = $3, plate = $4, driver = $5, driver_phone = $6, seats = $7, changed_at = now() where id = $1 and event_id = $2",
        [data.id, event.id, data.name, data.plate, data.driver, data.driverPhone, data.seats],
      );
    } else {
      await sql.query("insert into transport_buses (event_id, name, plate, driver, driver_phone, seats) values ($1, $2, $3, $4, $5, $6)", [
        event.id,
        data.name,
        data.plate,
        data.driver,
        data.driverPhone,
        data.seats,
      ]);
    }
    return { ok: true as const };
  });

export const dropTransportBus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const { sql, who, event } = await guard(context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team changes buses." };
    const sent = await sql.query<{ n: string | number }>("select count(*) as n from transport_rides where event_id = $1 and bus_id = $2", [event.id, data.id]);
    if (Number(sent[0]?.n ?? 0) > 0) return { ok: false as const, error: "Travellers were told this bus. Move its stages to another bus and send them the update first." };
    await sql.query("delete from transport_stops where event_id = $1 and bus_id = $2", [event.id, data.id]);
    await sql.query("delete from transport_buses where event_id = $1 and id = $2", [event.id, data.id]);
    return { ok: true as const };
  });

/** Put a stage on a bus at a pickup time (busId 0 takes it off any bus). */
export const setTransportStop = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { stage: text(raw.stage, 120), busId: Number(raw.busId) || 0, pickup: hhmm(raw.pickup) };
  })
  .handler(async ({ context, data }) => {
    const { sql, who, event } = await guard(context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team changes buses." };
    if (!data.stage) return { ok: false as const, error: "Choose a stage." };
    const was = await sql.query<{ bus_id: number }>("select bus_id from transport_stops where event_id = $1 and stage = $2", [event.id, data.stage]);
    const touched = new Set<number>();
    if (was[0]) touched.add(Number(was[0].bus_id));
    if (data.busId) {
      const bus = await sql.query<{ id: number }>("select id from transport_buses where id = $1 and event_id = $2", [data.busId, event.id]);
      if (!bus.length) return { ok: false as const, error: "That bus is gone." };
      await sql.query(
        `insert into transport_stops (event_id, stage, bus_id, pickup) values ($1, $2, $3, $4)
         on conflict (event_id, stage) do update set bus_id = excluded.bus_id, pickup = excluded.pickup`,
        [event.id, data.stage, data.busId, data.pickup],
      );
      touched.add(data.busId);
    } else {
      await sql.query("delete from transport_stops where event_id = $1 and stage = $2", [event.id, data.stage]);
    }
    if (touched.size) await sql.query("update transport_buses set changed_at = now() where id = any($1::int[])", [[...touched]]);
    return { ok: true as const };
  });

/** Send (or re-send) the confirmation to every traveller on this bus. */
export const sendTransportBus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0, note: text(rec(input).note, 160) }))
  .handler(async ({ context, data }) => {
    const { sql, who, event } = await guard(context.userId);
    if (!who.arrange) return { ok: false as const, error: "Only the Transport team sends confirmations." };
    const board = await readBoard(sql, event.id);
    const bus = board.buses.find((b) => b.id === data.id);
    if (!bus) return { ok: false as const, error: "That bus is gone." };
    if (!bus.stops.length) return { ok: false as const, error: "Put at least one stage on this bus first." };
    const untimed = bus.stops.find((s) => !s.pickup);
    if (untimed) return { ok: false as const, error: `Give ${untimed.stage} a pickup time first.` };
    const byStage = new Map(bus.stops.map((s) => [s.stage, s.pickup]));
    const riders = board.people.filter((p) => byStage.has(p.place));
    for (const person of riders) {
      await sql.query(
        `insert into transport_rides (event_id, user_id, bus_id, stage, pickup, bus_name, plate, driver, driver_phone, note, ride_back, sent_at, seen)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), false)
         on conflict (event_id, user_id) do update set bus_id = excluded.bus_id, stage = excluded.stage, pickup = excluded.pickup,
           bus_name = excluded.bus_name, plate = excluded.plate, driver = excluded.driver, driver_phone = excluded.driver_phone,
           note = excluded.note, ride_back = excluded.ride_back, sent_at = now(), seen = false`,
        [event.id, person.userId, bus.id, person.place, byStage.get(person.place) ?? "", bus.name, bus.plate, bus.driver, bus.driverPhone, data.note, person.rideBack],
      );
    }
    await sql.query("update transport_buses set sent_at = now(), changed_at = now() - interval '1 second', note = $2 where id = $1", [bus.id, data.note]);
    try {
      const { notifyPeople } = await import("@/lib/porch/push.server");
      for (const person of riders) {
        await notifyPeople(sql, [person.userId], "Your ride is confirmed", `${bus.name}: be at ${person.place} by ${clock(byStage.get(person.place) ?? "")}.`, "/next");
      }
    } catch {
      // They still see it when they open Transport, and the porch guy tells them.
    }
    return { ok: true as const, sent: riders.length };
  });

// ---- The traveller

/** The porch guy tells a traveller once when their ride is confirmed or changed. */
export const rideNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const event = await currentEvent(sql, context.userId);
    const rows = await sql.query<{ seen: unknown }>("select seen from transport_rides where event_id = $1 and user_id = $2", [event.id, context.userId]);
    if (!rows[0] || boolish(rows[0].seen)) return { ride: null };
    return { ride: await myRide(sql, context.userId, event.id), event: event.name };
  });

export const seenRideNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const event = await currentEvent(sql, context.userId);
    await sql.query("update transport_rides set seen = true where event_id = $1 and user_id = $2", [event.id, context.userId]);
    return { ok: true as const };
  });

/** For the driver PDF: each bus with its stops in time order and who's at each. */
export async function driverSheets(sql: Sql, eventId: number) {
  const board = await readBoard(sql, eventId);
  return board.buses.map((bus) => ({
    bus,
    stops: bus.stops.map((stop) => ({ ...stop, people: board.people.filter((p) => p.place === stop.stage) })),
  }));
}
