// Start a porch (decisions 38, 41, 44, 45), inside the app for a signed-in person:
//   1. Church or Ministry, the name, and the country (a searchable list of all nations);
//      a church can say it is a branch (the main porch is recorded; linking branches is Stage 7);
//   2. for a ministry: its type (Music, Teaching, Other + its name) and what it does;
//   3. done: the porch waits for the platform owner's approval.
// Signed out, /start shows the landing page (Log in / Create account) instead.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { findMainPorches, startPorch } from "@/lib/porch/porch-join";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, MINISTRY_TYPES, PORCH_KINDS, kindName, type MinistryType, type PorchKind } from "@/lib/porch/porch-kinds";
import { reloadPorchLook } from "@/components/porch/pb-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { CountryPicker } from "@/components/porch/country-picker";
import { Welcome } from "@/components/porch/frame";

type Draft = {
  kind: PorchKind;
  name: string;
  country: string;
  branch: boolean;
  mainPorchId: number;
  mainName: string;
  ministryType: MinistryType | "";
  ministryOther: string;
  description: string;
};
const EMPTY: Draft = { kind: "church", name: "", country: "", branch: false, mainPorchId: 0, mainName: "", ministryType: "", ministryOther: "", description: "" };

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export function StartPorch() {
  const { user, isPending } = useCurrentUserState();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const creating = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; kind: PorchKind; code: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: number; name: string; place: string }[]>([]);

  useEffect(() => {
    if (!draft.branch || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      findMainPorches({ data: { query } })
        .then((rows) => !cancel && setFound(rows))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query, draft.branch]);

  if (isPending) return null;
  if (!user) return <Welcome />;

  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const ministry = draft.kind === "ministry";
  const steps = ministry ? 3 : 2;
  const shownStep = step === 3 ? steps : step;

  async function create() {
    if (!user || creating.current) return;
    // Only one start at a time: a double tap must not send the same porch twice.
    creating.current = true;
    setBusy(true);
    setError("");
    const result = await startPorch({
      data: { ...draft, displayName: user.displayName ?? "", email: user.primaryEmail ?? null },
    }).catch(() => null);
    creating.current = false;
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    reloadPorchLook();
    setDone({ name: result.name, kind: result.kind, code: result.code });
    setStep(3);
  }

  function next() {
    setError("");
    if (draft.name.trim().length < 3) return setError("Give the porch its name.");
    if (!draft.country) return setError("Choose the country from the list.");
    if (draft.branch && !draft.mainPorchId) return setError("Find the main church's porch, or switch off \"This is a branch\".");
    if (ministry) setStep(2);
    else void create();
  }

  function finishMinistry() {
    setError("");
    if (!draft.ministryType) return setError("Choose what type of ministry it is.");
    if (draft.ministryType === "other" && draft.ministryOther.trim().length < 2) return setError("Name the type of ministry.");
    if (draft.description.trim().length < DESCRIPTION_MIN) return setError("Describe what the ministry does, in a sentence or two.");
    void create();
  }

  return (
    <main className="pb pb-legacy welcome">
      <div className="welcome-in" style={{ gap: 18 }}>
        <header className="pb-row">
          {step === 3 ? null : step === 2 ? (
            <button type="button" className="pb-iconbtn" aria-label="Back" onClick={() => setStep(1)}>
              <BackIcon />
            </button>
          ) : (
            <Link to="/" search={{ room: "all" } as never} className="pb-iconbtn" aria-label="Back">
              <BackIcon />
            </Link>
          )}
          <p className="pb-quiet" style={{ margin: 0, fontSize: 15, flex: 1 }}>
            Step {shownStep} of {steps}
          </p>
        </header>

        {step === 1 ? (
          <>
            <div>
              <h1 className="pb-ttl" style={{ fontSize: 30 }}>Start a porch</h1>
              <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 }}>
                A church porch is a home for your members. A ministry porch is run by its admins, and people follow it.
              </p>
            </div>
            <div>
              <p className="ofc-lbl" style={{ marginBottom: 8 }}>What kind of porch?</p>
              <div className="start-kinds" role="radiogroup" aria-label="What kind of porch?">
                {PORCH_KINDS.map((kind) => (
                  <button
                    key={kind.key}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === kind.key}
                    className={`pb-chip${draft.kind === kind.key ? " is-on" : ""}`}
                    onClick={() => set({ kind: kind.key, branch: kind.key === "church" ? draft.branch : false })}
                  >
                    {kind.name}
                  </button>
                ))}
              </div>
              <p className="pb-quiet" style={{ margin: "8px 2px 0", fontSize: 13 }}>
                {ministry
                  ? "A ministry has a team of admins and followers, no members. You'll be its first admin, and you stay in your own church."
                  : "A church has members. You'll be its first member and admin. A person belongs to one church."}
              </p>
            </div>
            <label className="ofc-lbl">
              Name
              <input
                className="ofc-input"
                value={draft.name}
                maxLength={80}
                onChange={(event) => set({ name: event.target.value })}
                placeholder={ministry ? "e.g. Voices of Grace" : "e.g. Grace Community Church"}
              />
            </label>
            <CountryPicker value={draft.country} onChange={(country) => set({ country })} />
            {!ministry ? (
              <div className="pb-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <label className="pb-row" style={{ cursor: "pointer" }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 16 }}>This is a branch</span>
                    <span className="pb-quiet" style={{ display: "block", fontSize: 13, marginTop: 2 }}>Link to your main church's porch</span>
                  </span>
                  <span className={`pb-switch${draft.branch ? " is-on" : ""}`}>
                    <input type="checkbox" checked={draft.branch} onChange={() => set({ branch: !draft.branch, mainPorchId: 0, mainName: "" })} aria-label="This is a branch" />
                  </span>
                </label>
                {draft.branch ? (
                  draft.mainPorchId ? (
                    <p style={{ margin: 0, fontSize: 15 }}>
                      Main porch: <b>{draft.mainName}</b>{" "}
                      <button type="button" className="welcome-link" onClick={() => set({ mainPorchId: 0, mainName: "" })}>
                        Change
                      </button>
                    </p>
                  ) : (
                    <>
                      <label className="pb-search">
                        <span className="sr-only">Find the main porch</span>
                        <span className="pb-search-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
                            <circle cx="11" cy="11" r="7" />
                            <path d="M20 20l-4-4" />
                          </svg>
                        </span>
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find the main porch" />
                      </label>
                      {found.map((porch) => (
                        <button key={porch.id} type="button" className="ofc-row pb-card" style={{ textAlign: "left", font: "inherit", padding: "10px 14px" }} onClick={() => set({ mainPorchId: porch.id, mainName: porch.name })}>
                          <span className="ofc-words">
                            <span className="ofc-name" style={{ fontSize: 15 }}>{porch.name}</span>
                            <span className="ofc-hint">{porch.place}</span>
                          </span>
                        </button>
                      ))}
                      {query.trim().length >= 2 && !found.length ? <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>No approved church porch by that name yet.</p> : null}
                    </>
                  )
                ) : null}
              </div>
            ) : null}
            {error ? <p className="text-danger" style={{ margin: 0 }}>{error}</p> : null}
            <button type="button" className="pb-btn" disabled={busy} onClick={next}>
              {busy ? "Starting…" : "Continue"}
            </button>
            <p className="pb-quiet" style={{ margin: "-6px 0 0", textAlign: "center", fontSize: 13 }}>
              Every porch is checked before it can post publicly.
            </p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div>
              <h1 className="pb-ttl" style={{ fontSize: 30 }}>About {draft.name.trim() || "the ministry"}</h1>
              <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 }}>
                This is shown when the porch is checked for approval, and later to people who find it.
              </p>
            </div>
            <div>
              <p className="ofc-lbl" style={{ marginBottom: 8 }}>What type of ministry?</p>
              <div className="start-kinds" role="radiogroup" aria-label="What type of ministry?">
                {MINISTRY_TYPES.map((type) => (
                  <button
                    key={type.key}
                    type="button"
                    role="radio"
                    aria-checked={draft.ministryType === type.key}
                    className={`pb-chip${draft.ministryType === type.key ? " is-on" : ""}`}
                    onClick={() => set({ ministryType: type.key })}
                  >
                    {type.name}
                  </button>
                ))}
              </div>
            </div>
            {draft.ministryType === "other" ? (
              <label className="ofc-lbl">
                Name the type of ministry
                <input className="ofc-input" value={draft.ministryOther} maxLength={40} onChange={(event) => set({ ministryOther: event.target.value })} placeholder="e.g. Prayer, Outreach, Youth" />
              </label>
            ) : null}
            <label className="ofc-lbl">
              What does the ministry do?
              <textarea
                className="ofc-input"
                rows={4}
                value={draft.description}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => set({ description: event.target.value })}
                placeholder="A sentence or two, e.g. We lead worship nights and teach young singers in Mbarara."
                style={{ resize: "vertical", minHeight: 110 }}
              />
              <span className="pb-quiet" style={{ fontSize: 12, fontWeight: 400, alignSelf: "flex-end" }}>
                {draft.description.trim().length}/{DESCRIPTION_MAX}
              </span>
            </label>
            {error ? <p className="text-danger" style={{ margin: 0 }}>{error}</p> : null}
            <button type="button" className="pb-btn" disabled={busy} onClick={finishMinistry}>
              {busy ? "Starting…" : "Start the ministry"}
            </button>
          </>
        ) : null}

        {step === 3 && done ? (
          <>
            <div>
              <h1 className="pb-ttl" style={{ fontSize: 30 }}>{done.name}</h1>
              <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 }}>
                {done.kind === "church"
                  ? "Your church porch is waiting for approval. It works privately now; it can post publicly once it's approved."
                  : `Your ${kindName(done.kind).toLowerCase()} porch is waiting for approval. Once it's approved, you'll post for it on the public porch.`}
              </p>
            </div>
            {done.code ? (
              <div className="pb-card" style={{ padding: 16 }}>
                <p className="ofc-lbl" style={{ margin: 0 }}>Your church's invite code</p>
                <p className="start-code">{done.code}</p>
                <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>
                  Share it with your members. You'll find it, and its invite link, under Invite.
                </p>
              </div>
            ) : (
              <p className="pb-quiet" style={{ margin: 0 }}>You'll find it under Your account → Your porches.</p>
            )}
            <button type="button" className="pb-btn" onClick={() => window.location.replace("/?room=all")}>
              {done.kind === "church" ? "Open your porch" : "Continue"}
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
