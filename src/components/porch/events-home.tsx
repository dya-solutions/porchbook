import { useBackLayer } from "@/lib/porch/back-stack";
import { W, WHint, useWord } from "@/components/porch/words";
import { useEffect, useMemo, useState } from "react";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { CityEvents } from "@/components/porch/city-events";
import {
  answerEvent,
  decideStay,
  dropEvent,
  dropHotel,
  dropRoom,
  dropTravel,
  eventHotels,
  guestBoard,
  guestListPdf,
  listEvents,
  saveEvent,
  saveHotel,
  saveRoom,
  saveTravel,
  type Guest,
  type Hotel,
  type PorchEvent,
  type Room,
  type Rsvp,
} from "@/lib/porch/events";

/** Events: what's coming, who's attending, travel and stay, and the teams' guest board. */

function day(value: string, year = false) {
  if (!value) return "";
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}
function dates(e: PorchEvent) {
  return e.endsOn && e.endsOn !== e.startsOn ? `${day(e.startsOn)} – ${day(e.endsOn, true)}` : day(e.startsOn, true);
}
function clock(value: string) {
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return value;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
function when(value: string) {
  if (!value) return "";
  const [d, t] = value.split("T");
  return `${day(d)} · ${clock(t ?? "")}`;
}
function money(room: Room) {
  const amount = room.currency === "USD" ? room.price.toLocaleString("en-US") : room.price.toLocaleString("en-US");
  return `${room.currency} ${amount} / ${room.per === "person" ? "person" : "night"}`;
}
const KIND: Record<string, string> = { single: "Single", double: "Double", shared: "Shared" };

async function shrinkPicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const out = canvas.toDataURL("image/jpeg", q);
      if (out.length <= 680_000) return out;
    }
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

function savePdf(pdf: string, filename: string) {
  const host = window as Window & { PorchApp?: { saveFile?: (name: string, data: string) => void } };
  if (typeof host.PorchApp?.saveFile === "function") {
    host.PorchApp.saveFile(filename, pdf);
    return;
  }
  const binary = atob(pdf);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    void navigator.share({ files: [file], title: filename }).catch(() => undefined);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

const EVENTS_CACHE = "porch-events-v1";
type EventsPage = { events: PorchEvent[]; founder: boolean; board: boolean };
function cachedEvents(): EventsPage | null {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_CACHE) ?? "null") as EventsPage | null;
  } catch {
    return null;
  }
}

export function EventsHome() {
  // Opens with the list from last time (instantly), then quietly brings it up to date.
  const [events, setEvents] = useState<PorchEvent[] | null>(() => (typeof window === "undefined" ? null : (cachedEvents()?.events ?? null)));
  const [founder, setFounder] = useState(() => (typeof window === "undefined" ? false : (cachedEvents()?.founder ?? false)));
  const [board, setBoard] = useState(() => (typeof window === "undefined" ? false : (cachedEvents()?.board ?? false)));
  const [adding, setAdding] = useState(false);
  const [screenVideos, setScreenVideos] = useState(false);
  useBackLayer(adding, () => setAdding(false), "events:add");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancel = false;
    listEvents()
      .then((result) => {
        if (cancel) return;
        setEvents(result.events);
        setFounder(result.founder);
        setBoard(result.board);
        try {
          localStorage.setItem(EVENTS_CACHE, JSON.stringify(result));
        } catch {
          /* shown anyway */
        }
      })
      .catch(() => setEvents([]));
    return () => {
      cancel = true;
    };
  }, [tick]);
  const reload = () => setTick((n) => n + 1);

  return (
    <section className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4">
      <h2 className="font-display text-3xl text-ink"><W k="events.title">Events</W></h2>
      <p className="mt-1 text-sm text-muted"><W k="events.intro">What's coming in our ministry. Event videos also play on the porch guy's screen.</W></p>
      {founder ? (
        adding ? (
          <EventForm event={null} onDone={(changed) => (setAdding(false), changed ? reload() : undefined)} />
        ) : (
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => setAdding(true)}>
            + Add an event
          </button>
        )
      ) : null}
      {events === null ? <p className="mt-4 text-sm text-muted">Opening events…</p> : null}
      {events?.length === 0 ? <p className="mt-4 text-sm text-muted"><W k="events.none">No events yet.</W></p> : null}
      {events?.map((event) => (
        <EventCard key={event.id} event={event} founder={founder} board={board} onChange={reload} />
      ))}
      {founder ? (
        <div className="ev-card">
          <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setScreenVideos((v) => !v)}>
            {screenVideos ? "Hide" : "Videos on the porch guy's screen"}
          </button>
          {screenVideos ? <CityEvents open /> : null}
        </div>
      ) : null}
    </section>
  );
}

function EventForm({ event, onDone }: { event: PorchEvent | null; onDone: (changed: boolean) => void }) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? "");
  const [venue, setVenue] = useState(event?.venue ?? "");
  const [gates, setGates] = useState(event?.gates ?? "");
  const [about, setAbout] = useState(event?.about ?? "");
  const [flyer, setFlyer] = useState(event?.flyer ?? "");
  const [flyerChanged, setFlyerChanged] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    const small = await shrinkPicture(file).catch(() => "");
    if (!small) {
      setNote("Couldn't use that picture. Try another.");
      return;
    }
    setFlyer(small);
    setFlyerChanged(true);
  }
  async function save() {
    setBusy(true);
    setNote("");
    const result = await saveEvent({
      data: { id: event?.id ?? 0, title, startsOn, endsOn, venue, gates, about, flyer: flyerChanged ? flyer : "", keepFlyer: Boolean(event) && !flyerChanged },
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save. Try again.");
      return;
    }
    onDone(true);
  }
  return (
    <div className="ev-form">
      <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Event name" />
      <div className="ev-two">
        <label>
          Starts
          <input className={fieldClass} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label>
          Ends (optional)
          <input className={fieldClass} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      </div>
      <div className="ev-two">
        <input className={fieldClass} value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={100} placeholder="Venue" />
        <label>
          Gates open
          <input className={fieldClass} type="time" value={gates} onChange={(e) => setGates(e.target.value)} />
        </label>
      </div>
      <textarea className={fieldClass} rows={4} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={1500} placeholder="About the event" />
      <label className="ev-file">
        {flyer ? "Change the flyer" : "Add a flyer (picture)"}
        <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {flyer ? <img src={flyer} alt="" className="ev-flyer" /> : null}
      <div className="ev-row">
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void save()}>
          {event ? "Save event" : "Add event"}
        </button>
        <button type="button" className={quietButtonClass} onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
      {note ? <p className="ev-note">{note}</p> : null}
    </div>
  );
}

function EventCard({ event, founder, board, onChange }: { event: PorchEvent; founder: boolean; board: boolean; onChange: () => void }) {
  const [mine, setMine] = useState<Rsvp>(event.mine);
  useEffect(() => setMine(event.mine), [event.mine]);
  const [more, setMore] = useState(false);
  const [panel, setPanel] = useState<"" | "travel" | "edit" | "hotels" | "board">("");
  const toggle = (next: typeof panel) => setPanel((current) => (current === next ? "" : next));
  useBackLayer(panel !== "", () => setPanel(""), `events:${event.id}:${panel}`);

  async function answer(next: Rsvp) {
    setMine(next);
    await answerEvent({ data: { eventId: event.id, answer: next } }).catch(() => undefined);
  }
  async function remove() {
    if (!window.confirm(`Remove "${event.title}"?`)) return;
    await dropEvent({ data: { id: event.id } }).catch(() => undefined);
    onChange();
  }
  if (panel === "edit") return <EventForm event={event} onDone={(changed) => (setPanel(""), changed ? onChange() : undefined)} />;
  const yes = event.yes - (event.mine === "yes" ? 1 : 0) + (mine === "yes" ? 1 : 0);
  const maybe = event.maybe - (event.mine === "maybe" ? 1 : 0) + (mine === "maybe" ? 1 : 0);
  return (
    <article className={`ev-card${event.past ? " is-past" : ""}`}>
      {event.flyer ? <img src={event.flyer} alt="" className="ev-flyer" loading="lazy" decoding="async" /> : null}
      <h3>{event.title}</h3>
      <p className="ev-m">
        {dates(event)}
        {event.venue ? ` · ${event.venue}` : ""}
      </p>
      {event.gates ? <p className="ev-m">Gates open {clock(event.gates)}</p> : null}
      {event.about ? (
        <p className={`ev-about${more ? " is-open" : ""}`} onClick={() => setMore((v) => !v)}>
          {event.about}
        </p>
      ) : null}
      {event.past ? (
        <p className="ev-mut"><W k="events.passed">This event has passed.</W></p>
      ) : (
        <>
          <p className="ev-lbl"><W k="events.attending">Are you attending?</W></p>
          <div className="ev-seg">
            {(["yes", "maybe", "no"] as const).map((item) => (
              <button key={item} type="button" className={mine === item ? "is-on" : ""} onClick={() => void answer(item)}>
                {item === "yes" ? <W k="events.yes">Yes</W> : item === "maybe" ? <W k="events.maybe">Maybe</W> : <W k="events.no">No</W>}
              </button>
            ))}
          </div>
          <p className="ev-mut">
            <W k="events.counts" vars={{ yes: yes.toLocaleString(), maybe: maybe.toLocaleString() }}>{"{yes} yes · {maybe} maybe"}</W>
          </p>
          <button type="button" className="ev-travel-btn" onClick={() => toggle("travel")}>
            {event.travel ? <W k="events.your-travel">Your travel & stay</W> : <W k="events.plan-travel">Travelling to it? Plan travel & stay</W>} {panel === "travel" ? "▴" : "→"}
          </button>
          {event.travel && panel !== "travel" ? <StayLine travel={event.travel} /> : null}
          <p className="ev-mut"><W k="events.local-bus">Local bus from your stage? Use Transport.</W></p>
        </>
      )}
      {panel === "travel" ? <TravelPanel event={event} onSaved={onChange} /> : null}
      {founder || board ? (
        <div className="ev-tools">
          {founder ? (
            <>
              <button type="button" onClick={() => toggle("edit")}>
                Edit
              </button>
              <button type="button" onClick={() => toggle("hotels")}>
                Hotels & rooms
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => toggle("board")}>
            Guest board
          </button>
          {founder ? (
            <button type="button" className="ev-danger" onClick={() => void remove()}>
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
      {panel === "hotels" ? <HotelManager eventId={event.id} /> : null}
      {panel === "board" ? <GuestBoard event={event} /> : null}
    </article>
  );
}

function StayLine({ travel }: { travel: NonNullable<PorchEvent["travel"]> }) {
  const text =
    travel.stay === "approved" ? (
      <W k="stay.approved">✓ Your room is approved.</W>
    ) : travel.stay === "requested" ? (
      <W k="stay.requested">Your room is waiting for Hospitality to approve.</W>
    ) : travel.stay === "declined" ? (
      <W k="stay.declined">Your room wasn't approved. Choose another.</W>
    ) : travel.otherHotel ? (
      <W k="stay.other" vars={{ hotel: travel.otherHotel }}>{"Staying at {hotel}."}</W>
    ) : (
      <W k="stay.saved">Travel saved.</W>
    );
  return <p className={`ev-stay is-${travel.stay}`}>{text}</p>;
}

function TravelPanel({ event, onSaved }: { event: PorchEvent; onSaved: () => void }) {
  const t = event.travel;
  const [origin, setOrigin] = useState<"uganda" | "abroad">(t?.origin ?? "uganda");
  const [fromPlace, setFromPlace] = useState(t?.fromPlace ?? "");
  const [arriveAt, setArriveAt] = useState(t?.arriveAt ?? "");
  const [arriveFlight, setArriveFlight] = useState(t?.arriveFlight ?? "");
  const [leaveAt, setLeaveAt] = useState(t?.leaveAt ?? "");
  const [leaveFlight, setLeaveFlight] = useState(t?.leaveFlight ?? "");
  const [pickup, setPickup] = useState(t?.pickup ?? false);
  const [party, setParty] = useState(String(t?.party ?? 1));
  const [roomId, setRoomId] = useState(t && t.stay !== "declined" ? t.roomId : 0);
  const [otherHotel, setOtherHotel] = useState(t?.otherHotel ?? "");
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const hintFromAbroad = useWord("travel.from-hint-abroad", "Coming from, e.g. Nairobi, Kenya");
  const hintFromUganda = useWord("travel.from-hint-uganda", "Coming from, e.g. Mbarara");
  const hintArrive = useWord("travel.arrive-flight-hint", "Arrival flight, e.g. KQ 412");
  const hintLeave = useWord("travel.leave-flight-hint", "Departure flight");
  const hintHotel = useWord("stay.another-hint", "Name of the hotel");
  const savedRequested = useWord("travel.saved-requested", "Saved. Your room is waiting for Hospitality to approve.");
  const savedPlain = useWord("travel.saved", "Saved.");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    eventHotels({ data: { eventId: event.id } })
      .then((result) => setHotels(result.hotels))
      .catch(() => undefined);
  }, [event.id]);

  // Dates that can't be right: leaving before arriving, or a date already gone (when changed).
  const nowStamp = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const datesWrong =
    Boolean(arriveAt && leaveAt && leaveAt <= arriveAt) ||
    Boolean(arriveAt && arriveAt !== (t?.arriveAt ?? "") && arriveAt.slice(0, 10) < nowStamp.slice(0, 10)) ||
    Boolean(leaveAt && leaveAt !== (t?.leaveAt ?? "") && leaveAt.slice(0, 10) < nowStamp.slice(0, 10));
  const datesNote = useWord("travel.dates-wrong", "There's an error in your dates entry. Please check it.");

  async function save() {
    if (datesWrong) {
      setNote(datesNote);
      return;
    }
    setBusy(true);
    setNote("");
    const result = await saveTravel({
      data: { eventId: event.id, origin, fromPlace, arriveAt, arriveFlight: origin === "abroad" ? arriveFlight : "", leaveAt, leaveFlight: origin === "abroad" ? leaveFlight : "", pickup: origin === "abroad" && pickup, party: Number(party) || 1, roomId, otherHotel },
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save. Try again.");
      return;
    }
    setNote(result.stay === "requested" ? savedRequested : savedPlain);
    onSaved();
  }
  async function notTravelling() {
    await dropTravel({ data: { eventId: event.id } }).catch(() => undefined);
    onSaved();
  }

  return (
    <div className="ev-form">
      <p className="ev-head"><W k="travel.title">Your travel</W></p>
      <div className="ev-seg">
        <button type="button" className={origin === "uganda" ? "is-on" : ""} onClick={() => setOrigin("uganda")}>
          <W k="travel.from-uganda">From Uganda</W>
        </button>
        <button type="button" className={origin === "abroad" ? "is-on" : ""} onClick={() => setOrigin("abroad")}>
          <W k="travel.from-abroad">From abroad</W>
        </button>
      </div>
      <input className={fieldClass} value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} maxLength={80} placeholder={origin === "abroad" ? hintFromAbroad : hintFromUganda} />
      <WHint k="travel.from-hint-abroad">Coming from, e.g. Nairobi, Kenya</WHint>
      <WHint k="travel.from-hint-uganda">Coming from, e.g. Mbarara</WHint>
      <label>
        <W k="travel.arriving">Arriving</W>
        <input className={fieldClass} type="datetime-local" value={arriveAt} onChange={(e) => setArriveAt(e.target.value)} />
      </label>
      {origin === "abroad" ? <input className={fieldClass} value={arriveFlight} onChange={(e) => setArriveFlight(e.target.value)} maxLength={20} placeholder={hintArrive} /> : null}
      <label>
        <W k="travel.leaving">Leaving</W>
        <input className={fieldClass} type="datetime-local" value={leaveAt} onChange={(e) => setLeaveAt(e.target.value)} />
      </label>
      {datesWrong ? (
        <p className="text-sm font-semibold text-[#f8a018]" role="alert">
          {datesNote}
        </p>
      ) : null}
      {origin === "abroad" ? (
        <>
          <input className={fieldClass} value={leaveFlight} onChange={(e) => setLeaveFlight(e.target.value)} maxLength={20} placeholder={hintLeave} />
          <p className="ev-lbl"><W k="travel.pickup">Airport pickup (Entebbe)?</W></p>
          <div className="ev-seg">
            <button type="button" className={pickup ? "is-on" : ""} onClick={() => setPickup(true)}>
              <W k="travel.pickup-yes">Yes, pick me up</W>
            </button>
            <button type="button" className={!pickup ? "is-on" : ""} onClick={() => setPickup(false)}>
              No
            </button>
          </div>
        </>
      ) : null}
      <label>
        <W k="travel.party">People with you, counting yourself</W>
        <input className={fieldClass} value={party} onChange={(e) => setParty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={2} />
      </label>

      <p className="ev-head"><W k="stay.title">Where you'll stay</W></p>
      {hotels.length === 0 ? <p className="ev-mut"><W k="stay.none">Hospitality hasn't listed hotels yet. You can name your own below.</W></p> : null}
      {hotels.map((hotel) => (
        <div key={hotel.id} className="ev-hotel">
          <b>{hotel.name}</b>
          {hotel.note ? <p className="ev-mut">{hotel.note}</p> : null}
          {hotel.rooms.map((room) => {
            const chosen = roomId === room.id;
            const blocked = room.full && !(t?.roomId === room.id && t.stay === "approved");
            return (
              <div key={room.id} className="ev-room">
                <span>{KIND[room.kind]}</span>
                <span>{money(room)}</span>
                {chosen ? (
                  <button type="button" className="is-chosen" onClick={() => setRoomId(0)}>
                    <W k="stay.chosen">Chosen ✓</W>
                  </button>
                ) : blocked ? (
                  <span className="ev-full">FULL</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRoomId(room.id);
                      setOtherHotel("");
                    }}
                  >
                    <W k="stay.choose">Choose</W>
                  </button>
                )}
              </div>
            );
          })}
          {hotel.packages ? <p className="ev-pk">{hotel.packages}</p> : null}
        </div>
      ))}
      <label>
        <W k="stay.another">Or another hotel</W>
        <input
          className={fieldClass}
          value={otherHotel}
          onChange={(e) => {
            setOtherHotel(e.target.value);
            if (e.target.value) setRoomId(0);
          }}
          maxLength={80}
          placeholder={hintHotel}
        />
      </label>
      {t ? <StayLine travel={t} /> : null}
      <div className="ev-row">
        <button type="button" className={primaryButtonClass} disabled={busy || datesWrong} onClick={() => void save()}>
          <W k="travel.save">Save my travel & stay</W>
        </button>
        {t ? (
          <button type="button" className={quietButtonClass} onClick={() => void notTravelling()}>
            <W k="travel.not-travelling">I'm not travelling</W>
          </button>
        ) : null}
      </div>
      <p className="ev-mut"><W k="travel.payment">Payment to Phaneroo Ministries' account will be added once the app is approved.</W></p>
      {note ? <p className="ev-note">{note}</p> : null}
    </div>
  );
}

function HotelManager({ eventId }: { eventId: number }) {
  const [hotels, setHotels] = useState<Hotel[] | null>(null);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    eventHotels({ data: { eventId } })
      .then((result) => setHotels(result.hotels))
      .catch(() => setHotels([]));
  }, [eventId, tick]);
  const reload = () => setTick((n) => n + 1);
  async function addHotel() {
    const result = await saveHotel({ data: { eventId, name } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save.");
      return;
    }
    setName("");
    setNote("");
    reload();
  }
  return (
    <div className="ev-form">
      <p className="ev-head"><W k="hotels.title">Hotels & rooms</W></p>
      {hotels?.map((hotel) => (
        <HotelEditor key={`${hotel.id}-${tick}`} hotel={hotel} eventId={eventId} onChange={reload} />
      ))}
      <div className="ev-row">
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="New hotel's name" />
        <button type="button" className={primaryButtonClass} disabled={!name.trim()} onClick={() => void addHotel()}>
          Add hotel
        </button>
      </div>
      {note ? <p className="ev-note">{note}</p> : null}
    </div>
  );
}

function HotelEditor({ hotel, eventId, onChange }: { hotel: Hotel; eventId: number; onChange: () => void }) {
  const [name, setName] = useState(hotel.name);
  const [note, setNote] = useState(hotel.note);
  const [packages, setPackages] = useState(hotel.packages);
  const [msg, setMsg] = useState("");
  async function save() {
    const result = await saveHotel({ data: { id: hotel.id, eventId, name, note, packages } }).catch(() => null);
    setMsg(result?.ok ? "Saved." : (result?.error ?? "That didn't save."));
    if (result?.ok) onChange();
  }
  async function remove() {
    if (!window.confirm(`Remove ${hotel.name}?`)) return;
    await dropHotel({ data: { id: hotel.id } }).catch(() => undefined);
    onChange();
  }
  return (
    <div className="ev-hotel">
      <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Hotel name" />
      <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="A short note, e.g. 20 min to the venue" />
      <textarea className={fieldClass} rows={2} value={packages} onChange={(e) => setPackages(e.target.value)} maxLength={400} placeholder="Packages, e.g. 3 nights + breakfast + airport pickup — UGX 1,200,000" />
      {hotel.rooms.map((room) => (
        <RoomEditor key={room.id} room={room} hotelId={hotel.id} onChange={onChange} />
      ))}
      <RoomEditor room={null} hotelId={hotel.id} onChange={onChange} />
      <div className="ev-row">
        <button type="button" className={quietButtonClass} onClick={() => void save()}>
          Save hotel
        </button>
        <button type="button" className={`${quietButtonClass} ev-danger`} onClick={() => void remove()}>
          Remove hotel
        </button>
      </div>
      {msg ? <p className="ev-note">{msg}</p> : null}
    </div>
  );
}

function RoomEditor({ room, hotelId, onChange }: { room: Room | null; hotelId: number; onChange: () => void }) {
  const [kind, setKind] = useState(room?.kind ?? "single");
  const [price, setPrice] = useState(room ? String(room.price) : "");
  const [currency, setCurrency] = useState(room?.currency ?? "UGX");
  const [per, setPer] = useState(room?.per ?? "night");
  const [available, setAvailable] = useState(room ? String(room.available) : "");
  async function save() {
    const result = await saveRoom({ data: { id: room?.id ?? 0, hotelId, kind, price: Number(price) || 0, currency, per, available: Number(available) || 0 } }).catch(() => null);
    if (result?.ok) onChange();
  }
  async function remove() {
    if (!room) return;
    await dropRoom({ data: { id: room.id } }).catch(() => undefined);
    onChange();
  }
  return (
    <div className="ev-roomedit">
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Room type">
        <option value="single">Single</option>
        <option value="double">Double</option>
        <option value="shared">Shared</option>
      </select>
      <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} aria-label="Currency">
        <option value="UGX">UGX</option>
        <option value="USD">USD</option>
      </select>
      <input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Price" aria-label="Price" />
      <select value={per} onChange={(e) => setPer(e.target.value as typeof per)} aria-label="Price per">
        <option value="night">/ night</option>
        <option value="person">/ person</option>
      </select>
      <input value={available} onChange={(e) => setAvailable(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="How many" aria-label="How many rooms" />
      <button type="button" onClick={() => void save()}>
        {room ? "Save" : "+ Room"}
      </button>
      {room ? (
        <>
          <span className={room.full ? "ev-full" : "ev-mut"}>
            {room.taken}/{room.available}
            {room.full ? " FULL" : ""}
          </span>
          <button type="button" aria-label="Remove room" onClick={() => void remove()}>
            ✕
          </button>
        </>
      ) : null}
    </div>
  );
}

function GuestBoard({ event }: { event: PorchEvent }) {
  const [data, setData] = useState<{ approve: boolean; yes: number; maybe: number; hotels: Hotel[]; guests: Guest[] } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    guestBoard({ data: { eventId: event.id } })
      .then((result) => (result.ok ? setData(result) : setError(result.error)))
      .catch(() => setError("Couldn't load the guest board."));
  }, [event.id, tick]);
  const byDay = useMemo(() => {
    const groups = new Map<string, Guest[]>();
    for (const g of data?.guests ?? []) {
      const d = g.travel.arriveAt.split("T")[0] || "";
      groups.set(d, [...(groups.get(d) ?? []), g]);
    }
    return [...groups.entries()];
  }, [data]);
  async function decide(g: Guest, approve: boolean) {
    const result = await decideStay({ data: { eventId: event.id, userId: g.userId, approve } }).catch(() => null);
    if (!result?.ok) setError(result?.error ?? "That didn't go through.");
    setTick((n) => n + 1);
  }
  async function pdf() {
    const result = await guestListPdf({ data: { eventId: event.id } }).catch(() => null);
    if (result?.ok) savePdf(result.pdf, result.filename);
    else setError(result?.error ?? "Couldn't make the list.");
  }
  if (error) return <p className="ev-note">{error}</p>;
  if (!data) return <p className="ev-mut">Opening the guest board…</p>;
  const travelling = data.guests.reduce((sum, g) => sum + g.travel.party, 0);
  const pickups = data.guests.filter((g) => g.travel.pickup).reduce((sum, g) => sum + g.travel.party, 0);
  const waiting = data.guests.filter((g) => g.travel.stay === "requested");
  return (
    <div className="ev-form">
      <p className="ev-head"><W k="board.title">Guest board</W></p>
      <div className="ev-stats">
        <div>
          <b>{data.yes.toLocaleString()}</b>
          <span>attending</span>
        </div>
        <div>
          <b>{travelling}</b>
          <span>travelling</span>
        </div>
        <div>
          <b>{pickups}</b>
          <span>airport pickups</span>
        </div>
      </div>
      {waiting.length ? (
        <>
          <p className="ev-lbl">Rooms waiting for approval · {waiting.length}</p>
          {waiting.map((g) => (
            <div key={g.userId} className="ev-li">
              <span>
                {g.name}
                {g.travel.party > 1 ? ` +${g.travel.party - 1}` : ""} · {g.hotel} · {KIND[g.room] ?? g.room}
              </span>
              {data.approve ? (
                <span className="ev-acts">
                  <button type="button" className="is-ok" onClick={() => void decide(g, true)}>
                    Approve
                  </button>
                  <button type="button" onClick={() => void decide(g, false)}>
                    Decline
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
      {byDay.map(([d, guests]) => (
        <div key={d}>
          <p className="ev-lbl">Arrivals · {day(d) || "No date"}</p>
          {guests.map((g) => (
            <div key={g.userId} className="ev-li">
              <span>
                {clock(g.travel.arriveAt.split("T")[1] ?? "")} · {g.travel.arriveFlight || (g.travel.origin === "uganda" ? "Road" : "")} · {g.name}
                {g.travel.party > 1 ? ` +${g.travel.party - 1}` : ""} · from {g.travel.fromPlace}
                {g.hotel ? ` · ${g.hotel}` : ""}
                {g.travel.stay === "approved" ? " ✓" : ""}
              </span>
              {g.travel.pickup ? <span className="ev-tag">PICKUP</span> : null}
            </div>
          ))}
        </div>
      ))}
      <p className="ev-lbl">Hotels</p>
      {data.hotels.map((h) => (
        <div key={h.id} className="ev-li">
          <span>{h.name}</span>
          <span>
            {h.rooms.map((r) => `${KIND[r.kind]} ${r.taken}/${r.available}${r.full ? " FULL" : ""}`).join(" · ") || "No rooms"}
          </span>
        </div>
      ))}
      {data.guests.some((g) => g.hotel && !g.room) ? (
        <div className="ev-li">
          <span>Other hotels</span>
          <span>{data.guests.filter((g) => g.hotel && !g.room).length} guests</span>
        </div>
      ) : null}
      <button type="button" className={`${quietButtonClass} ev-wide`} onClick={() => void pdf()}>
        Download guest list (PDF)
      </button>
    </div>
  );
}
