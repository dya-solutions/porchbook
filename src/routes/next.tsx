import { PeepHole } from "@/components/porch/peep-hole";
import { W, WHint, useWord } from "@/components/porch/words";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { tuneIn } from "@/lib/porch/fm-player";
import { placePart, takePart } from "@/lib/porch/place";
import { Building2, Bus, Calendar, MessageCircle, Phone, Users } from "lucide-react";
import { AppFrame } from "@/components/porch/frame";
import { PrayerSetter, pressPray, usePrayerOn } from "@/components/porch/prayer";
import { fieldClass, primaryButtonClass, quietButtonClass, ThemePlate } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { downloadMyTwenty, downloadOwnTwenty, loadMyTwenty, resetMyTwenty, saveMyTwenty, type TwentyRow } from "@/lib/porch/my20";
import { playButtonSound } from "@/lib/porch/button-sound-play";
import { ServeButton } from "@/components/porch/serve-form";
import { FmButton } from "@/components/porch/fm";
import { LightRow } from "@/components/porch/pb-shell";
import { shown } from "@/lib/porch/on-hold";
import { EventsHome } from "@/components/porch/events-home";
import { Fault } from "@/components/porch/trouble";
import { downloadTransport, loadTransport, saveTransport, saveTransportStage } from "@/lib/porch/transport";
import { findRide, RIDES } from "@/lib/porch/transport-points";
import { RideCard, TransportTeam } from "@/components/porch/transport-team";
import type { MyRide } from "@/lib/porch/transport-board";
import { GroupsHome } from "@/components/porch/groups-plain";
import { OfficesHome } from "@/components/porch/offices-view";
import { ClinicHome, setClinicStart } from "@/components/porch/clinic";
import { TourSlot, closeTourMode, getTourMode, restoreTourMode, toggleTourMode, useTourMode, type TourMode } from "@/lib/porch/tour-mode";

export const Route = createFileRoute("/next")({
  component: NextPage,
});

function emptyRows(): TwentyRow[] {
  return Array.from({ length: 20 }, () => ({ name: "", phone: "" }));
}

const COUNTRIES = [
  ["Uganda", "256"],
  ["Kenya", "254"],
  ["Tanzania", "255"],
  ["Rwanda", "250"],
  ["Burundi", "257"],
  ["South Sudan", "211"],
  ["DR Congo", "243"],
  ["Congo", "242"],
  ["South Africa", "27"],
  ["Nigeria", "234"],
  ["Ghana", "233"],
  ["Zambia", "260"],
  ["Malawi", "265"],
  ["Zimbabwe", "263"],
  ["Mozambique", "258"],
  ["Botswana", "267"],
  ["Namibia", "264"],
  ["Ethiopia", "251"],
  ["Somalia", "252"],
  ["Sudan", "249"],
  ["Egypt", "20"],
  ["Morocco", "212"],
  ["Cameroon", "237"],
  ["Ivory Coast", "225"],
  ["Senegal", "221"],
  ["United States / Canada", "1"],
  ["United Kingdom", "44"],
  ["Ireland", "353"],
  ["United Arab Emirates", "971"],
  ["Saudi Arabia", "966"],
  ["Qatar", "974"],
  ["India", "91"],
  ["China", "86"],
  ["Germany", "49"],
  ["France", "33"],
  ["Netherlands", "31"],
  ["Belgium", "32"],
  ["Sweden", "46"],
  ["Norway", "47"],
  ["Italy", "39"],
  ["Spain", "34"],
  ["Portugal", "351"],
  ["Australia", "61"],
  ["South Korea", "82"],
  ["Japan", "81"],
  ["Brazil", "55"],
  ["Turkey", "90"],
] as const;

function withCountry(raw: string, dial: string): string {
  let digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) return digits.slice(0, 16);
  if (digits.startsWith(dial)) return `+${digits}`.slice(0, 16);
  if (digits.startsWith("0")) return `+${dial}${digits.slice(1)}`.slice(0, 16);
  if (digits.length >= 11) return `+${digits}`.slice(0, 16);
  return `+${dial}${digits}`.slice(0, 16);
}

function parsePasted(text: string, dial: string): TwentyRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const phoneRe = /(\+?\d[\d\s().-]{5,}\d)/;
  const rows: TwentyRow[] = [];
  for (let index = 0; index < lines.length && rows.length < 20; index += 1) {
    const line = lines[index];
    const found = line.match(phoneRe);
    const next = lines[index + 1] ?? "";
    const nextPhone = next.match(phoneRe);
    if (!found && nextPhone && next.replace(nextPhone[0], "").trim().length === 0) {
      rows.push({ name: line.replace(/^[\d.)-]+\s*/, "").slice(0, 80), phone: withCountry(nextPhone[1], dial) });
      index += 1;
      continue;
    }
    if (!found) {
      rows.push({ name: line.replace(/^[\d.)-]+\s*/, "").slice(0, 80), phone: "" });
      continue;
    }
    const name = line
      .replace(found[1], " ")
      .replace(/^[\d.)\-–—:|,]+\s*/, "")
      .replace(/[\s,|:–—-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    rows.push({ name: name.slice(0, 80), phone: withCountry(found[1], dial) });
  }
  return rows;
}

function dialOf(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const codes = [...new Set(COUNTRIES.map((item) => item[1]))].sort((a, b) => b.length - a.length);
  return codes.find((code) => digits.startsWith(code)) ?? "256";
}

function nineDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length > 9) {
    const codes = [...new Set(COUNTRIES.map((item) => item[1]))].sort((a, b) => b.length - a.length);
    const current = codes.find((code) => digits.startsWith(code));
    if (current) digits = digits.slice(current.length);
    else if (digits.startsWith("0")) digits = digits.slice(1);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 9);
}

function pressClass(down: boolean) {
  return `tour-key no-sink${down ? " is-down" : ""}`;
}

function PrayButton() {
  const on = usePrayerOn();
  const [down, setDown] = useState(false);
  const sunk = on || down;

  return (
    <button
      type="button"
      className={pressClass(sunk)}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
        pressPray();
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
    >
      <span className="text-base leading-none" aria-hidden="true">🙏</span>
      {on ? <W k="tour.praying">Praying</W> : <W k="tour.pray">Pray</W>}
    </button>
  );
}

function EventsDoor() {
  const open = useTourMode() === "events";
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      className={pressClass(down || open)}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => toggleTourMode("events")}
    >
      <Calendar className="size-4 text-[#f0c014]" aria-hidden="true" />
      <W k="tour.events">Events</W>
    </button>
  );
}

function DoorButton({ mode, label }: { mode: Extract<TourMode, "groups" | "offices">; label: string }) {
  const open = useTourMode() === mode;
  const [down, setDown] = useState(false);
  const icon =
    mode === "groups" ? (
      <Users className="size-4 text-[#f0c014]" aria-hidden="true" />
    ) : (
      <Building2 className="size-4 text-[#f5a018]" aria-hidden="true" />
    );
  return (
    <button
      type="button"
      aria-expanded={open}
      className={pressClass(down || open)}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => toggleTourMode(mode)}
    >
      {icon}
      {mode === "groups" ? <W k="tour.groups">{label}</W> : <W k="tour.offices">{label}</W>}
    </button>
  );
}

function TransportButton() {
  const { user } = useCurrentUserState();
  const [down, setDown] = useState(false);
  const open = useTourMode() === "transport";
  const [arrange, setArrange] = useState(false);
  const [eventInfo, setEventInfo] = useState<{ name: string; dateLabel: string; pickupLabel: string; gatesLabel: string; phone: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const [ride, setRide] = useState<MyRide | null>(null);
  const [place, setPlace] = useState("");
  const [division, setDivision] = useState(RIDES[0].division);
  const [venue, setVenue] = useState("");
  const [venueNote, setVenueNote] = useState("");
  const [manifestName, setManifestName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [stagePlace, setStagePlace] = useState("");
  const [stageName, setStageName] = useState("");
  const [dial, setDial] = useState("256");
  const [phone, setPhone] = useState("");
  const [rideBack, setRideBack] = useState(true);
  const [stageText, setStageText] = useState("");
  const [listed, setListed] = useState(false);
  const [groups, setGroups] = useState<{ label: string; count: number; people: { name: string; place: string; phone: string; rideBack: boolean }[] }[]>([]);
  const sunk = open || down;
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancel = false;
    loadTransport({ data: seed })
      .then((result) => {
        if (cancel) return;
        setArrange(result.arrange);
        setEventInfo(result.event);
        setClosed(result.closed);
        setRide(result.ride);
        const known = findRide(result.place);
        const nextDivision = known?.division ?? RIDES[0].division;
        setDivision(nextDivision);
        setPlace(result.place || RIDES.find((ride) => ride.division === nextDivision)?.stages[0] || "");
        setVenue(result.venue || "anniversary");
        setVenueNote(result.venue === "other" ? result.venueNote : "");
        setManifestName(result.venue === "manifest" ? result.venueNote : "");
        setDial(dialOf(result.phone || ""));
        setPhone(result.phone ? nineDigits(result.phone) : "");
        setRideBack(result.rideBack);
        setStageText(result.stage);
        setListed(Boolean(result.place));
        setGroups(result.groups);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  async function save() {
    setBusy(true);
    setNote("");
    if (phone.trim() && nineDigits(phone).length !== 9) {
      setBusy(false);
      setNote("A red number is not finished. It needs nine figures.");
      return;
    }
    const result = await saveTransport({
      data: {
        ...seed,
        place,
        phone: phone.trim() ? `+${dial}${nineDigits(phone)}` : "",
        venue,
        venueNote: venue === "manifest" ? manifestName : venue === "other" ? venueNote : "",
        rideBack,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setStageText(result.stage);
    setListed(true);
    const again = await loadTransport({ data: seed }).catch(() => null);
    if (again) setGroups(again.groups);
  }

  async function addStage() {
    setBusy(true);
    setNote("");
    const result = await saveTransportStage({ data: { ...seed, place: stagePlace, stage: stageName } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setStagePlace("");
    setStageName("");
    setNote("Stage saved. A matching location gets that stage.");
    if (stagePlace.trim().toLowerCase() === place.trim().toLowerCase()) setStageText(stageName.trim());
    const again = await loadTransport({ data: seed }).catch(() => null);
    if (again) setGroups(again.groups);
  }

  async function takeLocations() {
    setBusy(true);
    setNote("");
    const result = await downloadTransport({ data: seed }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't make the list. Try again.");
      return;
    }
    const host = window as Window & { PorchApp?: { saveFile?: (name: string, data: string) => void } };
    if (typeof host.PorchApp?.saveFile === "function") {
      host.PorchApp.saveFile(result.filename, result.pdf);
      setNote("The list is opening.");
      return;
    }
    const binary = atob(result.pdf);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], result.filename, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      void navigator.share({ files: [file], title: result.filename }).catch(() => undefined);
      setNote("Choose where to keep the list.");
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className={pressClass(sunk)}
        onPointerDown={() => {
          playButtonSound();
          setDown(true);
        }}
        onPointerUp={() => setDown(false)}
        onPointerLeave={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onClick={() => toggleTourMode("transport")}
      >
        <Bus className="size-4 text-[#3dcc3d]" aria-hidden="true" />
        <W k="tour.transport">Transport</W>
      </button>
      {open ? (
        <TourSlot>
        <form className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h2 className="font-display text-3xl text-ink"><W k="transport.title">Transport</W></h2>
          {eventInfo ? (
            <>
              <p className="mt-1 text-sm text-muted">
                <W k="transport.to" vars={{ event: eventInfo.name }}>{"To {event}"}</W>
                {eventInfo.dateLabel ? `, ${eventInfo.dateLabel}` : ""}.{" "}
                {eventInfo.pickupLabel ? <W k="transport.pickup" vars={{ time: eventInfo.pickupLabel }}>{"Pickup from {time}."}</W> : null}{" "}
                {eventInfo.gatesLabel ? <W k="transport.gates" vars={{ time: eventInfo.gatesLabel }}>{"Gates open at {time}."}</W> : null}
              </p>
              {eventInfo.phone ? <p className="mt-1 text-sm text-muted"><W k="transport.call" vars={{ phone: eventInfo.phone }}>{"Call {phone}."}</W></p> : null}
            </>
          ) : null}
          {ride ? (
            <div className="mt-4">
              <RideCard ride={ride} eventLine={eventInfo ? `${eventInfo.name}${eventInfo.dateLabel ? ` · ${eventInfo.dateLabel}` : ""}${eventInfo.gatesLabel ? ` · gates ${eventInfo.gatesLabel}` : ""}` : ""} />
            </div>
          ) : null}
          {closed ? (
            <div className="mt-4 rounded-2xl border border-[#2d4a14] bg-[#10160c] p-3">
              <p className="font-semibold text-[#f6edd4]"><W k="transport.closed" vars={{ event: eventInfo?.name ?? "this event" }}>{"Registration for {event} has closed."}</W></p>
              <p className="text-sm text-muted">
                {listed && !ride ? <W k="transport.closed-listed" vars={{ place: place.trim() }}>{"You're on the list from {place}."}</W> : null}{" "}
                {eventInfo?.phone ? <W k="transport.call" vars={{ phone: eventInfo.phone }}>{"Call {phone}."}</W> : null}
              </p>
            </div>
          ) : null}
          {closed ? null : (
          <>
          <label className="mt-4 block text-sm font-bold text-ink" htmlFor="transport-division">
            <W k="transport.division">Division</W>
            <select
              id="transport-division"
              value={division}
              onChange={(event) => {
                const next = event.target.value;
                setDivision(next);
                const first = RIDES.find((ride) => ride.division === next)?.stages[0] ?? "";
                setPlace(first);
              }}
              className={`${fieldClass} mt-2`}
            >
              {RIDES.map((ride) => (
                <option key={ride.division} value={ride.division}>
                  {ride.division}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm font-bold text-ink" htmlFor="transport-place">
            <W k="transport.pickup-point">Pickup point</W>
            <select
              id="transport-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              className={`${fieldClass} mt-2`}
            >
              {(RIDES.find((ride) => ride.division === division)?.stages ?? []).concat(place && !(RIDES.find((ride) => ride.division === division)?.stages ?? []).includes(place) ? [place] : []).map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="mt-4">
            <legend className="text-sm font-bold text-ink"><W k="transport.where">Where are you going?</W></legend>
            <div className="mt-2 grid gap-2">
              {(
                [
                  ["pmi", "Phaneroo Grounds"],
                  ["pmm", "Phaneroo Mbarara"],
                  ["anniversary", eventInfo?.name || "The event"],
                  ["manifest", "Manifest"],
                  ["other", "Other"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={venue === key}
                  onClick={() => setVenue(key)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-base font-bold ${venue === key ? "border-pine bg-[#1a1004] text-pine" : "border-[#3a2a12] text-[#f6edd4]"}`}
                >
                  <span className={`size-4 shrink-0 rounded-full border-2 ${venue === key ? "border-pine shadow-[inset_0_0_0_3px_#f8a018]" : "border-[#8a5a12]"}`} />
                  {label}
                </button>
              ))}
            </div>
            {venue === "manifest" ? (
              <input
                value={manifestName}
                onChange={(event) => setManifestName(event.target.value)}
                placeholder="Which Manifest"
                maxLength={80}
                aria-label="Which Manifest"
                className={`${fieldClass} mt-2`}
              />
            ) : null}
            {venue === "other" ? (
              <input
                value={venueNote}
                onChange={(event) => setVenueNote(event.target.value)}
                placeholder="The venue"
                maxLength={80}
                className={`${fieldClass} mt-2`}
              />
            ) : null}
          </fieldset>
          <fieldset className="mt-4">
            <legend className="text-sm font-bold text-ink"><W k="transport.way-back">The way back</W></legend>
            <div className="mt-2 grid gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={rideBack}
                onClick={() => setRideBack(true)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-base font-bold ${rideBack ? "border-pine bg-[#1a1004] text-pine" : "border-[#3a2a12] text-[#f6edd4]"}`}
              >
                <span className={`size-4 shrink-0 rounded-full border-2 ${rideBack ? "border-pine shadow-[inset_0_0_0_3px_#f8a018]" : "border-[#8a5a12]"}`} />
                {place.trim() ? <W k="transport.bring-back-to" vars={{ place: place.trim() }}>{"Bring me back to {place}"}</W> : <W k="transport.bring-back">Bring me back</W>}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!rideBack}
                onClick={() => setRideBack(false)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-base font-bold ${!rideBack ? "border-pine bg-[#1a1004] text-pine" : "border-[#3a2a12] text-[#f6edd4]"}`}
              >
                <span className={`size-4 shrink-0 rounded-full border-2 ${!rideBack ? "border-pine shadow-[inset_0_0_0_3px_#f8a018]" : "border-[#8a5a12]"}`} />
                <W k="transport.own-way">I have my own way back</W>
              </button>
            </div>
          </fieldset>
          <p className="mt-4 text-sm font-bold text-ink"><W k="transport.number">Number, only if you want a call</W></p>
          <div className="mt-2 flex items-center gap-2">
            <label className="relative block h-11 w-[4.5rem] shrink-0">
              <span className="flex h-full items-center justify-center rounded-lg glass-edge bg-card text-sm font-semibold text-ink">+{dial}</span>
              <select
                value={dial}
                aria-label="Country for this number"
                onChange={(event) => setDial(event.target.value)}
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              >
                {COUNTRIES.map(([name, code]) => (
                  <option key={`${name}-${code}`} value={code}>
                    {name} +{code}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={phone}
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
              aria-label="Number"
              onChange={(event) => setPhone(nineDigits(event.target.value))}
              className={`${fieldClass} ${phone.length > 0 && phone.length !== 9 ? "!text-[#e23b3b]" : ""}`}
            />
          </div>
          <p className="mt-2 text-sm text-muted"><W k="transport.number-help">Leave the number empty if you prefer. Your details will then come to you in Porchbook.</W></p>
          <button type="submit" className={`${primaryButtonClass} mt-3 w-full`} disabled={busy}>
            {busy ? "Saving…" : <W k="transport.save">Save</W>}
          </button>
          {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
          {listed && !ride ? (
            <div className="mt-3 rounded-2xl border border-[#2d4a14] bg-[#10160c] p-3">
              <p className="font-semibold text-[#f6edd4]"><W k="transport.registered" vars={{ place: place.trim() }}>{"Registered from {place}."}</W></p>
              <p className="text-sm text-muted"><W k="transport.registered-help">The Transport team will confirm your bus. It will show here.</W></p>
            </div>
          ) : null}
          </>
          )}
          {arrange ? <TransportTeam onDownload={() => void takeLocations()} busy={busy} /> : null}
        </form>
        </TourSlot>
      ) : null}
    </>
  );
}

function FeedbackButton() {
  const open = useTourMode() === "feedback";
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      className={pressClass(down || open)}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => {
        if (getTourMode() === "feedback") {
          window.dispatchEvent(new CustomEvent("porch-trouble-close"));
          return;
        }
        toggleTourMode("feedback");
        window.dispatchEvent(new CustomEvent("porch-trouble"));
      }}
    >
      <MessageCircle className="size-4 text-[#7ec8ff]" aria-hidden="true" />
      <W k="tour.feedback">Feedback</W>
    </button>
  );
}

/** The Clinic takes Feedback's place on the tour (only an admin sees it until it's launched). Feedback lives in the name menu and with the porch guy. */
function ClinicOrFeedback() {
  // The Clinic is open to everyone: it always has Feedback's place (no flash of the old key).
  // While the Clinic is on hold, Feedback has its place back.
  return shown("clinic") ? <ClinicButton /> : <FeedbackButton />;
}

function ClinicButton() {
  const open = useTourMode() === "clinic";
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      className={`${pressClass(down || open)} tour-clinic`}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => toggleTourMode("clinic")}
    >
      <span className="tour-clinic-cross" aria-hidden="true">✚</span>
      <W k="tour.clinic">Clinic</W>
    </button>
  );
}

function CallButton() {
  const navigate = useNavigate();
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      className={pressClass(down)}
      onPointerDown={() => {
        playButtonSound();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => {
        void navigate({ to: "/calls", search: { to: "", name: "", video: "" } });
      }}
    >
      <Phone className="size-4 text-[#2fb36d]" aria-hidden="true" />
      <W k="tour.call">Call</W>
    </button>
  );
}

function TwentyGauge({ count }: { count: number }) {
  const done = Math.min(20, Math.max(0, count));
  const full = done >= 20;
  const span = full ? 360 : 292;
  const step = span / 20;
  const dots = Array.from({ length: 20 }, (_, index) => {
    const angle = ((-90 + index * step) * Math.PI) / 180;
    return {
      cx: 20 + Math.cos(angle) * 15.2,
      cy: 20 + Math.sin(angle) * 15.2,
      lit: index < done,
    };
  });
  return (
    <span className="relative grid size-7 place-items-center" aria-label={full ? "20 of 20 names" : `${done} of 20 names`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full" aria-hidden="true">
        {dots.map((dot, index) => (
          <circle
            key={index}
            cx={dot.cx}
            cy={dot.cy}
            r="1.35"
            fill={dot.lit ? "#39d353" : "#141414"}
            stroke={dot.lit ? "#39d353" : "rgba(255,255,255,0.28)"}
            strokeWidth="0.45"
          />
        ))}
      </svg>
      <span className="relative text-sm font-black leading-none">{done}</span>
    </span>
  );
}

function MyTwenty() {
  const { user } = useCurrentUserState();
  const mode = useTourMode();
  // Radio: the buttons fold away and the radio sits right under the header, all in view.
  useEffect(() => {
    if (mode === "worship") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [mode]);
  const open = mode === "twenty";
  const [down, setDown] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("tour-open", Boolean(mode));
  }, [mode]);
  useEffect(() => {
    // Came back to Tour with Back: reopen what was open.
    restoreTourMode();
    // After Refresh: reopen the panel that was open (Radio, Events, Transport…).
    const kept = takePart<TourMode>("tour");
    if (kept && getTourMode() !== kept) toggleTourMode(kept);
    const dropTour = placePart("tour", () => getTourMode() || null);
    // From a "your request is about to play" alert: open the radio, playing.
    const url = new URL(window.location.href);
    // From "Mia is online, waiting for her request": open the radio at the requests.
    if (url.searchParams.get("radio") === "requests") {
      url.searchParams.delete("radio");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      if (getTourMode() !== "worship") toggleTourMode("worship");
      window.setTimeout(() => document.querySelector(".fm-reqs")?.scrollIntoView({ block: "start", behavior: "smooth" }), 1200);
    }
    const clinicAt = url.searchParams.get("clinic");
    if (clinicAt) {
      url.searchParams.delete("clinic");
      if (clinicAt !== "1") setClinicStart(clinicAt);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      if (getTourMode() !== "clinic") toggleTourMode("clinic");
    }
    if (url.searchParams.get("tune") === "1") {
      url.searchParams.delete("tune");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      if (getTourMode() !== "worship") toggleTourMode("worship");
      void tuneIn();
    }
    return () => {
      dropTour();
      document.body.classList.remove("tour-open");
      closeTourMode();
    };
  }, []);
  const [founder, setFounder] = useState(false);
  const [rows, setRows] = useState<TwentyRow[]>(emptyRows);
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteHelp, setPasteHelp] = useState(false);
  const [dials, setDials] = useState<string[]>(() => Array.from({ length: 20 }, () => "256"));
  const [centre, setCentre] = useState("");
  const [mineFile, setMineFile] = useState<{ name: string; data: string } | null>(null);

  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    let cancel = false;
    loadMyTwenty({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.isFounder);
        setSent(result.sent);
        setDials(Array.from({ length: 20 }, () => "256"));
        setRows(emptyRows());
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // Reload when the signed-in person changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function setRow(index: number, patch: Partial<TwentyRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function fillFromPaste(text: string) {
    const parsed = parsePasted(text, "256");
    if (!parsed.length) {
      setNote("Put one name and number on each line.");
      return;
    }
    const next = emptyRows();
    parsed.forEach((row, index) => {
      next[index] = row;
    });
    setRows(next.map((row) => ({ ...row, phone: nineDigits(row.phone) })));
    setDials(next.map((row) => (row.phone ? dialOf(row.phone) : "256")));
    setNote(
      parsed.length === 20 && text.split(/\r?\n/).filter((line) => line.trim()).length > 20
        ? "Filled the first 20. Each number starts on Uganda. Change one if it is another country."
        : "Filled. Each number starts on Uganda. Change one if it is another country.",
    );
  }

  async function save() {
    if (!centre.trim()) {
      setNote("Name the Manifest centre you are in.");
      return;
    }
    if (!rows.some((row) => row.name.trim() || row.phone.trim())) {
      setNote("Put in a name or a number first.");
      return;
    }
    if (rows.some((row) => (row.name.trim() || row.phone.trim()) && nineDigits(row.phone).length !== 9)) {
      setNote("A red number is not finished. It needs nine figures.");
      return;
    }
    setBusy(true);
    setNote("");
    const result = await saveMyTwenty({
      data: {
        ...seed,
        centre,
        rows: rows.map((row, index) => ({
          name: row.name,
          phone: row.phone ? `+${dials[index] ?? "256"}${nineDigits(row.phone)}` : "",
        })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNote("Couldn't save.");
      return;
    }
    setSent(result.sent);
    setRows(emptyRows());
    setDials(Array.from({ length: 20 }, () => "256"));
    setCentre("");
    setPaste("");
    setNote(`Saved. ${result.sent} ${result.sent === 1 ? "name is" : "names are"} under your name. Fill the next 20 when you are ready.`);
  }

  function resetForm() {
    setRows(emptyRows());
    setDials(Array.from({ length: 20 }, () => "256"));
    setCentre("");
    setPaste("");
    setNote(sent > 0 ? "Cleared. What you already sent stays under your name." : "Cleared.");
  }

  async function resetAll() {
    setBusy(true);
    setNote("");
    try {
      const result = await resetMyTwenty({ data: seed });
      setBusy(false);
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      savePdf(result.pdf, result.filename);
      setSent(0);
      setRows(emptyRows());
      setDials(Array.from({ length: 20 }, () => "256"));
      setCentre("");
      setPaste("");
      setNote("All before Delete is ready. Every list is now empty.");
    } catch {
      setBusy(false);
      setNote("Couldn't make All before Delete. Nothing was deleted.");
    }
  }

  async function download(which: "all" | "same" | "mine") {
    setBusy(true);
    setNote("");
    try {
      if (which === "mine") {
        const result = await downloadOwnTwenty({ data: seed });
        setBusy(false);
        if (!result.pdf) {
          setNote("Couldn't make your list. Try again.");
          return;
        }
        setMineFile({ name: result.filename, data: result.pdf });
        const saved = savePdf(result.pdf, result.filename);
        setNote(saved === "share" ? "Choose where to keep your list." : "Your list is ready. If it did not open, tap Open my list.");
        return;
      }
      const result = await downloadMyTwenty({ data: seed });
      setBusy(false);
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      const saved = savePdf(which === "all" ? result.pdf : result.same, which === "all" ? result.filename : result.sameName);
      if (saved === "app") setNote("The list is opening.");
      else if (saved === "share") setNote("Choose where to keep the list.");
    } catch {
      setBusy(false);
      setNote("Couldn't make the list. Try again.");
    }
  }

  function savePdf(base64: string, filename: string) {
    const host = window as Window & { PorchApp?: { saveFile?: (name: string, data: string) => void } };
    if (typeof host.PorchApp?.saveFile === "function") {
      host.PorchApp.saveFile(filename, base64);
      return "app";
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], filename, { type: "application/pdf" });
    const share = navigator.share?.bind(navigator);
    if (share && navigator.canShare?.({ files: [file] })) {
      void share({ files: [file], title: filename }).catch(() => downloadBlob(binary, filename));
      return "share";
    }
    downloadBlob(binary, filename);
    return "file";
  }

  function downloadBlob(binary: string, filename: string) {
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className={`tour-stage${mode ? " is-open" : ""}${mode === "worship" ? " is-radio" : ""}`}>
      <div className="tour-doors">
          <PrayButton />
          <button
            type="button"
            aria-expanded={open}
            className={pressClass(down || open)}
            onPointerDown={() => {
              playButtonSound();
              setDown(true);
            }}
            onPointerUp={() => setDown(false)}
            onPointerLeave={() => setDown(false)}
            onPointerCancel={() => setDown(false)}
            onClick={() => toggleTourMode("twenty")}
          >
            <TwentyGauge
              count={Math.min(
                20,
                sent + rows.filter((row) => row.name.trim().length > 0 && nineDigits(row.phone).length === 9).length,
              )}
            />
            <W k="tour.my20">My 20</W>
          </button>
          <EventsDoor />
          {shown("radio") ? <FmButton /> : null}
          <ServeButton />
          <TransportButton />
          <DoorButton mode="groups" label="Groups" />
          <DoorButton mode="offices" label="Offices" />
          <ClinicOrFeedback />
          {shown("groupCalls") ? <CallButton /> : null}
        </div>
      {/* On phones, brightness is the ☀ by "on the porch"; computers keep the roller here. */}
      <div className="pb">
        <LightRow />
      </div>
      <div id="tour-fill" className="tour-fill" />
      {mode === "events" ? (
        <TourSlot>
          <EventsHome />
        </TourSlot>
      ) : null}
      {mode === "groups" ? (
        <TourSlot>
          <div className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4">
            <GroupsHome />
          </div>
        </TourSlot>
      ) : null}
      {mode === "clinic" && shown("clinic") ? (
        <TourSlot>
          <ClinicHome />
        </TourSlot>
      ) : null}
      {mode === "offices" ? (
        <TourSlot>
          <div className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4">
            <OfficesHome />
          </div>
        </TourSlot>
      ) : null}
      {open ? (
        <TourSlot>
        <form
          className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="font-display text-xl text-ink"><W k="my20.title">My 20</W></h2>
          <p className="text-sm font-semibold text-ink"><W k="my20.event">31st Night of Prayer</W></p>
          {founder ? (
            <div className="mt-3">
              <p className="text-sm text-muted">You get everyone's list. Several people share each page.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={primaryButtonClass} onClick={() => download("all")} disabled={busy}>
                  Everyone's lists
                </button>
                <button type="button" className={primaryButtonClass} onClick={() => download("same")} disabled={busy}>
                  my20-same.pdf
                </button>
                <button type="button" className={primaryButtonClass} onClick={() => void resetAll()} disabled={busy}>
                  Reset
                </button>
              </div>
            </div>
          ) : null}
          <p className="mt-1 text-sm text-muted"><W k="my20.intro">Twenty names, and a number for each. Uganda is the code unless you change that number.</W></p>
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void download("mine")} disabled={busy}>
            <W k="my20.my-list">My list</W>
          </button>
          {mineFile ? (
            <button type="button" className={`${quietButtonClass} mt-2`} onClick={() => savePdf(mineFile.data, mineFile.name)}>
              <W k="my20.open-list">Open my list</W>
            </button>
          ) : null}
          <p className="mt-1 text-sm text-muted"><W k="my20.pdf-help">This PDF is only what you have sent.</W></p>
          <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="manifest-centre">
            <W k="my20.centre">Manifest centre</W>
            <input
              id="manifest-centre"
              value={centre}
              onChange={(event) => setCentre(event.target.value)}
              maxLength={80}
              className={`${fieldClass} mt-1`}
            />
          </label>
          {sent > 0 ? (
            <p className="mt-1 text-sm text-ink">
              {sent} {sent === 1 ? "name already sent" : "names already sent"} under your name.
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm font-semibold text-ink" htmlFor="paste-twenty">
              <W k="my20.paste">Paste all here</W>
            </label>
            <button
              type="button"
              aria-expanded={pasteHelp}
              aria-label="How to paste"
              className="grid size-6 place-items-center rounded-full border-2 border-ink text-xs font-black leading-none text-ink"
              onClick={() => setPasteHelp((value) => !value)}
            >
              i
            </button>
          </div>
          {pasteHelp ? (
            <p className="mt-1 text-sm text-muted">
              <W k="my20.paste-help">Copy the names and numbers from wherever you keep them. Paste them here, and they fill in.</W>
            </p>
          ) : null}
          <textarea
            id="paste-twenty"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!text.trim()) return;
              event.preventDefault();
              setPaste(text);
              fillFromPaste(text);
            }}
            rows={4}
            className={`${fieldClass} mt-1`}
          />
          <button
            type="button"
            className={`${primaryButtonClass} mt-2`}
            onClick={() => fillFromPaste(paste)}
          >
            Fill
          </button>
          <ol className="mt-3 space-y-2">
            {rows.map((row, index) => (
              <li key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-sm tabular-nums text-muted">{index + 1}</span>
                  <input
                    value={row.name}
                    onChange={(event) => setRow(index, { name: event.target.value })}
                    placeholder="Name"
                    maxLength={80}
                    aria-label={`Name ${index + 1}`}
                    className={fieldClass}
                  />
                </div>
                <div className="flex items-center gap-2 pl-8">
                  <label className="relative block h-11 w-[4.5rem] shrink-0">
                    <span className="flex h-full items-center justify-center rounded-lg glass-edge bg-card text-sm font-semibold text-ink">
                      +{dials[index] ?? "256"}
                    </span>
                    <select
                      value={dials[index] ?? "256"}
                      aria-label={`Country for number ${index + 1}`}
                      onChange={(event) => {
                        const nextDial = event.target.value;
                        setDials((current) => current.map((code, i) => (i === index ? nextDial : code)));
                      }}
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    >
                      {COUNTRIES.map(([name, code]) => (
                        <option key={`${name}-${code}`} value={code}>
                          {name} +{code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    value={row.phone}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={9}
                    aria-label={`Number ${index + 1}`}
                    onChange={(event) => setRow(index, { phone: nineDigits(event.target.value) })}
                    className={`${fieldClass} ${
                      (row.name.trim().length > 0 || nineDigits(row.phone).length > 0) && nineDigits(row.phone).length !== 9
                        ? "!text-[#e23b3b]"
                        : ""
                    }`}
                  />
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={quietButtonClass} disabled={busy} onClick={resetForm}>
              Reset
            </button>
            {note && /couldn|not finished|name the/i.test(note) ? <Fault text={note} /> : note ? <p className="text-sm text-muted">{note}</p> : null}
          </div>
        </form>
        </TourSlot>
      ) : null}
      <Link to="/app" search={{ stay: false }} className="get-android block text-center text-sm font-semibold text-pine">
        Get the Android app
      </Link>
      <PeepHole />
    </div>
  );
}

function NextPage() {
  useEffect(() => {
    document.body.classList.add("tour-ground");
    return () => document.body.classList.remove("tour-ground");
  }, []);

  return (
    <AppFrame>
      <MyTwenty />
      <PrayerSetter />
    </AppFrame>
  );
}