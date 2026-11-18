import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Avatar, CallLink } from "@/components/porch/bits";
import { choosePresence, onlineState, usePorch } from "@/lib/porch/presence-store";
import type { PresenceStatus } from "@/lib/porch/presence";

/** The small screen above TOUR/READ: who's on the porch, names gliding right to left. Tap for the list. */
export function OnlineTicker({ strip = false }: { strip?: boolean } = {}) {
  const porch = usePorch();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!porch.loaded) return <div className={strip ? "ot-strip" : "ot-slot"} />;
  const hidden = porch.status === "hidden";
  const names = porch.people;
  const line = hidden
    ? porch.count
      ? `${porch.count} here · show yourself to see who`
      : "Show yourself to see who's on"
    : names.length
      ? null
      : "Just you on the porch right now";
  // Long lists glide a little slower so every name can be read.
  const seconds = Math.max(10, names.reduce((sum, person) => sum + person.name.length + 5, 0) * 0.32);

  return (
    <div ref={box} className={strip ? "ot-strip" : "ot-slot"}>
      <button type="button" className="ot-screen" aria-expanded={open} aria-label="Who's on the porch" onClick={() => setOpen((value) => !value)}>
        <span className="ot-head">
          <i className={porch.count ? "is-on" : ""} />
          {strip ? `${porch.count} on the porch` : `ON THE PORCH · ${porch.count}`}
        </span>
        <span className="ot-track">
          {line ? (
            <span className="ot-still">{line}</span>
          ) : (
            <span className="ot-run" style={{ animationDuration: `${seconds}s` }}>
              {[0, 1].map((copy) => (
                <span key={copy} className="ot-copy" aria-hidden={copy === 1}>
                  {names.map((person) => (
                    <span key={person.userId} className={`ot-name${person.idle ? " is-idle" : ""}`}>
                      {person.name}
                      {person.dnd ? " ⊘" : person.idle ? " ☾" : ""}
                      <b>•</b>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {open ? (
        <div className="ot-list" role="dialog" aria-label="On the porch">
          {hidden ? (
            <div className="ot-empty">
              <p>{porch.count ? `${porch.count} on the porch right now.` : "Nobody else is on right now."}</p>
              <p>Show yourself to see who's here.</p>
              <button type="button" className="ot-show" onClick={() => void choosePresence("online")}>
                Show me as online
              </button>
            </div>
          ) : names.length ? (
            <ul>
              {names.map((person) => (
                <li key={person.userId}>
                  <Link to="/people/$userId" params={{ userId: person.userId }} className="ot-who" onClick={() => setOpen(false)}>
                    <Avatar name={person.name} imageUrl={person.imageUrl} userId={person.userId} />
                    <span>
                      <b>{person.name}</b>
                      <small>{person.dnd ? "Do not disturb" : person.idle ? "Idle" : "Online"}</small>
                    </span>
                  </Link>
                  <CallLink userId={person.userId} name={person.name} className="ot-act" />
                  <Link to="/messages/$userId" params={{ userId: person.userId }} className="ot-act" aria-label={`Message ${person.name}`} onClick={() => setOpen(false)}>
                    <Mail className="size-5 text-[#7ed321]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ot-empty">Just you on the porch right now.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A small dot on someone's picture while they're on the porch. */
export function PresenceDot({ userId }: { userId: string }) {
  usePorch();
  const state = onlineState(userId);
  if (!state) return null;
  return <span className={`presence-dot is-${state}`} aria-label={state === "dnd" ? "Do not disturb" : state === "idle" ? "Idle" : "Online"} />;
}

const CHOICES: { status: PresenceStatus; mark: string; label: string; hint: string }[] = [
  { status: "online", mark: "●", label: "Online", hint: "Others see you're on" },
  { status: "dnd", mark: "⊘", label: "Do not disturb", hint: "Seen, but calls and rings stay quiet" },
  { status: "hidden", mark: "◌", label: "Hidden", hint: "Not shown; you see only a count" },
];

/** In the ME menu: how you appear. */
export function PresenceChoice() {
  const porch = usePorch();
  return (
    <div className="pc-box" role="group" aria-label="How you appear">
      <p className="pc-title">You appear as</p>
      {CHOICES.map((choice) => (
        <button
          key={choice.status}
          type="button"
          role="menuitemradio"
          aria-checked={porch.status === choice.status}
          className={`pc-item is-${choice.status}${porch.status === choice.status ? " is-picked" : ""}`}
          onClick={() => void choosePresence(choice.status)}
        >
          <span className="pc-mark">{choice.mark}</span>
          <span>
            <b>{choice.label}</b>
            <small>{choice.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Once: invite a member to show themselves on the porch. */
export function PresenceInvite() {
  const porch = usePorch();
  const [gone, setGone] = useState(true);
  useEffect(() => {
    try {
      setGone(localStorage.getItem("porch-presence-asked") === "1");
    } catch {
      setGone(false);
    }
  }, []);
  if (gone || !porch.loaded || porch.chose) return null;
  const done = () => {
    setGone(true);
    try {
      localStorage.setItem("porch-presence-asked", "1");
    } catch {
      /* fine */
    }
  };
  return (
    <div className="pi-card" role="dialog" aria-label="Show you're on the porch">
      <p>Let the porch see you're here?</p>
      <div>
        <button
          type="button"
          className="pi-yes"
          onClick={() => {
            done();
            void choosePresence("online");
          }}
        >
          Show me
        </button>
        <button type="button" className="pi-no" onClick={done}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** PC side panel: everyone on the porch, always shown (no gliding), with call and message buttons. */
export function PorchPanel() {
  const porch = usePorch();
  if (!porch.loaded) return null;
  const hidden = porch.status === "hidden";
  return (
    <section className="pc-card" aria-label="On the porch">
      <p className="pc-lab">
        <i className={porch.count ? "is-on" : ""} /> On the porch · {porch.count}
      </p>
      {hidden ? (
        <div className="pc-empty">
          <p>{porch.count ? `${porch.count} on the porch right now.` : "Nobody else is on right now."}</p>
          <button type="button" className="ot-show" onClick={() => void choosePresence("online")}>
            Show me as online
          </button>
        </div>
      ) : porch.people.length ? (
        <ul className="pc-people">
          {porch.people.map((person) => (
            <li key={person.userId}>
              <Link to="/people/$userId" params={{ userId: person.userId }} className="ot-who">
                <Avatar name={person.name} imageUrl={person.imageUrl} userId={person.userId} />
                <span>
                  <b>{person.name}</b>
                  <small>{person.dnd ? "Do not disturb" : person.idle ? "Idle" : "Online"}</small>
                </span>
              </Link>
              <CallLink userId={person.userId} name={person.name} className="ot-act" />
              <Link to="/messages/$userId" params={{ userId: person.userId }} className="ot-act" aria-label={`Message ${person.name}`}>
                <Mail className="size-5 text-[#7ed321]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pc-empty">Just you on the porch right now.</p>
      )}
    </section>
  );
}
