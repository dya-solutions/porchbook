// The landing page (decision 44): Log in or Create account. Invite links keep their code here.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { checkInvite } from "@/lib/porch/porch-join";
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

/** The main logo (brand/porchbook-logo-tile.svg): white on olive here, olive on cream on sign-in. */
function Brand({ onOlive = true }: { onOlive?: boolean }) {
  return <BrandLogo kind="tile" height={onOlive ? 44 : 36} className={onOlive ? "" : "welcome-logo-olive"} />;
}

/**
 * Signed out: the landing page (decision 44). Only two choices: Log in, or Create account.
 * `account` draws the card for the choice. An invite link's church is named on the card, and the
 * join request follows once the account exists (account-screens.tsx: JoinChurch).
 * Starting a porch is inside the app now (Your account, and the public porch).
 */
export function WelcomeScreen({ account }: { account?: (mode: "join" | "enter", note: ReactNode) => ReactNode; signedIn?: boolean }) {
  const [porch, setPorch] = useState<{ name: string; place: string } | null>(null);
  const [mode, setMode] = useState<"" | "join" | "enter">("");

  // A code from an invite link: say which church invited them.
  useEffect(() => {
    const kept = keptJoinCode();
    if (!kept) return;
    checkInvite({ data: { code: kept } })
      .then((result) => {
        if (result.ok) setPorch({ name: result.name, place: result.place });
        else keepJoinCode("");
      })
      .catch(() => undefined);
  }, []);

  const invited = porch ? (
    <p className="welcome-joining">
      Invited to <b>{porch.name}</b>
      {porch.place ? ` · ${porch.place}` : ""}
    </p>
  ) : null;

  if (mode && account) {
    return (
      <main className="pb pb-legacy welcome">
        <div className="welcome-in">
          <button type="button" className="pb-link" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setMode("")}>
            ← Back
          </button>
          <Brand onOlive={false} />
          {account(mode, invited)}
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
            Fellowship with your church family, reach your church offices, and follow the ministries you love.
          </p>
        </div>
        <div style={{ flex: 1, minHeight: 24 }} />
        {porch ? (
          <div className="pb-card welcome-card">
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
              You're invited to join <b>{porch.name}</b>. Create your account (or log in), then send your request.
            </p>
          </div>
        ) : null}
        <div className="pb-card welcome-card">
          <button type="button" className="pb-btn" onClick={() => setMode("join")}>
            Create account <Arrow />
          </button>
          <button type="button" className="pb-btn2" onClick={() => setMode("enter")}>
            Log in
          </button>
        </div>
        <p className="welcome-small" style={{ margin: 0, textAlign: "center", fontSize: 14 }}>
          <Link to="/faq" className="welcome-link">Questions?</Link>
          {" · "}
          <Link to="/privacy" className="welcome-link" style={{ fontWeight: 400 }}>Privacy</Link>
        </p>
      </div>
    </main>
  );
}
