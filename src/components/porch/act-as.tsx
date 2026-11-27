// N3 (decision 43): one login for everyone. Someone who runs a ministry switches between "Me" and
// the ministry by tapping their picture or the porch badge: "Continue as me / Continue as [ministry]".
// While acting as a ministry the whole app becomes the ministry's own screen (with a clear
// "Acting as" bar), and their church's private porch is closed until they're "me" again.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { actAs, ministryHome, ministryTeamMessages, sendMinistryTeamMessage } from "@/lib/porch/porch-join";
import { formatWhen } from "@/lib/porch/model";
import { initialsOf } from "@/components/porch/pb-shell";
import type { Account } from "@/components/porch/account-screens";
import { BrandLogo } from "@/components/porch/brand-logo";
import { PorchPublicDesk } from "@/components/porch/public-views";
import { AdminsPanel } from "@/components/porch/admins-panel";

async function switchTo(porchId: number) {
  const result = await actAs({ data: { porchId } }).catch(() => null);
  if (result?.ok) window.location.replace("/?room=all");
  return result;
}

/** The "Continue as" sheet. */
export function ActAsSheet({
  account,
  me,
  churchName,
  onClose,
}: {
  account: Account;
  me: { id: string; name: string; imageUrl: string | null };
  churchName: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const actingId = account.acting?.id ?? 0;
  const go = async (porchId: number) => {
    if (porchId === actingId) return onClose();
    setBusy(porchId || -1);
    setError("");
    const result = await switchTo(porchId);
    if (!result?.ok) {
      setBusy(0);
      setError(result?.error ?? "That didn't work. Try again.");
    }
  };
  return (
    <div className="pb pb-scrim" role="presentation" onClick={onClose}>
      <div className="pb-sheet" role="dialog" aria-modal="true" aria-label="Continue as" onClick={(event) => event.stopPropagation()}>
        <p className="pb-ttl" style={{ fontSize: 20 }}>Continue as</p>
        <button type="button" className={`pb-as${!actingId ? " is-on" : ""}`} disabled={busy !== 0} onClick={() => void go(0)}>
          <span className="pb-me" aria-hidden="true">{me.imageUrl ? <img src={me.imageUrl} alt="" /> : initialsOf(me.name)}</span>
          <span className="pb-as-words">
            <strong>Me{account.username ? ` (@${account.username})` : ""}</strong>
            <small>{churchName ? `Your church: ${churchName}` : "Not in a church yet"}</small>
          </span>
          {!actingId ? <span className="pb-tag is-green">Now</span> : null}
        </button>
        {account.ministries.map((ministry) => (
          <button key={ministry.id} type="button" className={`pb-as${actingId === ministry.id ? " is-on" : ""}`} disabled={busy !== 0} onClick={() => void go(ministry.id)}>
            <span className="pb-logo is-ministry" aria-hidden="true">{initialsOf(ministry.name)}</span>
            <span className="pb-as-words">
              <strong>{ministry.name}</strong>
              <small>
                {ministry.kind === "church" ? "Church · post on the public porch for it" : `Ministry · ${ministry.typeName}`}
                {ministry.status === "waiting" ? " · waiting for approval" : ""}
              </small>
            </span>
            {actingId === ministry.id ? <span className="pb-tag is-green">Now</span> : null}
          </button>
        ))}
        {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
        {!actingId ? (
          <Link to="/people/$userId" params={{ userId: me.id }} className="pb-link" onClick={onClose} style={{ alignSelf: "center" }}>
            My profile
          </Link>
        ) : null}
        <button type="button" className="pb-link" style={{ alignSelf: "center" }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

type Home = Extract<Awaited<ReturnType<typeof ministryHome>>, { ok: true }>;

/** The whole app while acting as a ministry: its own screen, impossible to mistake for "me". */
export function MinistryShell({ account, me }: { account: Account; me: { id: string; name: string; imageUrl: string | null } }) {
  const [home, setHome] = useState<Home | null>(null);
  const [sheet, setSheet] = useState(false);
  const ministry = account.acting;
  useEffect(() => {
    ministryHome()
      .then((result) => {
        if (result.ok) setHome(result);
        else void switchTo(0);
      })
      .catch(() => undefined);
  }, []);
  if (!ministry) return null;
  return (
    <main className="pb pb-legacy ministry-shell">
      <div className="pb-acting" role="status">
        <span>
          Acting as <strong>{ministry.name}</strong>
        </span>
        <button type="button" onClick={() => void switchTo(0)}>
          Continue as me
        </button>
      </div>
      <header className="pb-top">
        <button type="button" className="pb-logo is-ministry" aria-label={`${ministry.name}: switch who you're acting as`} onClick={() => setSheet(true)}>
          {initialsOf(ministry.name)}
        </button>
        <div className="pb-top-name">
          <p className="pb-ttl">{ministry.name}</p>
          <p>{ministry.kind === "church" ? "Church · its public side" : `Ministry · ${ministry.typeName}`}</p>
        </div>
        <button type="button" className="pb-me is-acting" aria-label="Switch who you're acting as" onClick={() => setSheet(true)}>
          {me.imageUrl ? <img src={me.imageUrl} alt="" /> : initialsOf(me.name)}
        </button>
      </header>
      <div className="welcome-in" style={{ gap: 14, paddingTop: 8 }}>
        {/* Stage 6: post on the public porch for this porch, its posts, and its description. */}
        <PorchPublicDesk
          porchId={ministry.id}
          porchName={ministry.name}
          approved={ministry.status === "approved"}
          description={home?.description ?? ""}
          country={home?.country ?? ""}
          onDescription={(description) => setHome((current) => (current ? { ...current, description } : current))}
        />
        {/* Stage 5d: a ministry's admins and their levels (Lead admin, Public page editor). A church's
            admins are managed under Porch settings → Admins, as yourself. */}
        {ministry.kind === "ministry" ? (
          <AdminsPanel compact />
        ) : (
          <div className="pb-card welcome-card">
            <p className="ofc-lbl" style={{ margin: 0 }}>The admin team</p>
            <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>Change the church's admins as yourself: Your account → Admins.</p>
            {(home?.admins ?? []).map((admin) => (
              <p key={admin.userId} style={{ margin: 0, fontSize: 15 }}>
                {admin.username ? `@${admin.username}` : admin.name}
                {admin.userId === me.id ? <span className="pb-quiet"> (you)</span> : null}
              </p>
            ))}
          </div>
        )}
        <TeamMessages ministryName={ministry.name} />
        <button type="button" className="pb-btn2" onClick={() => void switchTo(0)}>
          Continue as me
        </button>
        <p className="pb-quiet" style={{ margin: 0, textAlign: "center", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <BrandLogo kind="mark" height={18} /> Porchbook
        </p>
      </div>
      {sheet ? <ActAsSheet account={account} me={me} churchName={account.porchName} onClose={() => setSheet(false)} /> : null}
    </main>
  );
}

type TeamMessage = Extract<Awaited<ReturnType<typeof ministryTeamMessages>>, { ok: true }>["messages"][number];

/** N7: the ministry's admins write to each other here (nobody else can read it). */
function TeamMessages({ ministryName }: { ministryName: string }) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    ministryTeamMessages()
      .then((result) => result.ok && setMessages(result.messages))
      .catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    const result = await sendMinistryTeamMessage({ data: { body } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't send. Try again.");
      return;
    }
    setBody("");
    void load();
  }
  return (
    <div className="pb-card welcome-card">
      <p className="ofc-lbl" style={{ margin: 0 }}>Team messages</p>
      <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>Only {ministryName}'s admins can read and write here.</p>
      {messages.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {messages.map((message) => (
            <div key={message.id} style={{ alignSelf: message.mine ? "flex-end" : "flex-start", maxWidth: "85%", background: message.mine ? "var(--pb-main-soft, #e6ecd9)" : "var(--pb-raised)", borderRadius: 14, padding: "8px 12px" }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>
                {message.mine ? "You" : `@${message.name}`} <span className="pb-quiet" style={{ fontWeight: 400 }}>· {formatWhen(message.at)}</span>
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 15, whiteSpace: "pre-wrap" }}>{message.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>No messages yet.</p>
      )}
      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input className="ofc-input" style={{ flex: 1 }} value={body} maxLength={1000} placeholder="Write to the team" onChange={(event) => setBody(event.target.value)} />
        <button type="submit" className="pb-btn" style={{ width: "auto", padding: "0 18px" }} disabled={busy || !body.trim()}>
          Send
        </button>
      </form>
      {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
    </div>
  );
}
