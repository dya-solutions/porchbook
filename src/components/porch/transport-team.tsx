import { useBackLayer } from "@/lib/porch/back-stack";
import { W, WHint, useWord } from "@/components/porch/words";
import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { Avatar, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { askNews, listPeople, seenAskNews } from "@/lib/porch/api";
import {
  clock,
  dropTransportBus,
  listTransportTeam,
  loadTransportBoard,
  rideNews,
  saveTransportBus,
  saveTransportEvent,
  seenRideNews,
  sendTransportBus,
  setTransportStop,
  setTransportTeam,
  type BoardBus,
  type BoardStage,
  type MyRide,
  type TransportEvent,
} from "@/lib/porch/transport-board";

type Board = {
  founder: boolean;
  event: TransportEvent;
  buses: BoardBus[];
  stages: BoardStage[];
  people: { name: string; place: string; phone: string; rideBack: boolean }[];
};

/** What a traveller sees once the Transport team has confirmed their bus. */
export function RideCard({ ride, eventLine }: { ride: MyRide; eventLine: string }) {
  return (
    <div className="ride-card">
      <p className="ride-ok">✓ <W k="ride.confirmed">YOUR RIDE IS CONFIRMED</W></p>
      <p className="ride-bus">
        {ride.busName}
        {ride.plate ? ` · ${ride.plate}` : ""}
      </p>
      <p>
        <W k="ride.be-at" vars={{ stage: ride.stage, time: ride.pickup }}>{"Be at {stage} by {time}"}</W>
      </p>
      <p>
        <W k="ride.driver" vars={{ driver: ride.driver }}>{"Driver: {driver}"}</W> ·{" "}
        <a href={`tel:${ride.driverPhone.replace(/[^\d+]/g, "")}`} className="ride-call">
          {ride.driverPhone}
        </a>
      </p>
      {eventLine ? <p>{eventLine}</p> : null}
      <p>{ride.rideBack ? <W k="ride.back">The same bus brings you back.</W> : <W k="ride.own-way">You have your own way back.</W>}</p>
      {ride.note ? <p className="ride-note">{ride.note}</p> : null}
    </div>
  );
}

/** The porch guy tells a traveller once when the team confirms (or changes) their ride. */
export function RideNews() {
  const user = useCurrentUser();
  const [ride, setRide] = useState<MyRide | null>(null);
  useBackLayer(Boolean(ride), () => {
    setRide(null);
    void seenRideNews().catch(() => undefined);
  }, "ride-news");
  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    rideNews()
      .then((result) => {
        if (!cancel) setRide(result.ride);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id]);
  if (!ride) return null;
  function close() {
    setRide(null);
    void seenRideNews().catch(() => undefined);
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
      <div className="w-full max-w-md rounded-2xl glass-edge bg-card p-4">
        <div className="flex items-start gap-3">
          <img src="/speaker.png" alt="" className="size-16 shrink-0 rounded-full object-cover object-[72%_18%]" draggable={false} />
          <div className="min-w-0">
            <p className="text-sm text-ink">
              <W k="ride.news" vars={{ bus: ride.busName, stage: ride.stage, time: ride.pickup, driver: ride.driver, phone: ride.driverPhone }}>{"Your ride is confirmed. {bus}, at {stage} by {time}. Driver: {driver}, {phone}."}</W>
            </p>
            {ride.note ? <p className="mt-1 text-sm text-ink">{ride.note}</p> : null}
            <button type="button" className={`${quietButtonClass} mt-2 px-0`} onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventForm({ event, onSaved }: { event: TransportEvent; onSaved: () => void }) {
  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.date);
  const [pickup, setPickup] = useState(event.pickup);
  const [gates, setGates] = useState(event.gates);
  const [phone, setPhone] = useState(event.phone);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(fresh: boolean) {
    if (fresh && !window.confirm(`Start a new event "${name}"? Its list starts empty; the last event's list stays in its PDF.`)) return;
    setBusy(true);
    setNote("");
    const result = await saveTransportEvent({ data: { fresh, name, date, pickup, gates, phone } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save. Try again.");
      return;
    }
    setNote(fresh ? "New event started." : "Saved.");
    onSaved();
  }

  return (
    <div className="tt-card">
      <h3>This event</h3>
      <label className="tt-lbl">Event</label>
      <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Phaneroo Anniversary 2026" />
      <label className="tt-lbl">Date</label>
      <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="tt-two">
        <div>
          <label className="tt-lbl">Pickup</label>
          <input className={fieldClass} type="time" value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </div>
        <div>
          <label className="tt-lbl">Gates open</label>
          <input className={fieldClass} type="time" value={gates} onChange={(e) => setGates(e.target.value)} />
        </div>
      </div>
      <label className="tt-lbl">Transport phone</label>
      <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={24} placeholder="+256…" />
      <p className="tt-hint">Registration closes at midnight before the event day.</p>
      <div className="tt-row">
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void save(false)}>
          Save event
        </button>
        <button type="button" className={quietButtonClass} disabled={busy} onClick={() => void save(true)}>
          Start a new event
        </button>
      </div>
      {note ? <p className="tt-note">{note}</p> : null}
    </div>
  );
}

/** The founder chooses who is on the Transport team. */
function TeamPicker() {
  const user = useCurrentUser();
  const [people, setPeople] = useState<{ userId: string; displayName: string; imageUrl: string | null }[]>([]);
  const [team, setTeam] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  useEffect(() => {
    const seed = { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: user?.profileImageUrl ?? null };
    Promise.all([listPeople({ data: seed }), listTransportTeam()])
      .then(([list, current]) => {
        setPeople(list.people.map((p) => ({ userId: p.userId, displayName: p.displayName, imageUrl: p.imageUrl ?? null })));
        setTeam(new Set(current.ids));
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(userId: string) {
    const on = !team.has(userId);
    const result = await setTransportTeam({ data: { userId, on } }).catch(() => null);
    if (!result?.ok) return;
    setTeam((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }
  const needle = query.trim().toLowerCase();
  const found = needle ? people.filter((p) => !team.has(p.userId) && p.displayName.toLowerCase().includes(needle)).slice(0, 8) : [];
  return (
    <div className="tt-card">
      <h3>Transport team</h3>
      <p className="tt-hint">They see the list, the buses and the PDF, and confirm travellers.</p>
      <div className="tt-chips">
        {people
          .filter((p) => team.has(p.userId))
          .map((p) => (
            <button key={p.userId} type="button" className="tt-chip" onClick={() => void toggle(p.userId)}>
              {p.displayName} ✕
            </button>
          ))}
      </div>
      <input className={`${fieldClass} mt-2`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add someone: type a name" />
      {found.map((p) => (
        <button key={p.userId} type="button" className="tt-person" onClick={() => void toggle(p.userId).then(() => setQuery(""))}>
          <Avatar name={p.displayName} imageUrl={p.imageUrl} size="sm" />
          <span>{p.displayName}</span>
          <b>Add</b>
        </button>
      ))}
    </div>
  );
}

function BusForm({ bus, onDone }: { bus: BoardBus | null; onDone: (changed: boolean) => void }) {
  const [name, setName] = useState(bus?.name ?? "");
  const [plate, setPlate] = useState(bus?.plate ?? "");
  const [driver, setDriver] = useState(bus?.driver ?? "");
  const [driverPhone, setDriverPhone] = useState(bus?.driverPhone ?? "");
  const [seats, setSeats] = useState(bus?.seats ? String(bus.seats) : "");
  const [note, setNote] = useState("");
  async function save() {
    const result = await saveTransportBus({ data: { id: bus?.id ?? 0, name, plate, driver, driverPhone, seats: Number(seats) || 0 } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save. Try again.");
      return;
    }
    onDone(true);
  }
  async function drop() {
    if (!bus || !window.confirm(`Remove ${bus.name}?`)) return;
    const result = await dropTransportBus({ data: { id: bus.id } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't remove it.");
      return;
    }
    onDone(true);
  }
  return (
    <div className="tt-form">
      <div className="tt-two">
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Bus 1" />
        <input className={fieldClass} value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} placeholder="Plate, e.g. UBA 123X" />
      </div>
      <div className="tt-two">
        <input className={fieldClass} value={driver} onChange={(e) => setDriver(e.target.value)} maxLength={60} placeholder="Driver's name" />
        <input className={fieldClass} value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} maxLength={24} inputMode="tel" placeholder="Driver's phone" />
      </div>
      <input className={fieldClass} value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={3} placeholder="Seats" />
      <div className="tt-row">
        <button type="button" className={primaryButtonClass} onClick={() => void save()}>
          {bus ? "Save bus" : "Add bus"}
        </button>
        <button type="button" className={quietButtonClass} onClick={() => onDone(false)}>
          Cancel
        </button>
        {bus ? (
          <button type="button" className={`${quietButtonClass} tt-danger`} onClick={() => void drop()}>
            Remove
          </button>
        ) : null}
      </div>
      {note ? <p className="tt-note">{note}</p> : null}
    </div>
  );
}

function BusCard({ bus, onChange }: { bus: BoardBus; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [line, setLine] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function setTime(stage: string, pickup: string) {
    const result = await setTransportStop({ data: { stage, busId: bus.id, pickup } }).catch(() => null);
    if (!result?.ok) setNote(result?.error ?? "That didn't save.");
    onChange();
  }
  async function takeOff(stage: string) {
    await setTransportStop({ data: { stage, busId: 0 } }).catch(() => null);
    onChange();
  }
  async function send() {
    setBusy(true);
    setNote("");
    const result = await sendTransportBus({ data: { id: bus.id, note: line } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    setLine("");
    setNote(`Sent to ${result.sent}.`);
    onChange();
  }

  if (editing) return <BusForm bus={bus} onDone={(changed) => (setEditing(false), changed ? onChange() : undefined)} />;
  const untimed = bus.stops.find((stop) => !stop.pickup);
  const needsSend = !bus.sent || bus.changed;
  return (
    <div className="tt-bus">
      <div className="tt-bus-head">
        <b>
          {bus.name}
          {bus.plate ? ` · ${bus.plate}` : ""}
        </b>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      <p>
        Driver: {bus.driver} · {bus.driverPhone}
      </p>
      <p className="tt-mut">
        {bus.riders}
        {bus.seats ? ` of ${bus.seats} seats` : " travellers"}
        {bus.seats && bus.riders > bus.seats ? " · over the seats!" : ""}
      </p>
      {bus.stops.length === 0 ? <p className="tt-mut">No stages yet. Put stages on it from "Not on a bus yet".</p> : null}
      {bus.stops.map((stop) => (
        <div key={stop.stage} className="tt-stop">
          <input type="time" defaultValue={stop.pickup} aria-label={`Pickup time at ${stop.stage}`} onBlur={(e) => e.target.value !== stop.pickup && void setTime(stop.stage, e.target.value)} />
          <span className="min-w-0 flex-1 truncate">
            {stop.stage} · {stop.riders}
          </span>
          <button type="button" aria-label={`Take ${stop.stage} off this bus`} onClick={() => void takeOff(stop.stage)}>
            ✕
          </button>
        </div>
      ))}
      {bus.stops.length ? (
        needsSend ? (
          <div className="tt-send">
            {bus.sent ? <input className={fieldClass} value={line} onChange={(e) => setLine(e.target.value)} maxLength={160} placeholder="Add a line (optional), e.g. Bus 1 broke down, Bus 3 is coming." /> : null}
            <button type="button" className={`${primaryButtonClass} w-full`} disabled={busy || Boolean(untimed)} onClick={() => void send()}>
              {untimed ? `Give ${untimed.stage} a time first` : `${bus.sent ? "Send update" : "Send confirmations"} to ${bus.riders}`}
            </button>
          </div>
        ) : (
          <p className="tt-ok">✓ Confirmations sent</p>
        )
      ) : null}
      {note ? <p className="tt-note">{note}</p> : null}
    </div>
  );
}

/** The Transport team's panel inside Transport. */
export function TransportTeam({ onDownload, busy }: { onDownload: () => void; busy: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"buses" | "travellers">("buses");
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState("");
  const [placeBus, setPlaceBus] = useState(0);
  const [placeTime, setPlaceTime] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    loadTransportBoard()
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBoard(result);
      })
      .catch(() => setError("Couldn't load the board."));
    return () => {
      cancel = true;
    };
  }, [tick]);
  const reload = () => setTick((n) => n + 1);

  const loose = useMemo(() => board?.stages.filter((stage) => !stage.busId) ?? [], [board]);
  const byStage = useMemo(() => {
    const groups = new Map<string, Board["people"]>();
    for (const person of board?.people ?? []) groups.set(person.place, [...(groups.get(person.place) ?? []), person]);
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [board]);

  async function place() {
    if (!placing || !placeBus) return;
    await setTransportStop({ data: { stage: placing, busId: placeBus, pickup: placeTime } }).catch(() => null);
    setPlacing("");
    setPlaceTime("");
    reload();
  }

  if (error) return <p className="mt-4 text-sm text-muted">{error}</p>;
  if (!board) return <p className="mt-4 text-sm text-muted">Loading the board…</p>;
  const busName = (id: number) => board.buses.find((bus) => bus.id === id)?.name ?? "";
  return (
    <div className="tt">
      <p className="tt-title">For the Transport team</p>
      <EventForm key={`${board.event.id}-${board.event.name}-${board.event.date}`} event={board.event} onSaved={reload} />
      {board.founder ? <TeamPicker /> : null}
      <div className="tt-tabs">
        <button type="button" className={tab === "travellers" ? "is-on" : ""} onClick={() => setTab("travellers")}>
          Travellers · {board.people.length}
        </button>
        <button type="button" className={tab === "buses" ? "is-on" : ""} onClick={() => setTab("buses")}>
          Buses · {board.buses.length}
        </button>
      </div>
      {tab === "travellers" ? (
        <div>
          {byStage.length === 0 ? <p className="tt-mut">No one has registered for {board.event.name} yet.</p> : null}
          {byStage.map(([stage, people]) => {
            const onBus = board.stages.find((s) => s.stage === stage)?.busId ?? 0;
            return (
              <div key={stage} className="tt-group">
                <p className="tt-group-head">
                  {stage} · {people.length}
                  <span>{onBus ? busName(onBus) : "Not on a bus"}</span>
                </p>
                {people.map((person) => (
                  <p key={`${person.name}-${person.phone}`} className="tt-trav">
                    <span>
                      {person.name}
                      {person.rideBack ? "" : " · own way back"}
                    </span>
                    <span>{person.phone || "No number"}</span>
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {board.buses.map((bus) => (
            <BusCard key={`${bus.id}-${tick}`} bus={bus} onChange={reload} />
          ))}
          <div className="tt-bus tt-loose">
            <b>Not on a bus yet</b>
            {board.stages.length === 0 ? <p className="tt-mut">No travellers yet.</p> : loose.length === 0 ? <p className="tt-mut">Every stage is on a bus.</p> : <p className="tt-mut">Tap a stage, then choose its bus and pickup time.</p>}
            <div className="tt-chips">
              {loose.map((stage) => (
                <button key={stage.stage} type="button" className={`tt-chip${placing === stage.stage ? " is-on" : ""}`} onClick={() => setPlacing(placing === stage.stage ? "" : stage.stage)}>
                  {stage.stage} {stage.riders}
                </button>
              ))}
            </div>
            {placing ? (
              board.buses.length ? (
                <div className="tt-place">
                  <select className={fieldClass} value={placeBus} onChange={(e) => setPlaceBus(Number(e.target.value))}>
                    <option value={0}>Choose a bus</option>
                    {board.buses.map((bus) => (
                      <option key={bus.id} value={bus.id}>
                        {bus.name} · {bus.driver}
                      </option>
                    ))}
                  </select>
                  <input className={fieldClass} type="time" value={placeTime} onChange={(e) => setPlaceTime(e.target.value)} aria-label="Pickup time" />
                  <button type="button" className={primaryButtonClass} disabled={!placeBus} onClick={() => void place()}>
                    Put {placing} on the bus{placeTime ? ` at ${clock(placeTime)}` : ""}
                  </button>
                </div>
              ) : (
                <p className="tt-mut">Add a bus first.</p>
              )
            ) : null}
          </div>
          {adding ? (
            <BusForm bus={null} onDone={(changed) => (setAdding(false), changed ? reload() : undefined)} />
          ) : (
            <button type="button" className={`${quietButtonClass} tt-wide`} onClick={() => setAdding(true)}>
              + Add a bus
            </button>
          )}
        </div>
      )}
      <button type="button" className={`${quietButtonClass} tt-wide`} disabled={busy} onClick={onDownload}>
        Download PDF (one page per driver, then everyone)
      </button>
    </div>
  );
}

/** The porch guy tells someone once that a question was asked of them. */
export function AskNews() {
  const user = useCurrentUser();
  const [asks, setAsks] = useState<{ id: number; name: string }[]>([]);
  useBackLayer(asks.length > 0, () => {
    setAsks([]);
    void seenAskNews().catch(() => undefined);
  }, "ask-news");
  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    askNews()
      .then((result) => {
        if (!cancel) setAsks(result.asks);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id]);
  if (!asks.length) return null;
  function close() {
    setAsks([]);
    void seenAskNews().catch(() => undefined);
  }
  const names = [...new Set(asks.map((a) => a.name))];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
      <div className="w-full max-w-md rounded-2xl glass-edge bg-card p-4">
        <div className="flex items-start gap-3">
          <img src="/speaker.png" alt="" className="size-16 shrink-0 rounded-full object-cover object-[72%_18%]" draggable={false} />
          <div className="min-w-0">
            <p className="text-sm text-ink">
              {asks.length === 1 ? `${names[0]} asked you a question.` : `${names.join(", ")} asked you ${asks.length} questions.`}{" "}
              <W k="ask.news-where">You'll find it in Inquire on Home. Only you can answer.</W>
            </p>
            <button type="button" className={`${quietButtonClass} mt-2 px-0`} onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
