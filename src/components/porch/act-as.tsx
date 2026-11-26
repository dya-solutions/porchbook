// N3 (decision 43): one login for everyone. Someone who runs a ministry switches between "Me" and
// the ministry by tapping their picture or the porch badge: "Continue as me / Continue as [ministry]".
// While acting as a ministry the whole app becomes the ministry's own screen (with a clear
// "Acting as" bar), and their church's private porch is closed until they're "me" again.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { actAs, ministryHome } from "@/lib/porch/porch-join";
import { initialsOf } from "@/components/porch/pb-shell";
import type { Account } from "@/components/porch/account-screens";
import { BrandLogo } from "@/components/porch/brand-logo";

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
                Ministry · {ministry.typeName}
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
          <p>Ministry · {ministry.typeName}</p>
        </div>
        <button type="button" className="pb-me is-acting" aria-label="Switch who you're acting as" onClick={() => setSheet(true)}>
          {me.imageUrl ? <img src={me.imageUrl} alt="" /> : initialsOf(me.name)}
        </button>
      </header>
      <div className="welcome-in" style={{ gap: 14, paddingTop: 8 }}>
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0 }}>What {ministry.name} does</p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {home ? home.description || "No description yet. Porches started before 26 November didn't have one." : "…"}
          </p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>
            {[home?.country, ministry.status === "waiting" ? "Waiting for approval" : ministry.status === "approved" ? "Approved" : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0 }}>The admin team</p>
          {(home?.admins ?? []).map((admin) => (
            <p key={admin.userId} style={{ margin: 0, fontSize: 15 }}>
              {admin.name}
              {admin.username ? <span className="pb-quiet"> · @{admin.username}</span> : null}
              {admin.userId === me.id ? <span className="pb-quiet"> (you)</span> : null}
            </p>
          ))}
        </div>
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0 }}>Coming with the public porch</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Posting for {ministry.name}, and seeing who follows it. A ministry has no members or private porch: its admins post on the public porch for it.
          </p>
        </div>
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
