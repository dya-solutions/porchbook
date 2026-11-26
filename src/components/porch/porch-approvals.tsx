// Stage 5a: the platform owner's "Porches waiting for approval" list, and "Your porches" for
// anyone who started or runs a porch.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { decidePorch, myPorches, waitingPorches } from "@/lib/porch/porch-join";
import { kindName } from "@/lib/porch/porch-kinds";
const statusName = (status: string) =>
  status === "waiting" ? "Waiting for approval" : status === "approved" ? "Approved" : status === "declined" ? "Declined" : "Paused";

type Ready = Extract<Awaited<ReturnType<typeof waitingPorches>>, { ok: true }>;
type Waiting = Ready["porches"][number];

export function PorchApprovals() {
  const [porches, setPorches] = useState<Waiting[] | null>(null);
  const [changed, setChanged] = useState<Ready["changed"]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(0);

  const load = () =>
    waitingPorches()
      .then((result) => {
        if (!result.ok) setError(result.error);
        else {
          setPorches(result.porches);
          setChanged(result.changed);
        }
      })
      .catch(() => setError("Couldn't load the list."));
  useEffect(() => {
    void load();
  }, []);

  async function decide(porch: Waiting, approve: boolean) {
    setBusy(porch.id);
    const result = await decidePorch({ data: { id: porch.id, approve } }).catch(() => null);
    setBusy(0);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setNote(`${porch.name} ${approve ? "is approved" : "was declined"}.`);
    void load();
  }

  return (
    <div className="pb ps">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>Porches waiting for approval</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
          New porches work privately until you approve them. Only approved porches can post publicly.
        </p>
      </div>
      {error ? <p className="text-danger">{error}</p> : null}
      {note ? <p className="pb-quiet" role="status" style={{ margin: 0 }}>{note}</p> : null}
      {porches && porches.length === 0 ? (
        <div className="pb-card" style={{ padding: 16 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Nothing waiting</p>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 14 }}>New porches will show here.</p>
        </div>
      ) : null}
      {(porches ?? []).map((porch) => (
        <div key={porch.id} className="pb-card ofc-form">
          <div>
            <p className="ofc-name">{porch.name}</p>
            <p className="ofc-hint" style={{ whiteSpace: "normal" }}>
              {kindName(porch.kind)}
              {porch.ministryType ? ` · ${porch.ministryType}` : ""}
              {porch.place ? ` · ${porch.place}` : ""}
              {porch.starter ? ` · started by ${porch.starter}` : ""}
            </p>
            {porch.description ? (
              <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                <span className="ofc-lbl" style={{ display: "block", margin: "0 0 2px" }}>What it does</span>
                {porch.description}
              </p>
            ) : null}
            {porch.mainName ? (
              <p className="ofc-hint" style={{ whiteSpace: "normal" }}>Says it is a branch of {porch.mainName} (linking comes later)</p>
            ) : null}
          </div>
          <div className="ofc-admin">
            <button type="button" className="pb-btn" disabled={busy === porch.id} onClick={() => void decide(porch, true)}>
              Approve
            </button>
            <button type="button" className="pb-btn2" disabled={busy === porch.id} onClick={() => void decide(porch, false)}>
              Decline
            </button>
          </div>
        </div>
      ))}
      {changed.length ? (
        <div className="pb-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Changed to Ministry on 26 November</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>
            Psalmist and Organisation porches are now ministries of the type "Other", named after their old type. Their admins stay; they have no members.
          </p>
          {changed.map((porch) => (
            <p key={porch.id} style={{ margin: 0, fontSize: 15 }}>
              <strong>{porch.name}</strong> <span className="pb-quiet">· was {porch.was} · now Ministry ({porch.typeName}) · {statusName(porch.status).toLowerCase()}</span>
            </p>
          ))}
        </div>
      ) : null}
      <Link to="/" search={{ room: "all" } as never} className="pb-link" style={{ alignSelf: "flex-start" }}>
        ← Back
      </Link>
    </div>
  );
}

/** Your account → Your porches: the porches you run, and where each stands. */
export function YourPorches() {
  const [porches, setPorches] = useState<Awaited<ReturnType<typeof myPorches>>>([]);
  useEffect(() => {
    myPorches()
      .then(setPorches)
      .catch(() => undefined);
  }, []);
  if (!porches.length) return null;
  return (
    <section className="pb">
      <h2 className="pb-ttl" style={{ fontSize: 20, margin: "8px 4px 8px" }}>Your porches</h2>
      <div className="pb-card ofc-list" style={{ marginTop: 0 }}>
        {porches.map((porch) => (
          <div key={porch.id} className="ofc-row">
            <span className="ofc-words">
              <span className="ofc-name" style={{ fontSize: 15 }}>{porch.name}</span>
              <span className="ofc-hint">{kindName(porch.kind)} · you're an admin</span>
            </span>
            <span className={`pb-tag ${porch.status === "approved" ? "is-green" : "is-quiet"}`}>{statusName(porch.status)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
