// Stage 5a: Start a porch (design-reference/StartPorch.dc.html), in 3 steps:
//   1. what kind, its name, town and country, and "This is a branch" (the main porch is recorded;
//      linking branches is Stage 7);
//   2. your account (skipped when you're already signed in);
//   3. done: the porch waits for the platform owner's approval.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { findMainPorches, PORCH_KINDS, startPorch, type PorchKind } from "@/lib/porch/porch-join";
import { reloadPorchLook } from "@/components/porch/pb-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const START_KEY = "porch-start";
type Draft = { kind: PorchKind; name: string; place: string; branch: boolean; mainPorchId: number; mainName: string };
const EMPTY: Draft = { kind: "church", name: "", place: "", branch: false, mainPorchId: 0, mainName: "" };

function readDraft(): Draft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(START_KEY) || "null");
    return raw && typeof raw === "object" ? { ...EMPTY, ...raw } : null;
  } catch {
    return null;
  }
}
function keepDraft(draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(START_KEY, JSON.stringify(draft));
    else localStorage.removeItem(START_KEY);
  } catch {
    /* fine */
  }
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function StartPorch({ account }: { account: (note: ReactNode) => ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const creating = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; kind: PorchKind; code: string | null; current: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: number; name: string; place: string }[]>([]);

  // Coming back after creating the account: carry on with the porch already typed.
  useEffect(() => {
    const kept = readDraft();
    if (kept) setDraft(kept);
  }, []);
  useEffect(() => {
    if (isPending || !user || step !== 2) return;
    void create(readDraft() ?? draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPending, step]);
  useEffect(() => {
    if (!user || isPending) return;
    const kept = readDraft();
    if (kept && step === 1 && kept.name) setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPending]);

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

  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  async function create(details: Draft) {
    if (!user || creating.current) return;
    // Only one start at a time: a sign-in refresh mid-way must not send the same porch twice.
    creating.current = true;
    keepDraft(null);
    setBusy(true);
    setError("");
    const result = await startPorch({
      data: { ...details, displayName: user.displayName ?? "", email: user.primaryEmail ?? null },
    }).catch(() => null);
    creating.current = false;
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through. Try again.");
      setStep(1);
      keepDraft(null);
      return;
    }
    keepDraft(null);
    reloadPorchLook();
    setDone({ name: result.name, kind: result.kind, code: result.code, current: result.current !== false });
    setStep(3);
  }

  function next() {
    setError("");
    if (draft.name.trim().length < 3) return setError("Give the porch its name.");
    if (!draft.place.trim()) return setError("Add the town and country.");
    if (draft.branch && !draft.mainPorchId) return setError("Find the main church's porch, or switch off \"This is a branch\".");
    // The draft is kept only for someone who still has to sign in first.
    if (user) void create(draft);
    else {
      keepDraft(draft);
      setStep(2);
    }
  }

  const kindName = (kind: PorchKind) => PORCH_KINDS.find((item) => item.key === kind)?.name ?? "Porch";

  return (
    <main className="pb pb-legacy welcome">
      <div className="welcome-in" style={{ gap: 18 }}>
        <header className="pb-row">
          {step === 3 ? null : step === 2 ? (
            <button type="button" className="pb-iconbtn" aria-label="Back" onClick={() => setStep(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          ) : (
            <Link to="/" search={{ room: "all" } as never} className="pb-iconbtn" aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </Link>
          )}
          <p className="pb-quiet" style={{ margin: 0, fontSize: 15, flex: 1 }}>Step {step} of 3</p>
        </header>

        {step === 1 ? (
          <>
            <div>
              <h1 className="pb-ttl" style={{ fontSize: 30 }}>Start a porch</h1>
              <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 }}>
                A private home for your people, and a public page others can follow.
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
                {"Every porch has members, and you'll be its first member and admin."}
              </p>
            </div>
            <label className="ofc-lbl">
              Name
              <input className="ofc-input" value={draft.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} placeholder="e.g. Grace Community Church" />
            </label>
            <label className="ofc-lbl">
              Town and country
              <input className="ofc-input" value={draft.place} maxLength={80} onChange={(event) => set({ place: event.target.value })} placeholder="e.g. Mbarara, Uganda" />
            </label>
            {draft.kind === "church" ? (
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
          user ? (
            <p className="pb-quiet">{busy ? "Starting your porch…" : error}</p>
          ) : (
            account(
              <p className="welcome-joining">
                Starting <b>{draft.name}</b> · {kindName(draft.kind)}
              </p>,
            )
          )
        ) : null}

        {step === 3 && done ? (
          <>
            <div>
              <h1 className="pb-ttl" style={{ fontSize: 30 }}>{done.name}</h1>
              <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 }}>
                Your {kindName(done.kind).toLowerCase()} porch is waiting for approval. It works privately now; it can post publicly once it's approved.
              </p>
            </div>
            {!done.current ? (
              <p className="pb-quiet" style={{ margin: 0 }}>It's one of your porches now. Switching between your porches comes with the next update.</p>
            ) : null}
            {done.code ? (
              <div className="pb-card" style={{ padding: 16 }}>
                <p className="ofc-lbl" style={{ margin: 0 }}>Your porch's invite code</p>
                <p className="start-code">{done.code}</p>
                <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>
                  Share it with your members. You'll find it, and its invite link, under Invite.
                </p>
              </div>
            ) : (
              <p className="pb-quiet" style={{ margin: 0 }}>You'll find this porch under Your account → Your porches.</p>
            )}
            <button type="button" className="pb-btn" onClick={() => window.location.replace("/?room=all")}>
              {done.current ? "Open your porch" : "Continue"}
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
