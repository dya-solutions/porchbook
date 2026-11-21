// Stage 5a: the Welcome screen (design-reference/Main.dc.html): join your church's porch with an
// invite code, start a porch, or sign in. Also the "join your church" step for someone signed in
// who isn't in a church yet.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { checkInvite, joinWithCode } from "@/lib/porch/porch-join";
import { reloadPorchLook } from "@/components/porch/pb-shell";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { signOut } from "@/lib/auth/client";
import { BrandLogo } from "@/components/porch/brand-logo";

/** The invite code waiting on this phone (from a typed code or an invite link) until the account exists. */
export const JOIN_CODE_KEY = "porch-join-code";
export function keptJoinCode() {
  try {
    return localStorage.getItem(JOIN_CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function keepJoinCode(code: string) {
  try {
    if (code) localStorage.setItem(JOIN_CODE_KEY, code);
    else localStorage.removeItem(JOIN_CODE_KEY);
  } catch {
    /* fine */
  }
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const Plus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** The main logo (brand/porchbook-logo-tile.svg): white on olive here, olive on cream on sign-in. */
function Brand({ onOlive = true }: { onOlive?: boolean }) {
  return <BrandLogo kind="tile" height={onOlive ? 44 : 36} className={onOlive ? "" : "welcome-logo-olive"} />;
}

/**
 * Signed out: the welcome. `account` draws the sign-up / sign-in card once the person has chosen.
 * Signed in without a church: `signedIn` shows only joining (and starting a porch).
 */
export function WelcomeScreen({ account, signedIn = false }: { account?: (mode: "join" | "enter", note: ReactNode) => ReactNode; signedIn?: boolean }) {
  const user = useCurrentUser();
  const [code, setCode] = useState("");
  const [porch, setPorch] = useState<{ code: string; name: string; place: string } | null>(null);
  const [mode, setMode] = useState<"" | "join" | "enter">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A code from an invite link (or typed before signing up) is used straight away.
  useEffect(() => {
    const kept = keptJoinCode();
    if (!kept) return;
    setCode(kept);
    void check(kept, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(value: string, quiet = false) {
    setError("");
    setBusy(true);
    const result = await checkInvite({ data: { code: value } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      if (!quiet) setError(result?.error ?? "Couldn't check that code. Try again.");
      else keepJoinCode("");
      return;
    }
    keepJoinCode(result.code);
    setPorch({ code: result.code, name: result.name, place: result.place });
    if (signedIn) await join(result.code);
    else setMode("join");
  }

  async function join(value: string) {
    if (!user) return;
    setBusy(true);
    const result = await joinWithCode({ data: { code: value, displayName: user.displayName ?? "", email: user.primaryEmail ?? null } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "Couldn't join. Try again.");
      keepJoinCode("");
      return;
    }
    keepJoinCode("");
    reloadPorchLook();
    window.location.replace("/?room=all");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    void check(code);
  }

  if (!signedIn && mode && account) {
    const note = porch && mode === "join" ? (
      <p className="welcome-joining">
        Joining <b>{porch.name}</b>
        {porch.place ? ` · ${porch.place}` : ""}
      </p>
    ) : null;
    return (
      <main className="pb pb-legacy welcome">
        <div className="welcome-in">
          <button type="button" className="pb-link" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setMode("")}>
            ← Back
          </button>
          <Brand onOlive={false} />
          {account(mode, note)}
        </div>
      </main>
    );
  }

  return (
    <main className="pb pb-legacy welcome is-olive">
      <div className="welcome-in">
        <Brand />
        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 className="pb-ttl" style={{ fontSize: 40, lineHeight: 1.08 }}>
            Your church,
            <br />
            <span className="welcome-hi">on one porch.</span>
          </h1>
          <p className="welcome-tagline" style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>
            {signedIn
              ? "You're signed in. Join your church's porch with the invite code your church gave you."
              : "Fellowship with your church family, reach your church offices, and follow porches you love."}
          </p>
        </div>
        <div style={{ flex: 1, minHeight: 24 }} />
        <form className="pb-card welcome-card" onSubmit={onSubmit}>
          <label className="ofc-lbl" htmlFor="invite-code" style={{ margin: 0 }}>
            Join your church's porch
          </label>
          <input
            id="invite-code"
            className="ofc-input"
            placeholder="Enter the invite code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
          <button type="submit" className="pb-btn" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Join porch"} <Arrow />
          </button>
        </form>
        <Link to="/start" className="pb-btn2 welcome-start" style={{ textDecoration: "none" }}>
          <Plus /> Start a porch
        </Link>
        <p className="welcome-small" style={{ margin: "-8px 0 0", textAlign: "center", fontSize: 13 }}>
          For churches, ministries, artists and organisations
        </p>
        {signedIn ? (
          <p style={{ margin: 0, textAlign: "center", fontSize: 15 }}>
            Not you?{" "}
            <button type="button" className="welcome-link" onClick={() => void signOut().then(() => window.location.replace("/"))}>
              Sign out
            </button>
          </p>
        ) : (
          <p style={{ margin: 0, textAlign: "center", fontSize: 15 }}>
            Already a member?{" "}
            <button type="button" className="welcome-link" onClick={() => setMode("enter")}>
              Sign in
            </button>
          </p>
        )}
        <Link to="/privacy" className="pb-quiet" style={{ textAlign: "center", fontSize: 13 }}>
          Privacy
        </Link>
      </div>
    </main>
  );
}
