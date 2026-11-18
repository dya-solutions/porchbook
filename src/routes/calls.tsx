import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { listPeople } from "@/lib/porch/api";
import { AppFrame } from "@/components/porch/frame";
import { useGlassCalls } from "@/components/porch/call-card";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { signInForCalls, useFirebaseMember } from "@/lib/porch/firebase-call";
import {
  acceptCall,
  askLine,
  callPerson,
  cancelRinging,
  cameraCall,
  declineCall,
  goOffline,
  hangUp,
  lineHandle,
  muteCall,
  speakerCall,
  canChooseEarpiece,
  setDirect,
  useLine,
} from "@/lib/porch/line-call";

export const Route = createFileRoute("/calls")({
  validateSearch: (search: Record<string, unknown>): { to: string; name: string; video: string; answer?: string } => ({
    ...(typeof search.answer === "string" && search.answer ? { answer: search.answer } : {}),
    to: typeof search.to === "string" ? search.to : "",
    name: typeof search.name === "string" ? search.name : "",
    video: search.video === "1" ? "1" : "",
  }),
  component: CallsPage,
});

function CallsPage() {
  const { to, name, video, answer } = Route.useSearch();
  return (
    <AppFrame>
      <CallDesk wantId={to} want={name} video={video === "1"} answering={Boolean(answer)} />
    </AppFrame>
  );
}

function Stream({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const videoNode = ref.current;
    if (!videoNode) return;
    videoNode.srcObject = stream;
    if (stream) void videoNode.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

/** Porchbook account id -> display name, so the line shows real names. */
function usePeopleNames(enabled: boolean) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    listPeople({ data: {} })
      .then((result) => {
        if (cancel) return;
        const map: Record<string, string> = {};
        const pics: Record<string, string> = {};
        for (const person of result.people) {
          if (person.imageUrl) {
            pics[person.userId] = person.imageUrl;
            pics[lineHandle(person.userId)] = person.imageUrl;
            pics[lineHandle(person.userId).toLowerCase()] = person.imageUrl;
          }
          // The line shows trimmed handles, sometimes lowercased.
          const handle = lineHandle(person.userId);
          map[person.userId] = person.displayName;
          map[handle] = person.displayName;
          map[handle.toLowerCase()] = person.displayName;
        }
        setNames(map);
        setPhotos(pics);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [enabled]);
  return Object.assign(names, { __photos: photos }) as Record<string, string> & { __photos: Record<string, string> };
}

function CallDesk({ wantId, want, video, answering }: { wantId: string; want: string; video: boolean; answering: boolean }) {
  const navigate = useNavigate();
  const line = useLine();
  const { user, isPending } = useCurrentUserState();
  const { member, ready } = useFirebaseMember();
  const asked = useRef("");
  const call = line.call;
  const names = usePeopleNames(Boolean(user));
  const nameOf = (value: string) => names[value] ?? value;

  useEffect(() => {
    const target = (wantId || want).trim();
    const key = `${target}:${video ? "1" : "0"}`;
    if (!target || line.phase !== "online" || asked.current === key) return;
    asked.current = key;
    askLine(target, video, want.trim());
    // The call is placed: take "who to call" out of the address, so a refresh (or reopening the app) never calls them again.
    void navigate({ to: "/calls", search: { to: "", name: "", video: "" }, replace: true });
  }, [wantId, want, video, line.phase]);

  // "Answering a call" from a notification: once the call is here (or after a while), the address forgets it too.
  useEffect(() => {
    if (!answering) return;
    const forget = () => void navigate({ to: "/calls", search: { to: "", name: "", video: "" }, replace: true });
    if (call) {
      forget();
      return;
    }
    const timer = window.setTimeout(forget, 45000);
    return () => window.clearTimeout(timer);
  }, [answering, Boolean(call)]);

  const glass = useGlassCalls();
  return (
    <div className={`call-stand${glass ? " is-glass" : ""}`}>
      {call && !glass ? (
        <div className="relative min-h-[70dvh]">
          <Stream stream={call.remote} muted className="absolute inset-0 h-full w-full bg-black object-cover" />
          {call.local && !call.cameraOff ? <Stream stream={call.local} muted className="absolute top-3 right-3 z-10 aspect-[3/4] w-28 rounded-xl bg-zinc-900 object-cover" /> : null}
          <div className="relative z-10 px-4 pt-8 text-center text-white">
            <p className="text-3xl font-semibold">{nameOf(call.name)}</p>
            <p className="mt-1 text-base text-white/80">{call.status}</p>
            {call.emojis ? <p className="mt-3 text-3xl tracking-widest">{call.emojis}</p> : null}
            {call.route ? <p className="mt-2 text-sm text-white/70">{call.route}</p> : null}
          </div>
          <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center gap-3 px-4">
            {call.incoming ? (
              <>
                <button type="button" className="min-h-14 min-w-28 rounded-full bg-red-600 text-base font-bold text-white" onClick={declineCall}>
                  Decline
                </button>
                <button type="button" className="min-h-14 min-w-28 rounded-full bg-[#2fb36d] text-base font-bold text-white" onClick={acceptCall}>
                  Accept
                </button>
              </>
            ) : (
              <>
                <button type="button" className="min-h-14 min-w-24 rounded-full bg-white/20 text-sm font-bold text-white" onClick={() => muteCall(!call.muted)}>
                  {call.muted ? "Unmute" : "Mute"}
                </button>
                <button type="button" className="min-h-14 min-w-24 rounded-full bg-white/20 text-sm font-bold text-white" onClick={() => cameraCall(!call.cameraOff)}>
                  {call.cameraOff ? "Camera on" : "Camera"}
                </button>
                {canChooseEarpiece() ? (
                  <button type="button" className="min-h-14 min-w-24 rounded-full bg-white/20 text-sm font-bold text-white" aria-pressed={call.speaker} onClick={() => speakerCall(!call.speaker)}>
                    {call.speaker ? "🔊 Speaker" : "🔈 Earpiece"}
                  </button>
                ) : null}
                <button type="button" className="min-h-14 min-w-24 rounded-full bg-red-600 text-sm font-bold text-white" onClick={hangUp}>
                  End
                </button>
              </>
            )}
          </div>
        </div>
      ) : glass ? (
        <GlassList
          line={line}
          nameOf={nameOf}
          photoOf={(id, name) => names.__photos[id] ?? names.__photos[id.toLowerCase()] ?? names.__photos[name] ?? null}
          answering={answering}
          showSignIn={line.phase !== "online" && ready && !member}
          showSignInNote={line.phase !== "online" && !ready && !isPending && !user}
          onBack={() => void navigate({ to: "/next" })}
          onInvite={() => void navigate({ to: "/invite" })}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-white">Calls</h1>
            <button type="button" className="tool-key" onClick={() => void navigate({ to: "/next" })}>
              Back
            </button>
          </div>
          {line.note ? <p className="mt-3 text-base text-white">{line.note}</p> : null}
          {line.note.startsWith("Ringing") ? (
            <button type="button" className="mt-3 min-h-11 rounded-full bg-red-600 px-5 text-sm font-bold text-white" onClick={cancelRinging}>
              Cancel
            </button>
          ) : null}
          {answering && !line.note ? <p className="mt-3 text-base text-white">Connecting you to your caller… their call will appear here in a moment.</p> : null}
          {line.phase === "opening" ? <p className="mt-2 text-sm text-white/70">This phone is waking the line. You can stay on this page.</p> : null}
          {line.phase !== "online" && ready && !member ? (
            <button type="button" className="mt-4 min-h-12 w-full rounded-full bg-[#2fb36d] text-base font-bold text-white" onClick={() => void signInForCalls()}>
              Sign in with Google
            </button>
          ) : null}
          {line.phase !== "online" && !ready && !isPending && !user ? <p className="mt-4 text-base text-white">Sign in to call.</p> : null}
          {line.phase === "online" ? (
            <>
              <p className="mt-2 text-sm text-white/70">You're on the line{line.me && line.me !== line.name ? ` as ${line.me}` : ""}.</p>
              <ul className="mt-4">
                {line.people.length === 0 ? <li className="py-6 text-center text-sm text-white/70">No one else is online right now.</li> : null}
                {line.people.map((person) => (
                  <li key={person.id} className="flex items-center gap-3 border-b border-white/10 py-3">
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-white">{nameOf(person.name)}</span>
                    <button type="button" className="min-h-12 min-w-20 rounded-full bg-[#1f2e26] text-sm font-bold text-[#2fb36d]" onClick={() => callPerson(person.id, nameOf(person.name), false)}>
                      Voice
                    </button>
                    <button type="button" className="min-h-12 min-w-20 rounded-full bg-[#1f2e26] text-sm font-bold text-[#2fb36d]" onClick={() => callPerson(person.id, nameOf(person.name), true)}>
                      Video
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="mt-4 min-h-12 w-full rounded-full bg-white/10 text-sm font-bold text-white" onClick={() => setDirect(!line.direct)}>
                {line.direct ? "Direct connection is on" : "Direct connection is off"}
              </button>
              <button type="button" className="mt-3 min-h-12 w-full rounded-full bg-white/10 text-sm font-bold text-white" onClick={goOffline}>
                Go offline
              </button>
            </>
          ) : null}
          <button type="button" className="mt-4 min-h-12 w-full rounded-full bg-white text-sm font-bold text-black" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </>
      )}
    </div>
  );
}

/** The Calls page in the glass look: same information and the same buttons, only a new face. */
function GlassList({
  line,
  nameOf,
  photoOf,
  answering,
  showSignIn,
  showSignInNote,
  onBack,
  onInvite,
}: {
  line: ReturnType<typeof useLine>;
  nameOf: (value: string) => string;
  photoOf: (id: string, name: string) => string | null;
  answering: boolean;
  showSignIn: boolean;
  showSignInNote: boolean;
  onBack: () => void;
  onInvite: () => void;
}) {
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return (
    <div className="cl-panel">
      <div className="cl-head">
        <h1>Calls</h1>
        <button type="button" className="cl-back" onClick={onBack}>
          Back
        </button>
      </div>
      {line.phase === "online" ? (
        <p className="cl-me">
          <i />
          You're on the line{line.me && line.me !== line.name ? ` as ${line.me}` : ""}
        </p>
      ) : null}
      {line.note ? <p className="cl-note">{line.note}</p> : null}
      {line.note.startsWith("Ringing") ? (
        <button type="button" className="cl-cancel" onClick={cancelRinging}>
          Cancel
        </button>
      ) : null}
      {answering && !line.note ? <p className="cl-note">Connecting you to your caller… their call will appear here in a moment.</p> : null}
      {line.phase === "opening" ? <p className="cl-note">This phone is waking the line. You can stay on this page.</p> : null}
      {showSignIn ? (
        <button type="button" className="cl-signin" onClick={() => void signInForCalls()}>
          Sign in with Google
        </button>
      ) : null}
      {showSignInNote ? <p className="cl-note">Sign in to call.</p> : null}
      {line.phase === "online" ? (
        line.people.length ? (
          <>
            <p className="cl-label">ONLINE NOW · {line.people.length}</p>
            <ul className="cl-list">
              {line.people.map((person) => {
                const name = nameOf(person.name);
                const photo = photoOf(person.id, person.name);
                return (
                  <li key={person.id} className="cl-person">
                    <span className="cl-face">{photo ? <img src={photo} alt="" /> : <b>{initials(name)}</b>}</span>
                    <span className="cl-name">
                      {name}
                      <small>online</small>
                    </span>
                    <button type="button" className="cl-key" aria-label={`Voice call ${name}`} onClick={() => callPerson(person.id, name, false)}>
                      📞
                    </button>
                    <button type="button" className="cl-key is-video" aria-label={`Video call ${name}`} onClick={() => callPerson(person.id, name, true)}>
                      🎥
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="cl-empty">
            <span className="butterfly butterfly-still cl-fly" aria-hidden="true">
              <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
              <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
            </span>
            <p>No one else is online right now.</p>
            <p>When someone opens Porchbook, they'll appear here.</p>
            <button type="button" className="cl-invite" onClick={onInvite}>
              Invite someone
            </button>
          </div>
        )
      ) : null}
      <div className="cl-foot">
        {line.phase === "online" ? (
          <>
            <button type="button" className={line.direct ? "is-on" : ""} onClick={() => setDirect(!line.direct)}>
              ⚡ Direct: {line.direct ? "on" : "off"}
            </button>
            <button type="button" onClick={goOffline}>
              Go offline
            </button>
          </>
        ) : null}
        <button type="button" onClick={() => window.location.reload()}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
