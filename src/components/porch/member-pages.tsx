// Stage 5c: "People waiting to join" (church admins), "My details" (each member, with the
// username and the "show my church" switch), and member details on a profile (church admins only).
import { useEffect, useState, type FormEvent } from "react";
import {
  decideJoinRequest,
  memberDetailsOf,
  myDetails,
  saveMyDetails,
  setHideChurch,
  setUsername,
  waitingToJoin,
  type MemberDetails,
  type WaitingPerson,
} from "@/lib/porch/membership";
import { DetailsFields, reloadAccount } from "@/components/porch/account-screens";
import { formatWhen } from "@/lib/porch/model";

/* ---------- Church admins: People waiting to join ---------- */
export function WaitingList() {
  const [people, setPeople] = useState<WaitingPerson[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(0);
  const load = () =>
    waitingToJoin()
      .then((result) => {
        if (!result.ok) setError(result.error);
        else setPeople(result.people);
      })
      .catch(() => setError("Couldn't load the list."));
  useEffect(() => {
    void load();
  }, []);
  async function decide(person: WaitingPerson, letIn: boolean) {
    setBusy(person.id);
    const result = await decideJoinRequest({ data: { id: person.id, letIn } }).catch(() => null);
    setBusy(0);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setNote(letIn ? `${person.fullName} is now a member.` : `${person.fullName}'s request was declined.`);
    void load();
  }
  return (
    <div className="pb ps">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>People waiting to join</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
          Nobody joins your church without an admin letting them in. Check that you know the person.
        </p>
      </div>
      {error ? <p className="text-danger">{error}</p> : null}
      {note ? <p className="pb-quiet" role="status" style={{ margin: 0 }}>{note}</p> : null}
      {people && !people.length ? (
        <div className="pb-card" style={{ padding: 16 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Nobody is waiting</p>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 14 }}>New requests show here, and you get a notification.</p>
        </div>
      ) : null}
      {(people ?? []).map((person) => (
        <div key={person.id} className="pb-card ofc-form">
          <div>
            <p className="ofc-name">{person.fullName}</p>
            <p className="ofc-hint" style={{ whiteSpace: "normal" }}>Asked {formatWhen(person.since)}</p>
          </div>
          <dl className="acct-dl">
            <dt>Nation</dt>
            <dd>{person.nation}</dd>
            <dt>Phone</dt>
            <dd>{person.phone}</dd>
            <dt>Address</dt>
            <dd>{person.address}</dd>
            <dt>Email</dt>
            <dd>{person.email}</dd>
          </dl>
          <div className="ofc-admin">
            <button type="button" className="pb-btn" disabled={busy === person.id} onClick={() => void decide(person, true)}>Let in</button>
            <button type="button" className="pb-btn2" disabled={busy === person.id} onClick={() => void decide(person, false)}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Each member: My details ---------- */
export function MyDetailsPage() {
  const [details, setDetails] = useState<MemberDetails | null>(null);
  const [member, setMember] = useState(false);
  const [username, setName] = useState("");
  const [hide, setHide] = useState(false);
  const [note, setNote] = useState("");
  const [nameNote, setNameNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    myDetails()
      .then((result) => {
        setDetails(result.details);
        setMember(result.member);
        setName(result.username);
        setHide(result.hideChurch);
      })
      .catch(() => setNote("Couldn't open your details."));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!details) return;
    setBusy(true);
    const result = await saveMyDetails({ data: details }).catch(() => null);
    setBusy(false);
    setNote(result?.ok ? "Saved." : (result?.error ?? "That didn't save."));
    if (result?.ok) reloadAccount();
  }
  async function saveName(event: FormEvent) {
    event.preventDefault();
    const result = await setUsername({ data: { username } }).catch(() => null);
    if (!result?.ok) {
      setNameNote(result?.error ?? "That didn't save.");
      return;
    }
    setName(result.username);
    setNameNote(result.username ? `Saved: @${result.username}` : "Username removed.");
  }
  async function toggleHide() {
    const next = !hide;
    setHide(next);
    const result = await setHideChurch({ data: { hide: next } }).catch(() => null);
    if (!result?.ok) setHide(!next);
  }
  return (
    <div className="pb ps">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>My details</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
          Only you and your church's admins can see your nation, phone and address. They are deleted if you leave your church.
        </p>
      </div>
      {details && member ? (
        <form className="pb-card ofc-form" onSubmit={save}>
          <DetailsFields details={details} onChange={setDetails} />
          {note ? <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
          <button type="submit" className="pb-btn" disabled={busy}>{busy ? "Saving…" : "Save my details"}</button>
        </form>
      ) : details ? (
        <p className="pb-quiet">Your church keeps these details once you're a member.</p>
      ) : null}
      <section>
        <p className="ofc-sec">On the public porch</p>
        <form className="pb-card ofc-form" onSubmit={saveName}>
          <label className="ofc-lbl">
            Username (optional)
            <span className="acct-why">Shown with your reactions on the public porch. Without one, your full name is shown.</span>
            <input className="ofc-input" value={username} maxLength={20} placeholder="e.g. grace.k" autoCapitalize="none" spellCheck={false} onChange={(event) => setName(event.target.value.toLowerCase())} />
          </label>
          {nameNote ? <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>{nameNote}</p> : null}
          <button type="submit" className="pb-btn2">Save username</button>
          <label className="pb-row" style={{ cursor: "pointer", marginTop: 4 }}>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>Show my church with my reactions</span>
              <span className="pb-quiet" style={{ display: "block", fontSize: 13, marginTop: 2 }}>
                {hide ? "Your church is hidden on public reactions." : "Public reactions show the church you belong to."}
              </span>
            </span>
            <span className={`pb-switch${hide ? "" : " is-on"}`}>
              <input type="checkbox" checked={!hide} onChange={() => void toggleHide()} aria-label="Show my church with my reactions" />
            </span>
          </label>
        </form>
      </section>
    </div>
  );
}

/* ---------- Church admins: a member's details, on their profile ---------- */
export function MemberDetailsCard({ userId }: { userId: string }) {
  const [state, setState] = useState<{ details: MemberDetails; email: string } | null>(null);
  useEffect(() => {
    memberDetailsOf({ data: { userId } })
      .then((result) => {
        if (result.ok) setState({ details: result.details, email: result.email });
      })
      .catch(() => undefined);
  }, [userId]);
  if (!state) return null;
  return (
    <section className="pb pb-card" style={{ padding: 16 }}>
      <p className="ofc-sec" style={{ margin: "0 0 8px" }}>Member details · admins only</p>
      <dl className="acct-dl">
        <dt>Nation</dt>
        <dd>{state.details.nation || "Not given yet"}</dd>
        <dt>Phone</dt>
        <dd>{state.details.phone || "Not given yet"}</dd>
        <dt>Address</dt>
        <dd>{state.details.address || "Not given yet"}</dd>
        <dt>Email</dt>
        <dd>{state.email}</dd>
      </dl>
    </section>
  );
}
