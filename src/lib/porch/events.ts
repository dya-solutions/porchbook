import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { tablePdf, type PdfBlock } from "@/lib/porch/pdf-lite";

/**
 * Events: the founder (Media and Hospitality for now) adds events and hotels. Members say whether
 * they're attending, and travellers give their travel and choose a room, which the founder approves.
 * The founder and the Transport team see the guest board.
 */

function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim().slice(0, max) : "";
}
function ymd(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}
/** "2026-11-13T14:30" from a date-and-time box. */
function stamp(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? raw : "";
}
function hhmm(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\d{2}:\d{2}$/.test(raw) ? raw : "";
}
function kampalaToday() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}

export type RoomKind = "single" | "double" | "shared";
export type Room = { id: number; kind: RoomKind; price: number; currency: "UGX" | "USD"; per: "night" | "person"; available: number; taken: number; full: boolean };
export type Hotel = { id: number; name: string; note: string; packages: string; rooms: Room[] };
export type Rsvp = "yes" | "maybe" | "no" | "";
export type Travel = {
  origin: "uganda" | "abroad";
  fromPlace: string;
  arriveAt: string;
  arriveFlight: string;
  leaveAt: string;
  leaveFlight: string;
  pickup: boolean;
  party: number;
  roomId: number;
  otherHotel: string;
  stay: "none" | "requested" | "approved" | "declined";
};
export type PorchEvent = {
  id: number;
  title: string;
  startsOn: string;
  endsOn: string;
  venue: string;
  gates: string;
  about: string;
  flyer: string;
  yes: number;
  maybe: number;
  mine: Rsvp;
  travel: Travel | null;
  past: boolean;
};

let ready = false;
async function ensure(sql: Sql) {
  if (ready) return;
  // Checked once ever: a flag says the tables are in place, so a cold start costs one quick read.
  try {
    const done = await sql.query<{ key: string }>("select key from porch_flags where key = 'events-v1'");
    if (done.length) {
      ready = true;
      return;
    }
  } catch {
    // No flags table yet: set everything up below.
  }
  await sql.query("alter table profiles add column if not exists is_transport boolean not null default false");
  await sql.query(`create table if not exists pb_events (
    id serial primary key,
    title text not null default '',
    starts_on text not null default '',
    ends_on text not null default '',
    venue text not null default '',
    gates text not null default '',
    about text not null default '',
    flyer text not null default '',
    dropped boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists pb_event_rsvp (
    event_id integer not null,
    user_id text not null references profiles (user_id) on delete cascade,
    answer text not null,
    updated_at timestamptz not null default now(),
    primary key (event_id, user_id)
  )`);
  await sql.query(`create table if not exists pb_hotels (
    id serial primary key,
    event_id integer not null,
    name text not null default '',
    note text not null default '',
    packages text not null default '',
    dropped boolean not null default false
  )`);
  await sql.query(`create table if not exists pb_rooms (
    id serial primary key,
    hotel_id integer not null,
    kind text not null default 'single',
    price numeric not null default 0,
    currency text not null default 'UGX',
    per text not null default 'night',
    available integer not null default 0,
    dropped boolean not null default false
  )`);
  await sql.query(`create table if not exists pb_event_travel (
    event_id integer not null,
    user_id text not null references profiles (user_id) on delete cascade,
    origin text not null default 'uganda',
    from_place text not null default '',
    arrive_at text not null default '',
    arrive_flight text not null default '',
    leave_at text not null default '',
    leave_flight text not null default '',
    pickup boolean not null default false,
    party integer not null default 1,
    room_id integer not null default 0,
    other_hotel text not null default '',
    stay text not null default 'none',
    updated_at timestamptz not null default now(),
    primary key (event_id, user_id)
  )`);
  await sql.query("create table if not exists porch_flags (key text primary key)");
  await sql.query("insert into porch_flags (key) values ('events-v1') on conflict (key) do nothing");
  ready = true;
}

async function who(sql: Sql, userId: string) {
  await ensure(sql);
  const rows = await sql.query<{ is_founder: unknown; is_transport: unknown }>("select is_porch_admin(user_id) as is_founder, is_transport from profiles where user_id = $1", [userId]);
  const founder = boolish(rows[0]?.is_founder);
  return { founder, board: founder || boolish(rows[0]?.is_transport) };
}

type TravelRow = {
  origin: string; from_place: string; arrive_at: string; arrive_flight: string; leave_at: string; leave_flight: string;
  pickup: unknown; party: number; room_id: number; other_hotel: string; stay: string;
};
function toTravel(r: TravelRow): Travel {
  return {
    origin: r.origin === "abroad" ? "abroad" : "uganda",
    fromPlace: r.from_place,
    arriveAt: r.arrive_at,
    arriveFlight: r.arrive_flight,
    leaveAt: r.leave_at,
    leaveFlight: r.leave_flight,
    pickup: boolish(r.pickup),
    party: Number(r.party) || 1,
    roomId: Number(r.room_id) || 0,
    otherHotel: r.other_hotel,
    stay: r.stay === "requested" || r.stay === "approved" || r.stay === "declined" ? r.stay : "none",
  };
}

async function readHotels(sql: Sql, eventId: number): Promise<Hotel[]> {
  const hotels = await sql.query<{ id: number; name: string; note: string; packages: string }>(
    "select id, name, note, packages from pb_hotels where event_id = $1 and not dropped order by id",
    [eventId],
  );
  const rooms = await sql.query<{ id: number; hotel_id: number; kind: string; price: string | number; currency: string; per: string; available: number; taken: string | number }>(
    `select r.id, r.hotel_id, r.kind, r.price, r.currency, r.per, r.available,
            (select count(*) from pb_event_travel t where t.event_id = $1 and t.room_id = r.id and t.stay = 'approved') as taken
       from pb_rooms r join pb_hotels h on h.id = r.hotel_id
      where h.event_id = $1 and not r.dropped order by r.id`,
    [eventId],
  );
  return hotels.map((h) => ({
    id: Number(h.id),
    name: h.name,
    note: h.note,
    packages: h.packages,
    rooms: rooms
      .filter((r) => Number(r.hotel_id) === Number(h.id))
      .map((r) => {
        const available = Number(r.available) || 0;
        const taken = Number(r.taken) || 0;
        return {
          id: Number(r.id),
          kind: (r.kind === "double" || r.kind === "shared" ? r.kind : "single") as RoomKind,
          price: Number(r.price) || 0,
          currency: r.currency === "USD" ? "USD" : "UGX",
          per: r.per === "person" ? "person" : "night",
          available,
          taken,
          full: taken >= available,
        };
      }),
  }));
}

// ---- Everyone

export const listEvents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await who(sql, context.userId);
    const today = kampalaToday();
    const rows = await sql.query<{ id: number; title: string; starts_on: string; ends_on: string; venue: string; gates: string; about: string; flyer: string; yes: string | number; maybe: string | number; mine: string | null }>(
      `select e.id, e.title, e.starts_on, e.ends_on, e.venue, e.gates, e.about,
              case when e.flyer <> '' then left(md5(e.flyer), 16) else '' end as flyer,
              (select count(*) from pb_event_rsvp r where r.event_id = e.id and r.answer = 'yes') as yes,
              (select count(*) from pb_event_rsvp r where r.event_id = e.id and r.answer = 'maybe') as maybe,
              (select answer from pb_event_rsvp r where r.event_id = e.id and r.user_id = $1) as mine
         from pb_events e
        where not e.dropped and (coalesce(nullif(e.ends_on, ''), e.starts_on) >= $2 or $3)
        order by e.starts_on asc, e.id asc`,
      [context.userId, today, me.founder],
    );
    const travels = await sql.query<TravelRow & { event_id: number }>("select * from pb_event_travel where user_id = $1", [context.userId]);
    const events: PorchEvent[] = rows.map((r) => {
      const travel = travels.find((t) => Number(t.event_id) === Number(r.id));
      const mine = r.mine === "yes" || r.mine === "maybe" || r.mine === "no" ? r.mine : "";
      return {
        id: Number(r.id),
        title: r.title,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        venue: r.venue,
        gates: r.gates,
        about: r.about,
        // Just the address: the picture itself comes separately (and the phone keeps it).
        flyer: r.flyer ? `/api/event-flyer?id=${Number(r.id)}&v=${r.flyer}` : "",
        yes: Number(r.yes) || 0,
        maybe: Number(r.maybe) || 0,
        mine,
        travel: travel ? toTravel(travel) : null,
        past: (r.ends_on || r.starts_on) < today,
      };
    });
    return { events, founder: me.founder, board: me.board };
  });

export const answerEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const answer = raw.answer === "yes" || raw.answer === "maybe" || raw.answer === "no" ? raw.answer : "";
    return { eventId: Number(raw.eventId) || 0, answer };
  })
  .handler(async ({ context, data }) => {
    if (!data.answer) return { ok: false as const, error: "Choose Yes, Maybe or No." };
    const sql = await getSql();
    await ensure(sql);
    await sql.query(
      `insert into pb_event_rsvp (event_id, user_id, answer) values ($1, $2, $3)
       on conflict (event_id, user_id) do update set answer = excluded.answer, updated_at = now()`,
      [data.eventId, context.userId, data.answer],
    );
    return { ok: true as const };
  });

export const eventHotels = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ eventId: Number(rec(input).eventId) || 0 }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensure(sql);
    return { hotels: await readHotels(sql, data.eventId) };
  });

export const saveTravel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      eventId: Number(raw.eventId) || 0,
      origin: raw.origin === "abroad" ? "abroad" : "uganda",
      fromPlace: text(raw.fromPlace, 80),
      arriveAt: stamp(raw.arriveAt),
      arriveFlight: text(raw.arriveFlight, 20).toUpperCase(),
      leaveAt: stamp(raw.leaveAt),
      leaveFlight: text(raw.leaveFlight, 20).toUpperCase(),
      pickup: raw.pickup === true,
      party: Math.max(1, Math.min(20, Math.round(Number(raw.party) || 1))),
      roomId: Number(raw.roomId) || 0,
      otherHotel: text(raw.otherHotel, 80),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.fromPlace) return { ok: false as const, error: "Say where you're coming from." };
    if (!data.arriveAt) return { ok: false as const, error: "Give your arrival date and time." };
    if (data.leaveAt && data.leaveAt <= data.arriveAt) return { ok: false as const, error: "There's an error in your dates entry. Please check it." };
    const sql = await getSql();
    await ensure(sql);
    const event = await sql.query<{ id: number }>("select id from pb_events where id = $1 and not dropped", [data.eventId]);
    if (!event.length) return { ok: false as const, error: "That event is gone." };
    const before = await sql.query<TravelRow>("select * from pb_event_travel where event_id = $1 and user_id = $2", [data.eventId, context.userId]);
    const was = before[0] ? toTravel(before[0]) : null;
    let stay: Travel["stay"] = "none";
    if (data.roomId) {
      const hotels = await readHotels(sql, data.eventId);
      const room = hotels.flatMap((h) => h.rooms).find((r) => r.id === data.roomId);
      if (!room) return { ok: false as const, error: "That room is gone. Choose another." };
      // Keeping the same room keeps its approval; a new choice is a fresh request.
      if (was && was.roomId === data.roomId && was.stay !== "declined") stay = was.stay;
      else if (room.full) return { ok: false as const, error: "That room is FULL. Choose another." };
      else stay = "requested";
    }
    await sql.query(
      `insert into pb_event_travel (event_id, user_id, origin, from_place, arrive_at, arrive_flight, leave_at, leave_flight, pickup, party, room_id, other_hotel, stay, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       on conflict (event_id, user_id) do update set origin = excluded.origin, from_place = excluded.from_place, arrive_at = excluded.arrive_at,
         arrive_flight = excluded.arrive_flight, leave_at = excluded.leave_at, leave_flight = excluded.leave_flight, pickup = excluded.pickup,
         party = excluded.party, room_id = excluded.room_id, other_hotel = excluded.other_hotel, stay = excluded.stay, updated_at = now()`,
      [data.eventId, context.userId, data.origin, data.fromPlace, data.arriveAt, data.arriveFlight, data.leaveAt, data.leaveFlight, data.pickup, data.party, data.roomId, data.roomId ? "" : data.otherHotel, stay],
    );
    // Travelling to it means attending it.
    await sql.query(
      `insert into pb_event_rsvp (event_id, user_id, answer) values ($1, $2, 'yes')
       on conflict (event_id, user_id) do update set answer = 'yes', updated_at = now()`,
      [data.eventId, context.userId],
    );
    return { ok: true as const, stay };
  });

export const dropTravel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ eventId: Number(rec(input).eventId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    await sql.query("delete from pb_event_travel where event_id = $1 and user_id = $2", [data.eventId, context.userId]);
    return { ok: true as const };
  });

// ---- The founder: events, hotels, rooms, approvals

export const saveEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const flyer = typeof raw.flyer === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(raw.flyer) && raw.flyer.length <= 700_000 ? raw.flyer : "";
    return {
      id: Number(raw.id) || 0,
      title: text(raw.title, 100),
      startsOn: ymd(raw.startsOn),
      endsOn: ymd(raw.endsOn),
      venue: text(raw.venue, 100),
      gates: hhmm(raw.gates),
      about: text(raw.about, 1500),
      flyer,
      keepFlyer: raw.keepFlyer === true,
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only the Media team adds events." };
    if (!data.title) return { ok: false as const, error: "Name the event." };
    if (!data.startsOn) return { ok: false as const, error: "Choose the date it starts." };
    const endsOn = data.endsOn && data.endsOn >= data.startsOn ? data.endsOn : "";
    if (data.id) {
      await sql.query(
        `update pb_events set title = $2, starts_on = $3, ends_on = $4, venue = $5, gates = $6, about = $7,
           flyer = case when $9 then flyer else $8 end where id = $1`,
        [data.id, data.title, data.startsOn, endsOn, data.venue, data.gates, data.about, data.flyer, data.keepFlyer],
      );
    } else {
      await sql.query("insert into pb_events (title, starts_on, ends_on, venue, gates, about, flyer) values ($1, $2, $3, $4, $5, $6, $7)", [
        data.title,
        data.startsOn,
        endsOn,
        data.venue,
        data.gates,
        data.about,
        data.flyer,
      ]);
    }
    return { ok: true as const };
  });

export const dropEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only the Media team removes events." };
    await sql.query("update pb_events set dropped = true where id = $1", [data.id]);
    return { ok: true as const };
  });

export const saveHotel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { id: Number(raw.id) || 0, eventId: Number(raw.eventId) || 0, name: text(raw.name, 80), note: text(raw.note, 120), packages: text(raw.packages, 400) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only Hospitality changes hotels." };
    if (!data.name) return { ok: false as const, error: "Name the hotel." };
    if (data.id) await sql.query("update pb_hotels set name = $2, note = $3, packages = $4 where id = $1", [data.id, data.name, data.note, data.packages]);
    else await sql.query("insert into pb_hotels (event_id, name, note, packages) values ($1, $2, $3, $4)", [data.eventId, data.name, data.note, data.packages]);
    return { ok: true as const };
  });

export const dropHotel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only Hospitality changes hotels." };
    await sql.query("update pb_hotels set dropped = true where id = $1", [data.id]);
    return { ok: true as const };
  });

export const saveRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      id: Number(raw.id) || 0,
      hotelId: Number(raw.hotelId) || 0,
      kind: raw.kind === "double" || raw.kind === "shared" ? raw.kind : "single",
      price: Math.max(0, Math.round(Number(raw.price) || 0)),
      currency: raw.currency === "USD" ? "USD" : "UGX",
      per: raw.per === "person" ? "person" : "night",
      available: Math.max(0, Math.min(5000, Math.round(Number(raw.available) || 0))),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only Hospitality changes rooms." };
    if (data.id) {
      await sql.query("update pb_rooms set kind = $2, price = $3, currency = $4, per = $5, available = $6 where id = $1", [data.id, data.kind, data.price, data.currency, data.per, data.available]);
    } else {
      await sql.query("insert into pb_rooms (hotel_id, kind, price, currency, per, available) values ($1, $2, $3, $4, $5, $6)", [data.hotelId, data.kind, data.price, data.currency, data.per, data.available]);
    }
    return { ok: true as const };
  });

export const dropRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only Hospitality changes rooms." };
    await sql.query("update pb_rooms set dropped = true where id = $1", [data.id]);
    return { ok: true as const };
  });

export type Guest = {
  userId: string;
  name: string;
  travel: Travel;
  hotel: string;
  room: string;
};

async function readGuests(sql: Sql, eventId: number) {
  const hotels = await readHotels(sql, eventId);
  const roomLabel = new Map<number, { hotel: string; room: string }>();
  for (const h of hotels) for (const r of h.rooms) roomLabel.set(r.id, { hotel: h.name, room: r.kind });
  const rows = await sql.query<TravelRow & { user_id: string; display_name: string | null }>(
    `select t.*, p.display_name from pb_event_travel t join profiles p on p.user_id = t.user_id
      where t.event_id = $1 order by t.arrive_at, p.display_name`,
    [eventId],
  );
  const guests: Guest[] = rows.map((r) => {
    const travel = toTravel(r);
    const label = roomLabel.get(travel.roomId);
    return { userId: r.user_id, name: r.display_name || "Teammate", travel, hotel: label?.hotel ?? travel.otherHotel, room: label?.room ?? "" };
  });
  return { hotels, guests };
}

export const guestBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ eventId: Number(rec(input).eventId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await who(sql, context.userId);
    if (!me.board) return { ok: false as const, error: "Only Hospitality and Transport see the guest board." };
    const counts = await sql.query<{ answer: string; n: string | number }>("select answer, count(*) as n from pb_event_rsvp where event_id = $1 group by answer", [data.eventId]);
    const { hotels, guests } = await readGuests(sql, data.eventId);
    return {
      ok: true as const,
      approve: me.founder,
      yes: Number(counts.find((c) => c.answer === "yes")?.n ?? 0),
      maybe: Number(counts.find((c) => c.answer === "maybe")?.n ?? 0),
      hotels,
      guests,
    };
  });

export const decideStay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ eventId: Number(rec(input).eventId) || 0, userId: text(rec(input).userId, 80), approve: rec(input).approve === true }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await who(sql, context.userId)).founder) return { ok: false as const, error: "Only Hospitality approves rooms." };
    const rows = await sql.query<TravelRow>("select * from pb_event_travel where event_id = $1 and user_id = $2", [data.eventId, data.userId]);
    if (!rows[0]) return { ok: false as const, error: "That request is gone." };
    const travel = toTravel(rows[0]);
    if (data.approve) {
      const room = (await readHotels(sql, data.eventId)).flatMap((h) => h.rooms).find((r) => r.id === travel.roomId);
      if (!room) return { ok: false as const, error: "That room is gone." };
      if (travel.stay !== "approved" && room.full) return { ok: false as const, error: "That room type is FULL. Add rooms or decline." };
    }
    await sql.query("update pb_event_travel set stay = $3 where event_id = $1 and user_id = $2", [data.eventId, data.userId, data.approve ? "approved" : "declined"]);
    try {
      const { notifyPeople } = await import("@/lib/porch/push.server");
      await notifyPeople(sql, [data.userId], "Your stay", data.approve ? "Your room is approved." : "Your room request wasn't approved. Choose another.", "/next");
    } catch {
      // They see it on the event.
    }
    return { ok: true as const };
  });

function when(value: string) {
  if (!value) return "";
  const d = new Date(`${value}:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export const guestListPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ eventId: Number(rec(input).eventId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await who(sql, context.userId);
    if (!me.board) return { ok: false as const, error: "Only Hospitality and Transport take this list." };
    const event = await sql.query<{ title: string; starts_on: string }>("select title, starts_on from pb_events where id = $1", [data.eventId]);
    const title = event[0]?.title ?? "Event";
    const { hotels, guests } = await readGuests(sql, data.eventId);
    // Laid out like a spreadsheet: a green header row and a ruled grid for each part.
    const cap = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : "");
    const stayWord = (v: Travel["stay"]) => (v === "none" ? "" : cap(v));
    const pickups = guests.filter((g) => g.travel.pickup).length;
    const blocks: PdfBlock[] = [
      { kind: "title", text: `${title} - guests`, sub: `${guests.length} travelling - ${pickups} airport pickup${pickups === 1 ? "" : "s"}` },
      { kind: "heading", text: "Arrivals" },
      {
        kind: "table",
        columns: [
          { label: "Arrives", width: 1.3 },
          { label: "Name", width: 1.6 },
          { label: "Party", width: 0.6, align: "right" },
          { label: "From", width: 1.2 },
          { label: "Flight / Road", width: 1.1 },
          { label: "Pickup", width: 0.7, align: "center" },
          { label: "Hotel", width: 1.6 },
          { label: "Room", width: 1.0 },
          { label: "Stay", width: 0.9 },
          { label: "Leaves", width: 1.8 },
        ],
        rows: guests.map((g) => {
          const t = g.travel;
          return [
            when(t.arriveAt),
            g.name,
            String(t.party || 1),
            t.fromPlace,
            t.arriveFlight || (t.origin === "uganda" ? "Road" : ""),
            t.pickup ? "Yes" : "",
            g.hotel,
            g.room ? cap(g.room) : "",
            stayWord(t.stay),
            t.leaveAt ? `${when(t.leaveAt)}${t.leaveFlight ? ` ${t.leaveFlight}` : ""}` : "",
          ];
        }),
        empty: "No guests yet",
      },
      { kind: "heading", text: "Hotels" },
      {
        kind: "table",
        columns: [
          { label: "Hotel", width: 1.5 },
          { label: "Room type", width: 1.5 },
          { label: "Approved", width: 0.8, align: "right" },
          { label: "Available", width: 0.8, align: "right" },
          { label: "Status", width: 0.8 },
        ],
        rows: hotels.flatMap((h) => h.rooms.map((r) => [h.name, cap(r.kind), String(r.taken), String(r.available), r.full ? "FULL" : ""])),
        empty: "No hotels yet",
      },
      { kind: "heading", text: "Who stays where" },
      {
        kind: "table",
        columns: [
          { label: "Hotel", width: 1.5 },
          { label: "Name", width: 1.6 },
          { label: "Party", width: 0.6, align: "right" },
          { label: "Room", width: 1.3 },
          { label: "Stay", width: 1 },
        ],
        rows: guests
          .filter((g) => g.hotel)
          .sort((a, b) => a.hotel.localeCompare(b.hotel) || a.name.localeCompare(b.name))
          .map((g) => [g.hotel, g.name, String(g.travel.party || 1), g.room ? cap(g.room) : "Own choice", stayWord(g.travel.stay)]),
        empty: "No one yet",
      },
    ];
    const name = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "event";
    return { ok: true as const, pdf: tablePdf(blocks), filename: `${name}-guests.pdf` };
  });
