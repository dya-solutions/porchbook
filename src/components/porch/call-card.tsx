import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { listPeople } from "@/lib/porch/api";
import { acceptCall, cameraCall, canChooseEarpiece, cancelRinging, declineCall, hangUp, lineHandle, muteCall, speakerCall, useLine } from "@/lib/porch/line-call";

/**
 * The new call look: a floating, tilted glass card over Porchbook (the app stays visible behind it),
 * and a slim green bar at the top when you shrink it to carry on using the app.
 * It only changes how calls look; the call itself is handled exactly as before.
 * Everyone sees it; a phone can go back to the old look from the founder menu.
 */

const LOOK_KEY = "porch-call-look";
const watchers = new Set<() => void>();
let minimized = false;
const tell = () => watchers.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
};

function readLook() {
  try {
    return localStorage.getItem(LOOK_KEY) !== "old";
  } catch {
    return false;
  }
}
let glass = typeof window !== "undefined" ? readLook() : true;

export function setGlassCalls(on: boolean) {
  glass = on;
  try {
    if (on) localStorage.removeItem(LOOK_KEY);
    else localStorage.setItem(LOOK_KEY, "old");
  } catch {
    /* this visit only */
  }
  tell();
}
export function useGlassCalls() {
  return useSyncExternalStore(subscribe, () => glass, () => true);
}
export function useCallMinimized() {
  return useSyncExternalStore(subscribe, () => minimized, () => false);
}
export function openCallCard() {
  minimized = false;
  tell();
}
function shrinkCallCard() {
  minimized = true;
  tell();
}

// ---- Preview: see the call screens without a real call (for the founder, testing alone).
type Fake = { kind: "out" | "in"; step: "ringing" | "incoming" | "connected"; muted: boolean; cameraOff: boolean; speaker: boolean } | null;
let fake: Fake = null;
let fakeTimer = 0;
const setFake = (next: Fake) => {
  fake = next;
  tell();
};
export function previewCall(kind: "out" | "in") {
  window.clearTimeout(fakeTimer);
  minimized = false;
  setFake({ kind, step: kind === "out" ? "ringing" : "incoming", muted: false, cameraOff: true, speaker: false });
  // Calling out: they "answer" after a few seconds.
  if (kind === "out") fakeTimer = window.setTimeout(() => fake && setFake({ ...fake, step: "connected" }), 4000);
}
const endPreview = () => {
  window.clearTimeout(fakeTimer);
  minimized = false;
  setFake(null);
};
const PREVIEW_NAME = "Porch Guy";
export function useCallPreview() {
  return useSyncExternalStore(subscribe, () => Boolean(fake), () => false);
}
const fakeStream = {} as MediaStream;
function useCallView() {
  const line = useLine();
  const preview = useSyncExternalStore(subscribe, () => fake, () => null);
  if (!preview) {
    return {
      line,
      act: { acceptCall, declineCall, hangUp, muteCall, cameraCall, cancelRinging, speakerCall },
      preview: false,
    };
  }
  const call =
    preview.step === "ringing"
      ? null
      : {
          name: PREVIEW_NAME,
          video: false,
          incoming: preview.step === "incoming",
          status: preview.step === "incoming" ? "Ringing" : "Connected",
          emojis: "",
          route: "",
          muted: preview.muted,
          cameraOff: preview.cameraOff,
          speaker: preview.speaker,
          local: null,
          remote: preview.step === "connected" ? fakeStream : null,
        };
  return {
    line: { ...line, call, note: preview.step === "ringing" ? `Ringing ${PREVIEW_NAME}'s phone… (preview)` : "" },
    act: {
      acceptCall: () => setFake({ ...preview, step: "connected" }),
      declineCall: endPreview,
      hangUp: endPreview,
      cancelRinging: endPreview,
      muteCall: (muted: boolean) => setFake({ ...preview, muted }),
      cameraCall: (cameraOff: boolean) => setFake({ ...preview, cameraOff }),
      speakerCall: (speaker: boolean) => setFake({ ...preview, speaker }),
    },
    preview: true,
  };
}

function Stream({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.srcObject = stream;
    if (stream) void node.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

/** Names and photos of members, by account id or line handle. */
const people: Record<string, { name: string; image: string | null }> = {};
let peopleAsked = false;
function usePeople(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || peopleAsked) return;
    peopleAsked = true;
    listPeople({ data: {} })
      .then((result) => {
        for (const person of result.people) {
          const entry = { name: person.displayName, image: person.imageUrl ?? null };
          const handle = lineHandle(person.userId);
          people[person.userId] = entry;
          people[handle] = entry;
          people[handle.toLowerCase()] = entry;
          people[person.displayName.toLowerCase()] = entry;
        }
        setTick((n) => n + 1);
      })
      .catch(() => {
        peopleAsked = false;
      });
  }, [enabled]);
  return (key: string) => people[key] ?? people[key.toLowerCase()] ?? { name: key, image: null };
}

// One clock for the call, shared by the card and the bar.
let callStart = 0;
function useTimer(running: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) {
      callStart = 0;
      return;
    }
    if (!callStart) callStart = Date.now();
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running || !callStart) return "";
  const s = Math.floor((Date.now() - callStart) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Face({ image, name, size = "" }: { image: string | null; name: string; size?: string }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className={`cc-face ${size}`}>{image ? <img src={image} alt="" /> : <b>{initials || "?"}</b>}</span>;
}

function Wings() {
  return (
    <span className="butterfly butterfly-still cc-fly" aria-hidden="true">
      <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
      <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
    </span>
  );
}

/** Shown everywhere in the app while a call is ringing or going on (glass look only). */
export function CallCard() {
  const on = useGlassCalls();
  const small = useCallMinimized();
  const { line, act, preview } = useCallView();
  const call = line.call;
  const person = usePeople(on);
  const connected = Boolean(call && !call.incoming && call.remote);
  const time = useTimer(connected);
  const ringing = !call && line.note.startsWith("Ringing ");
  const ringingName = ringing ? (/^Ringing (.+?)'s phone/.exec(line.note)?.[1] ?? "") : "";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Earpiece / loudspeaker: only the Porchbook app can choose (and the preview, to see it).
  const earpiece = mounted && (preview || canChooseEarpiece());
  // A new call always opens as the card.
  const callKey = call ? `${call.name}:${call.incoming}` : "";
  useEffect(() => {
    if (callKey) openCallCard();
  }, [callKey]);
  if (!mounted || (!on && !preview) || small || (!call && !ringing)) return null;

  const found = call ? person(call.name) : person(ringingName);
  const who = preview ? { name: PREVIEW_NAME, image: "/porchguy/happy.webp" } : found;
  const video = Boolean(call?.video && call.remote && !call.incoming);
  const status = ringing ? "Calling…" : call?.incoming ? `Incoming ${call.video ? "video" : "voice"} call` : connected ? "Connected" : call?.status || "Connecting…";

  return createPortal(
    <div className="cc-back" role="dialog" aria-label={`Call with ${who.name}`}>
      <div className={`cc-card${video ? " is-video" : ""}${call?.incoming || ringing ? " is-ringing" : ""}`}>
        <Wings />
        <div className="cc-top">
          <span className="cc-pill">
            <i className={connected ? "is-on" : ""} />
            {status}
          </span>
          {call && !call.incoming ? (
            <button type="button" className="cc-shrink" aria-label="Shrink the call and keep using Porchbook" onClick={shrinkCallCard}>
              ⌄
            </button>
          ) : null}
        </div>
        {video && call ? (
          <div className="cc-video">
            <Stream stream={call.remote} muted className="cc-remote" />
            {call.local && !call.cameraOff ? <Stream stream={call.local} muted className="cc-local" /> : null}
          </div>
        ) : null}
        <div className="cc-who">
          {!video ? <Face image={who.image} name={who.name} /> : null}
          <div className="min-w-0">
            <p className="cc-name">{who.name || "Someone"}</p>
            <p className="cc-sub">{connected ? time : call?.route || "Porchbook call"}</p>
            {preview ? <p className="cc-preview">Preview: no real call</p> : null}
            {call?.emojis ? <p className="cc-emojis">{call.emojis}</p> : null}
          </div>
        </div>
        <div className="cc-keys">
          {ringing ? (
            <button type="button" className="cc-key is-end" aria-label="Cancel the call" onClick={act.cancelRinging}>
              ✆
            </button>
          ) : call?.incoming ? (
            <>
              <button type="button" className="cc-key is-end" aria-label="Decline" onClick={act.declineCall}>
                ✆
              </button>
              <button type="button" className="cc-key is-ok" aria-label="Answer" onClick={act.acceptCall}>
                ✆
              </button>
            </>
          ) : call ? (
            <>
              <button type="button" className={`cc-key${call.muted ? " is-white" : ""}`} aria-label={call.muted ? "Unmute" : "Mute"} onClick={() => act.muteCall(!call.muted)}>
                🎙
              </button>
              {earpiece ? (
                <button
                  type="button"
                  className={`cc-key${call.speaker ? " is-white" : ""}`}
                  aria-label={call.speaker ? "Switch to the earpiece" : "Switch to the loudspeaker"}
                  aria-pressed={call.speaker}
                  onClick={() => act.speakerCall(!call.speaker)}
                >
                  {call.speaker ? "🔊" : "🔈"}
                </button>
              ) : null}
              <button type="button" className="cc-key is-end" aria-label="End the call" onClick={act.hangUp}>
                ✆
              </button>
              <button type="button" className={`cc-key${call.cameraOff || !call.video ? "" : " is-white"}`} aria-label={call.cameraOff ? "Camera on" : "Camera off"} onClick={() => act.cameraCall(!call.cameraOff)}>
                📷
              </button>
            </>
          ) : null}
        </div>
        <div className="cc-labels">
          {ringing ? (
            <span>Cancel</span>
          ) : call?.incoming ? (
            <>
              <span>Decline</span>
              <span>Answer</span>
            </>
          ) : call ? (
            <>
              <span>{call.muted ? "Muted" : "Mute"}</span>
              {earpiece ? <span>{call.speaker ? "Speaker" : "Earpiece"}</span> : null}
              <span>End</span>
              <span>{call.cameraOff ? "Camera off" : "Camera"}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The slim green bar at the top while a shrunk call goes on. */
export function CallBar() {
  const { line, act, preview } = useCallView();
  const call = line.call;
  const person = usePeople(true);
  const time = useTimer(Boolean(call && !call.incoming && call.remote));
  if (!call) return null;
  const who = preview ? { name: PREVIEW_NAME, image: "/porchguy/happy.webp" } : person(call.name);
  return (
    <div className="radio-strip cc-bar" role="region" aria-label="Call in progress">
      <button type="button" className="cc-bar-open" onClick={openCallCard} aria-label="Open the call">
        <Face image={who.image} name={who.name} size="is-mini" />
        <b>{who.name}</b>
        <span>{time || call.status}</span>
      </button>
      <button type="button" className={`cc-bar-key${call.muted ? " is-white" : ""}`} aria-label={call.muted ? "Unmute" : "Mute"} onClick={() => act.muteCall(!call.muted)}>
        🎙
      </button>
      <button type="button" className="cc-bar-key is-end" aria-label="End the call" onClick={act.hangUp}>
        ✆
      </button>
    </div>
  );
}
