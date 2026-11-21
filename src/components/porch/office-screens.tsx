// Stage 4b: the Offices tab in the new design (design-reference/Offices.dc.html and Office.dc.html).
// Each church makes its own offices: its admins create, rename and remove them, choose each
// office's head and choose what each office offers. Phaneroo starts with its 8 offices.
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  actionName,
  createOffice,
  listAnnouncements,
  removeAnnouncement,
  type OfficeAnnouncement,
  listOffices,
  OFFICE_ACTIONS,
  removeOffice,
  setOfficeHead,
  statusName,
  updateOffice,
  type OfficeAction,
  type OfficeCard,
  type PrayerStatus,
} from "@/lib/porch/offices";
import { playOfficeBell } from "@/lib/porch/button-sound-play";
import { PbIcon } from "@/components/porch/pb-shell";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The icons from design-reference/Office.dc.html, one per action. */
export function ActionIcon({ action, size = 22 }: { action: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    office: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1.5" />
        <path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" />
      </>
    ),
    thanks: (
      <>
        <path d="M12 3c2 2 2 4 0 5-2-1-2-3 0-5z" />
        <path d="M9 10h6v11H9z" />
      </>
    ),
    chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />,
    appoint: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    calendar: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
    account: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12l3 3 5-6" />
      </>
    ),
    official: (
      <>
        <path d="M4 10v4h3l6 4V6L7 10z" />
        <path d="M17 9a4 4 0 0 1 0 6" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      {paths[action] ?? paths.office}
    </svg>
  );
}

/** Each action's colour, as in the design. */
/** Office icons wear the church's accent colour (Stage 4e, brand/BRAND.md). */
export function actionTone(_action: string): string {
  return "var(--pb-accent)";
}

export function ActionTile({ action, size = 42 }: { action: string; size?: number }) {
  const tone = actionTone(action);
  return (
    <span
      className="ofc-tile"
      style={{ width: size, height: size, color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}
    >
      <ActionIcon action={action} size={Math.round(size / 2)} />
    </span>
  );
}

/** Sent, Confirmed or Answered. */
export function StatusTag({ status }: { status: PrayerStatus }) {
  return <span className={`pb-tag ${status === "open" ? "is-quiet" : "is-green"}`}>{statusName(status)}</span>;
}

let homeMemory: { offices: OfficeCard[]; isFounder: boolean } | null = null;

type Person = { userId: string; displayName: string };

export function OfficesList() {
  const user = useCurrentUser();
  const [offices, setOffices] = useState<OfficeCard[]>(homeMemory?.offices ?? []);
  const [isAdmin, setIsAdmin] = useState(homeMemory?.isFounder ?? false);
  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(homeMemory ? "ready" : "loading");
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<string>("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    listOffices({ data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null } })
      .then((result) => {
        if (cancel) return;
        homeMemory = { offices: result.offices, isFounder: result.isFounder };
        setOffices(result.offices);
        setIsAdmin(result.isFounder);
        setPeople(result.people);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl, tick]);

  if (status === "error") return <p className="text-danger">Couldn't open the offices.</p>;
  const reload = () => setTick((value) => value + 1);

  return (
    <div className="pb ofc">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>Offices</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
          Reach the right people in your church.
        </p>
      </div>

      {offices.map((office) =>
        managing && editing === office.key ? (
          <OfficeForm
            key={office.key}
            office={office}
            people={people}
            onDone={() => {
              setEditing("");
              reload();
            }}
          />
        ) : (
          <div key={office.key} className="ofc-line">
            <Link
              to="/offices/$officeKey"
              params={{ officeKey: office.key }}
              search={{ member: "", room: "" }}
              onClick={() => playOfficeBell()}
              className="pb-card ofc-row"
            >
              <ActionTile action="office" size={46} />
              <span className="ofc-words">
                <span className="ofc-name">{office.name}</span>
                <span className="ofc-hint">
                  {office.description || (office.headName ? office.headName : "No head yet")}
                </span>
              </span>
              <span className="pb-quiet">
                <ActionIcon action="arrow" size={18} />
              </span>
            </Link>
            {managing ? (
              <button type="button" className="pb-link ofc-edit" onClick={() => setEditing(office.key)}>
                Edit
              </button>
            ) : null}
          </div>
        ),
      )}

      {status === "ready" && offices.length === 0 ? (
        <div className="pb-card" style={{ padding: 16 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>No offices yet</p>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 14 }}>
            {isAdmin ? "Create your church's first office below." : "Your church hasn't set up its offices yet."}
          </p>
        </div>
      ) : null}

      {managing && editing === "new" ? (
        <OfficeForm
          office={null}
          people={people}
          onDone={() => {
            setEditing("");
            reload();
          }}
        />
      ) : null}

      <p className="pb-quiet" style={{ margin: "2px 4px 0", fontSize: 13 }}>
        Each church sets up its own offices.
      </p>

      {isAdmin ? (
        <div className="ofc-admin">
          {managing ? (
            <>
              {editing !== "new" ? (
                <button type="button" className="pb-btn" onClick={() => setEditing("new")}>
                  New office
                </button>
              ) : null}
              <button
                type="button"
                className="pb-btn2"
                onClick={() => {
                  setManaging(false);
                  setEditing("");
                }}
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pb-btn2"
              onClick={() => {
                setManaging(true);
                if (offices.length === 0) setEditing("new");
              }}
            >
              Manage offices
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Create or change one office: name, short description, head, and what it offers. */
function OfficeForm({ office, people, onDone }: { office: OfficeCard | null; people: Person[]; onDone: () => void }) {
  const [name, setName] = useState(office?.name ?? "");
  const [description, setDescription] = useState(office?.description ?? "");
  const [actions, setActions] = useState<OfficeAction[]>(office?.actions ?? ["chat"]);
  const [head, setHead] = useState(office?.headUserId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function toggle(action: OfficeAction) {
    setActions((current) => (current.includes(action) ? current.filter((item) => item !== action) : [...current, action]));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const ordered = OFFICE_ACTIONS.map((item) => item.key).filter((key) => actions.includes(key));
      const result = office
        ? await updateOffice({ data: { key: office.key, name, description, actions: ordered } })
        : await createOffice({ data: { name, description, actions: ordered } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const key = office ? office.key : "key" in result ? result.key : "";
      if (key && head && head !== (office?.headUserId ?? "")) {
        const chosen = await setOfficeHead({ data: { key, userId: head } });
        if (!chosen.ok) {
          setError(chosen.error);
          return;
        }
      }
      onDone();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!office) return;
    setBusy(true);
    const result = await removeOffice({ data: { key: office.key } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through.");
      return;
    }
    onDone();
  }

  return (
    <form className="pb-card ofc-form" onSubmit={save}>
      <p className="ofc-name">{office ? "Change this office" : "New office"}</p>
      <label className="ofc-lbl">
        Name
        <input className="ofc-input" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Office of the Pastor" />
      </label>
      <label className="ofc-lbl">
        Short description
        <input
          className="ofc-input"
          value={description}
          maxLength={120}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Prayer, appointments, contact the pastor"
        />
      </label>
      <label className="ofc-lbl">
        Head
        <select className="ofc-input" value={head} onChange={(event) => setHead(event.target.value)}>
          <option value="">{office?.headUserId ? "Keep the current head" : "Choose later"}</option>
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.displayName}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="ofc-actions">
        <legend className="ofc-lbl">What this office offers</legend>
        {OFFICE_ACTIONS.map((item) => (
          <label key={item.key} className="ofc-check">
            <input type="checkbox" checked={actions.includes(item.key)} onChange={() => toggle(item.key)} />
            <ActionTile action={item.key} size={34} />
            <span className="ofc-words">
              <span className="ofc-name" style={{ fontSize: 15 }}>{actionName(item.key, office?.key ?? "", name)}</span>
              <span className="ofc-hint">{item.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? <p className="text-danger" style={{ margin: 0 }}>{error}</p> : null}
      <div className="ofc-admin">
        <button type="submit" className="pb-btn" disabled={busy || !name.trim() || actions.length === 0}>
          {busy ? "Saving…" : office ? "Save" : "Create office"}
        </button>
        <button type="button" className="pb-btn2" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
      {office ? (
        confirmRemove ? (
          <div className="ofc-admin">
            <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>
              Remove {office.name}? Members won't see it any more. Its old messages are kept.
            </p>
            <button type="button" className="pb-btn2 text-danger" onClick={() => void remove()} disabled={busy}>
              Yes, remove it
            </button>
          </div>
        ) : (
          <button type="button" className="pb-link text-danger" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmRemove(true)}>
            Remove this office
          </button>
        )
      ) : null}
    </form>
  );
}

/** "Your requests" on an office page: what you've sent this office and where each one stands. */
export function YourRequests({ officeKey }: { officeKey: string }) {
  const user = useCurrentUser();
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof listOffices>>["requests"]>([]);
  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    listOffices({ data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null } })
      .then((result) => {
        if (!cancel) setRequests(result.requests.filter((item) => item.officeKey === officeKey));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl, officeKey]);
  if (!requests.length) return null;
  return (
    <>
      <p className="ofc-sec">Your requests</p>
      {requests.map((item) => (
        <Link
          key={`${item.officeKey}-${item.room}`}
          to="/offices/$officeKey"
          params={{ officeKey: item.officeKey }}
          search={{ member: user?.id ?? "", room: item.room }}
          className="pb-card ofc-row"
        >
          <span className="ofc-words">
            <span className="ofc-name" style={{ fontSize: 15 }}>{item.roomName}</span>
            <span className="ofc-hint">{item.updatedAt ? `Last message ${sentDay(item.updatedAt)}` : item.lastBody}</span>
          </span>
          <StatusTag status={item.status} />
        </Link>
      ))}
    </>
  );
}

function sentDay(iso: string) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const today = new Date();
  const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(when.toDateString()).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return when.toLocaleDateString(undefined, { weekday: "long" });
  return when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export { PbIcon };

/** Office announcements, pinned at the top of My porch: "From the Office of the Pastor · Pinned". */
export function OfficeAnnouncements() {
  const user = useCurrentUser();
  const [items, setItems] = useState<OfficeAnnouncement[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    listAnnouncements()
      .then((rows) => {
        if (!cancel) setItems(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id, tick]);
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        <article key={item.id} className="pb-card pb-announce" aria-label={`Announcement from the ${item.officeName}`}>
          <p className="pb-announce-from">
            <ActionIcon action="official" size={16} />
            <span style={{ flex: 1 }}>From the {item.officeName.replace(/^the /i, "")} · Pinned</span>
            {item.canRemove ? (
              <button
                type="button"
                className="pb-link"
                style={{ minHeight: 32, padding: 0 }}
                onClick={() => void removeAnnouncement({ data: { id: item.id } }).then(() => setTick((value) => value + 1))}
              >
                Remove
              </button>
            ) : null}
          </p>
          <p className="pb-announce-text">{item.body}</p>
        </article>
      ))}
    </>
  );
}
