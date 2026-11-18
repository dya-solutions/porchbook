import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { answerCallAsk, dismissCall, incomingCall, listCallAsks, revokeCall, type CallPerson } from "@/lib/porch/call-ask";
import { primeCallAudio } from "@/lib/porch/call-audio";
import { quietButtonClass, startTone, stopTone, tap } from "@/components/porch/bits";

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

export function IncomingCall() {
  const seed = useSeed();
  const navigate = useNavigate();
  const [call, setCall] = useState<{ userId: string; name: string; imageUrl: string | null; at: string; video?: boolean } | null>(null);
  const closed = useRef("");

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const load = () => {
      incomingCall({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
        .then((result) => {
          if (cancel) return;
          const next = result.call;
          if (!next) {
            setCall(null);
            return;
          }
          const here = new URLSearchParams(window.location.search).get("userId");
          if (window.location.pathname.startsWith("/call") && here === next.userId) {
            setCall(null);
            return;
          }
          if (`${next.userId}|${next.at}` === closed.current) return;
          setCall(next);
        })
        .catch(() => undefined);
    };
    const first = window.setTimeout(load, 300);
    const timer = window.setInterval(load, 800);
    return () => {
      cancel = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  useEffect(() => {
    if (!call) {
      stopTone();
      return;
    }
    startTone("in");
    return () => stopTone();
  }, [call?.userId, call?.at]);

  if (!call) return null;

  const time = new Date(call.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const initial = call.name.trim().slice(0, 1).toUpperCase() || "P";
  const card = (
    <div
      className="call-incoming px-3"
      style={{ position: "fixed", zIndex: 200, inset: 0, display: "grid", alignItems: "center", padding: "1rem", background: "rgba(0,0,0,0.72)", pointerEvents: "auto" }}
    >
      <div className="mx-auto max-w-md rounded-3xl bg-[#14120f] px-4 py-4 text-white shadow-2xl ring-1 ring-[#f8a018]/40">
        <div className="flex items-center gap-3">
          <span className="relative size-12 shrink-0">
            {call.imageUrl ? (
              <img src={call.imageUrl} alt="" className="size-12 rounded-full object-cover" />
            ) : (
              <span className="grid size-12 place-items-center rounded-full bg-[#f8a018] text-lg font-semibold text-black">{initial}</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-base font-semibold">{call.name}</p>
              <p className="shrink-0 text-xs text-white/70">{time}</p>
            </div>
            <p className="text-sm text-white/80">{call.video ? "Incoming video call" : "Incoming voice call"}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="min-h-12 rounded-full bg-[#e23b3b] text-base font-semibold text-white"
            onClick={() => {
              tap(20);
              stopTone();
              closed.current = `${call.userId}|${call.at}`;
              setCall(null);
              void dismissCall({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } });
            }}
          >
            Decline
          </button>
          <button
            type="button"
            className="min-h-12 rounded-full bg-[#1f9d4a] text-base font-semibold text-white"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              primeCallAudio();
              tap(20);
              stopTone();
              const userId = call.userId;
              const video = Boolean(call.video);
              closed.current = `${userId}|${call.at}`;
              setCall(null);
              void dismissCall({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl, answered: true } });
              const here = new URLSearchParams(window.location.search).get("userId");
              if (window.location.pathname.startsWith("/call") && here === userId) {
                window.dispatchEvent(new CustomEvent("porch-answer", { detail: { video, pick: true } }));
                return;
              }
              void navigate({ to: "/call", search: { userId, join: "1", video: video ? "1" : "", pick: "1" } });
            }}
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(card, document.body);
}

export function CallAskBanner() {
  const seed = useSeed();
  const [asks, setAsks] = useState<CallPerson[]>([]);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const load = () => {
      listCallAsks({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
        .then((result) => {
          if (!cancel) setAsks(result.asks);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  async function answer(callerId: string, allow: boolean) {
    const result = await answerCallAsk({
      data: { callerId, allow, displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl },
    });
    if (!result.ok) return;
    setAsks((current) => current.filter((person) => person.userId !== callerId));
  }

  if (!asks.length) return null;

  return (
    <div className="border-b border-line bg-card">
      <ul className="mx-auto max-w-6xl space-y-2 px-4 py-3 lg:px-6">
        {asks.map((person) => (
          <li key={person.userId} className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm text-ink">{person.name} asks to call you.</p>
            <button type="button" className={quietButtonClass} onClick={() => void answer(person.userId, true)}>
              Allow
            </button>
            <button type="button" className={quietButtonClass} onClick={() => void answer(person.userId, false)}>
              No
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CallAllowList() {
  const seed = useSeed();
  const [people, setPeople] = useState<CallPerson[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    listCallAsks({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
      .then((result) => {
        if (cancel) return;
        setPeople(result.allowed);
        setReady(true);
      })
      .catch(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  async function takeBack(callerId: string) {
    const result = await revokeCall({
      data: { callerId, displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl },
    });
    if (!result.ok) return;
    setPeople((current) => current.filter((person) => person.userId !== callerId));
  }

  if (!ready) return null;

  return (
    <section className="rounded-3xl glass-edge bg-card p-5">
      <h2 className="font-display text-2xl text-ink">Who may call you</h2>
      {people.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No one may call you yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {people.map((person) => (
            <li key={person.userId} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate font-semibold text-ink">{person.name}</span>
              <button type="button" className={`${quietButtonClass} text-danger`} onClick={() => void takeBack(person.userId)}>
                Take back
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
