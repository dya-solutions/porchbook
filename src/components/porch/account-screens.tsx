// Stage 5c: the account steps, in the brand look.
//   1. Confirm your email (a 6-digit code sent through Brevo).
//   2. Not in a church: a friendly home (find your church with its invite code or link, start a
//      porch, the porches you run, the FAQ). Then a join request with full name, phone and city
//      (each with one line saying why; N2). Admins let you in.
//   3. Waiting: "Your request is with [church]'s admins".
//   4. Members with details missing are asked for them the next time they open the app.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { signOut } from "@/lib/auth/client";
import { actAs, checkInvite, cleanCode, myPorches } from "@/lib/porch/porch-join";
import {
  accountState,
  cancelJoinRequest,
  DETAIL_FIELDS,
  requestToJoin,
  saveMyDetails,
  sendEmailCode,
  verifyEmailCode,
  type MemberDetails,
} from "@/lib/porch/membership";
import { BrandLogo } from "@/components/porch/brand-logo";
import { reloadPorchLook, usePorchLook } from "@/components/porch/pb-shell";
import { keepJoinCode, keptJoinCode } from "@/components/porch/welcome-screen";
import { keepJoinPorch, keptJoinPorch } from "@/components/porch/public-views";
import { churchToJoin } from "@/lib/porch/public-porch";

export type Account = Awaited<ReturnType<typeof accountState>>;

/* ---------- The account, loaded once per visit ---------- */
let account: Account | null = null;
let loading: Promise<Account> | null = null;
const watchers = new Set<(value: Account) => void>();

export function reloadAccount() {
  loading = null;
  account = null;
  void loadAccount();
}
function loadAccount(seed?: { displayName: string; email: string | null }) {
  loading ??= accountState({ data: { displayName: seed?.displayName ?? "", email: seed?.email ?? null } })
    .then((value) => {
      account = value;
      watchers.forEach((fn) => fn(value));
      return value;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
export function useAccount(userId: string | undefined) {
  const user = useCurrentUser();
  const [value, setValue] = useState<Account | null>(account);
  useEffect(() => {
    if (!userId) return;
    watchers.add(setValue);
    if (account) setValue(account);
    else void loadAccount({ displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null }).catch(() => undefined);
    return () => {
      watchers.delete(setValue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return value;
}

/* ---------- The page around each step ---------- */
function StepPage({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="pb pb-legacy welcome">
      <div className="welcome-in" style={{ gap: 16, maxWidth: wide ? 520 : 440 }}>
        <BrandLogo kind="tile" height={36} className="welcome-logo-olive" />
        <h1 className="pb-ttl" style={{ fontSize: 28, lineHeight: 1.15 }}>{title}</h1>
        {children}
        <p className="pb-quiet" style={{ margin: "8px 0 0", fontSize: 14, textAlign: "center" }}>
          <Link to="/faq" className="welcome-link" style={{ fontWeight: 600 }}>Questions?</Link>
          {" · "}
          <button type="button" className="welcome-link" style={{ fontWeight: 400, color: "var(--pb-quiet)" }} onClick={() => void signOut().then(() => window.location.replace("/"))}>
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}

/* ---------- 1. Confirm your email ---------- */
export function VerifyEmail({ email }: { email: string }) {
  const [code, setCode] = useState("");
  const [testCode, setTestCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setError("");
    const result = await sendEmailCode().catch(() => null);
    if (!result?.ok) {
      setError(result?.error ?? "Couldn't send the code. Try again.");
      return;
    }
    if (result.already) {
      reloadAccount();
      return;
    }
    setTestCode(result.testCode);
    setNote(result.testCode ? "" : `We sent a 6-digit code to ${email}. It works for 15 minutes. Check your spam folder too.`);
  }
  useEffect(() => {
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await verifyEmailCode({ data: { code } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't work. Try again.");
      return;
    }
    reloadAccount();
  }

  return (
    <StepPage title="Confirm your email">
      <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        {note || `We're sending a 6-digit code to ${email}.`}
      </p>
      {testCode ? (
        <p className="acct-test">
          Test mode on this computer (no email service set up yet): your code is <b>{testCode}</b>
        </p>
      ) : null}
      <form className="pb-card welcome-card" onSubmit={onSubmit}>
        <label className="ofc-lbl" htmlFor="email-code" style={{ margin: 0 }}>The code from the email</label>
        <input
          id="email-code"
          className="ofc-input acct-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
        />
        {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
        <button type="submit" className="pb-btn" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Confirm"}</button>
      </form>
      <button type="button" className="pb-link" style={{ alignSelf: "center", color: "var(--pb-main)" }} onClick={() => void send()}>
        Send a new code
      </button>
    </StepPage>
  );
}

/* ---------- The details, each with why it's asked ---------- */
function DetailsFields({ details, onChange, only }: { details: MemberDetails; onChange: (next: MemberDetails) => void; only?: string[] }) {
  return (
    <>
      {DETAIL_FIELDS.filter((field) => !only || only.includes(field.label)).map((field) => (
        <label key={field.key} className="ofc-lbl">
          {field.label}
          <span className="acct-why">{field.why}</span>
          <input
            className="ofc-input"
            value={details[field.key]}
            maxLength={field.key === "phone" ? 30 : field.key === "city" ? 60 : 80}
            inputMode={field.key === "phone" ? "tel" : undefined}
            autoComplete={field.key === "fullName" ? "name" : field.key === "phone" ? "tel" : "address-level2"}
            onChange={(event) => onChange({ ...details, [field.key]: event.target.value })}
            placeholder={field.key === "phone" ? "+256 700 000000" : field.key === "city" ? "e.g. Mbarara" : "First and last name"}
          />
        </label>
      ))}
    </>
  );
}

/* ---------- 2. Not in a church: invite code, then the join request ---------- */
export function JoinChurch({ account: me }: { account: Account }) {
  const user = useCurrentUser();
  const [code, setCode] = useState("");
  const [church, setChurch] = useState<{ code: string; porchId?: number; name: string; place: string } | null>(null);
  const [details, setDetails] = useState<MemberDetails>({ fullName: me.fullName && me.fullName !== me.username ? me.fullName : "", phone: "", city: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Someone not in a church yet may still run porches (a ministry porch, or a church still waiting
  // they started) or be the platform owner: show those here, so this screen is never a dead end.
  const look = usePorchLook();
  const [started, setStarted] = useState<{ id: number; name: string; kind: string; status: string }[]>([]);
  useEffect(() => {
    myPorches().then(setStarted).catch(() => undefined);
  }, []);

  // A code from an invite link (or typed before making the account) is used straight away.
  useEffect(() => {
    const kept = keptJoinCode();
    if (kept) {
      void check(kept, true);
      return;
    }
    // N5: "Ask to join" on a church found in Find porches opens its join form here.
    const asked = keptJoinPorch();
    if (asked) {
      void churchToJoin({ data: { porchId: asked } })
        .then((result) => {
          if (result.ok) setChurch({ code: "", porchId: result.id, name: result.name, place: result.place });
          else keepJoinPorch(0);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(value: string, quiet = false) {
    setError("");
    setBusy(true);
    const result = await checkInvite({ data: { code: value } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      if (!quiet) setError(result?.error ?? "Couldn't check that code.");
      keepJoinCode("");
      return;
    }
    keepJoinCode(result.code);
    setCode(result.code);
    setChurch({ code: result.code, name: result.name, place: result.place });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!church) return;
    setBusy(true);
    setError("");
    const result = await requestToJoin({
      data: { code: church.code, porchId: church.porchId ?? 0, ...details, displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null },
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    keepJoinCode("");
    keepJoinPorch(0);
    reloadAccount();
  }

  if (!church) {
    const ministries = me.ministries;
    const churchesStarted = started.filter((porch) => porch.kind === "church");
    return (
      <StepPage title={me.username ? `Welcome, @${me.username}` : "Welcome to Porchbook"}>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          Follow churches and ministries on the public porch, join your church's private porch, or start a porch of your own.
        </p>
        {me.lastDeclined ? (
          <p className="acct-note">Your request to join {me.lastDeclined} wasn't accepted. You can ask your church about it, or try another church.</p>
        ) : null}
        {/* Stage 6: the public porch and Find porches come first for someone with no church. */}
        <div className="pb-card welcome-card pp-home">
          <p className="ofc-lbl" style={{ margin: 0, fontSize: 17 }}>The public porch</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Posts from the churches and ministries you follow. React with Love, Like, Touching or Deep.
          </p>
          <Link to="/" search={{ room: "all", view: "public" } as never} className="pb-btn" style={{ textDecoration: "none" }}>
            Open the public porch
          </Link>
          <Link to="/find" className="pb-btn2" style={{ textDecoration: "none" }}>
            Find porches
          </Link>
        </div>
        <form
          className="pb-card welcome-card"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = code.trim();
            if (typed) void check(cleanCode(typed.includes("/join/") ? typed.split("/join/")[1] ?? "" : typed));
          }}
        >
          <p className="ofc-lbl" style={{ margin: 0, fontSize: 17 }}>Join your church</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Type the invite code, or paste the invite link, your church gave you. Or find it by name in <Link to="/find" className="welcome-link" style={{ minHeight: 0 }}>Find porches</Link> and tap Ask to join. Its admins look at your request and let you in.
          </p>
          <label className="sr-only" htmlFor="join-code">Invite code or link</label>
          <input id="join-code" className="ofc-input" value={code} placeholder="e.g. K7QM-4XPA" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(event) => setCode(event.target.value)} />
          {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
          <button type="submit" className="pb-btn" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Find my church"}</button>
        </form>
        {ministries.length || churchesStarted.length ? (
          <div className="pb-card welcome-card">
            <p className="ofc-lbl" style={{ margin: 0, fontSize: 17 }}>Porches you run</p>
            {ministries.map((ministry) => (
              <div key={ministry.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
                  <strong>{ministry.name}</strong>{" "}
                  <span className="pb-quiet">· Ministry ({ministry.typeName}) · {statusWords(ministry.status)}</span>
                </p>
                <button type="button" className="pb-btn2" onClick={() => void actAs({ data: { porchId: ministry.id } }).then(() => window.location.replace("/?room=all"))}>
                  Continue as {ministry.name}
                </button>
              </div>
            ))}
            {churchesStarted.map((porch) => (
              <p key={porch.id} style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
                <strong>{porch.name}</strong> <span className="pb-quiet">· Church · {statusWords(porch.status)}</span>
              </p>
            ))}
          </div>
        ) : null}
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0, fontSize: 17 }}>Start a porch</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            For a church (with members) or a ministry (run by its admins, with followers). Porchbook checks every new porch before it can post publicly.
          </p>
          <Link to="/start" className="pb-btn2" style={{ textDecoration: "none" }}>Start a porch</Link>
        </div>
        {look?.owner ? (
          <Link to="/porches-waiting" className="pb-btn2" style={{ textDecoration: "none" }}>Porches waiting for approval</Link>
        ) : null}
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0, fontSize: 17 }}>Questions?</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            How joining works, what a ministry porch is, and who can see your details.
          </p>
          <Link to="/faq" className="pb-btn2" style={{ textDecoration: "none" }}>Help and FAQ</Link>
        </div>
      </StepPage>
    );
  }

  return (
    <StepPage title={`Ask to join ${church.name}`} wide>
      <p className="welcome-joining" style={{ margin: 0 }}>
        {church.name}
        {church.place ? ` · ${church.place}` : ""}
      </p>
      <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        {church.name} asks for these three details. Only you and {church.name}'s admins can see them. They're never shown to another church or on the public porch.
      </p>
      <form className="pb-card ofc-form" onSubmit={send}>
        <DetailsFields details={details} onChange={setDetails} />
        {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
        <button type="submit" className="pb-btn" disabled={busy}>{busy ? "Sending…" : "Send my request"}</button>
      </form>
      <button
        type="button"
        className="pb-link"
        style={{ alignSelf: "center" }}
        onClick={() => {
          keepJoinCode("");
          keepJoinPorch(0);
          setChurch(null);
          setCode("");
        }}
      >
        Choose another church
      </button>
    </StepPage>
  );
}

function statusWords(status: string) {
  return status === "waiting" ? "waiting for approval" : status === "approved" ? "approved" : status === "declined" ? "not approved" : status;
}

/* ---------- 3. Waiting for the church's admins ---------- */
export function WaitingToJoin({ account: me }: { account: Account }) {
  const [busy, setBusy] = useState(false);
  // Check again now and then, so the porch opens as soon as an admin lets them in.
  useEffect(() => {
    const timer = window.setInterval(() => {
      reloadAccount();
      reloadPorchLook();
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <StepPage title="Your request is on its way">
      <div className="pb-card" style={{ padding: 16 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{me.waiting?.porchName}</p>
        <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.5 }}>
          Your request is with the church's admins. When they let you in, your church's porch opens here.
        </p>
      </div>
      <Link to="/" search={{ room: "all", view: "public" } as never} className="pb-btn2" style={{ textDecoration: "none" }}>
        Look at the public porch meanwhile
      </Link>
      <button
        type="button"
        className="pb-link"
        style={{ alignSelf: "center" }}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void cancelJoinRequest().then(() => reloadAccount());
        }}
      >
        Take back my request
      </button>
    </StepPage>
  );
}

/* ---------- 4. Members: missing details, asked once per visit ---------- */
let skippedThisVisit = false;
export function detailsSkipped() {
  return skippedThisVisit;
}
export function MissingDetails({ account: me, onDone }: { account: Account; onDone: () => void }) {
  const user = useCurrentUser();
  const [details, setDetails] = useState<MemberDetails>({ fullName: user?.displayName ?? "", phone: "", city: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import("@/lib/porch/membership").then(({ myDetails }) =>
      myDetails().then((result) => setDetails(result.details)).catch(() => undefined),
    );
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await saveMyDetails({ data: details }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't save. Try again.");
      return;
    }
    reloadAccount();
    onDone();
  }
  return (
    <StepPage title="A few details for your church" wide>
      <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        {me.porchName} keeps these details for each member: full name, phone and city. Only you and {me.porchName}'s admins can see them. You can change them any time in Your account → My details.
      </p>
      <form className="pb-card ofc-form" onSubmit={save}>
        <DetailsFields details={details} onChange={setDetails} />
        {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
        <button type="submit" className="pb-btn" disabled={busy}>{busy ? "Saving…" : "Save my details"}</button>
      </form>
      <button
        type="button"
        className="pb-link"
        style={{ alignSelf: "center" }}
        onClick={() => {
          skippedThisVisit = true;
          onDone();
        }}
      >
        Not now
      </button>
    </StepPage>
  );
}

export { DetailsFields };
