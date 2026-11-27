// Stage 5d: Porch settings → Admins. Every admin and their level; a Lead admin can Add, Change
// level and Remove, and hand over Lead by making someone else Lead admin. A porch always keeps at
// least one Lead admin. For a ministry this shows on its own screen (Lead admins and Public page
// editors only).
import { useCallback, useEffect, useState } from "react";
import { addAdmin, adminCandidates, listAdmins, removeAdmin, setAdminLevel, type AdminRow, type Level } from "@/lib/porch/admin-levels";

type Data = Extract<Awaited<ReturnType<typeof listAdmins>>, { ok: true }>;

export function AdminsPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    listAdmins()
      .then((result) => (result.ok ? setData(result) : setError(result.error)))
      .catch(() => setError("Couldn't open the admins."));
  }, []);
  useEffect(() => load(), [load]);

  if (error) return <p className="pb-quiet" style={{ padding: compact ? 0 : 16 }}>{error}</p>;
  if (!data) return null;
  const levelName = (key: string) => data.levels.find((l) => l.key === key)?.name ?? key;

  async function change(person: AdminRow, level: Level) {
    setNote("");
    const result = await setAdminLevel({ data: { userId: person.userId, level } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setEditing("");
    setNote(`${person.name} is now ${levelName(level)}.`);
    load();
  }
  async function remove(person: AdminRow) {
    setNote("");
    const result = await removeAdmin({ data: { userId: person.userId } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setEditing("");
    setNote(`${person.name} is no longer an admin.`);
    load();
  }

  return (
    <div className={compact ? "pb-card welcome-card" : "pb ps"}>
      {compact ? (
        <p className="ofc-lbl" style={{ margin: 0 }}>Admins</p>
      ) : (
        <div>
          <h1 className="pb-ttl" style={{ fontSize: 28 }}>Admins</h1>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
            {data.porch.name}'s admins and what each can do.
            {data.canManage ? " As a Lead admin you can add, change and remove them." : " Only a Lead admin can change them."}
          </p>
        </div>
      )}
      <div className={compact ? "adm-list" : "pb-card ofc-list adm-list"} style={{ marginTop: 0 }}>
        {data.admins.map((person) => (
          <div key={person.userId} className="adm-row">
            <div className="adm-main">
              <span className="ofc-words">
                <span className="ofc-name" style={{ fontSize: 15 }}>
                  {person.name}
                  {person.you ? <span className="pb-quiet"> (you)</span> : null}
                </span>
                <span className="ofc-hint">
                  {levelName(person.level)}
                  {person.startedIt ? " · started the porch" : ""}
                </span>
              </span>
              {data.canManage ? (
                <button type="button" className="pb-link" onClick={() => setEditing(editing === person.userId ? "" : person.userId)}>
                  {editing === person.userId ? "Close" : "Change"}
                </button>
              ) : null}
            </div>
            {editing === person.userId ? (
              <div className="adm-edit">
                <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>Level</p>
                <div className="adm-levels" role="radiogroup" aria-label={`${person.name}'s level`}>
                  {data.levels.map((level) => (
                    <button
                      key={level.key}
                      type="button"
                      role="radio"
                      aria-checked={person.level === level.key}
                      className={`adm-level${person.level === level.key ? " is-on" : ""}`}
                      onClick={() => person.level !== level.key && void change(person, level.key)}
                    >
                      <strong>{level.name}</strong>
                      <small>{level.does}</small>
                    </button>
                  ))}
                </div>
                <button type="button" className="pb-btn2" onClick={() => void remove(person)}>
                  {person.you ? "Stop being an admin" : "Remove as admin"}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {note ? <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      {data.canManage ? (
        adding ? (
          <AddAdmin
            church={data.porch.kind === "church"}
            levels={data.levels}
            onDone={(message) => {
              setAdding(false);
              if (message) setNote(message);
              load();
            }}
          />
        ) : (
          <button type="button" className="pb-btn" onClick={() => setAdding(true)}>
            Add an admin
          </button>
        )
      ) : null}
      <div className={compact ? "" : "pb-card"} style={compact ? undefined : { padding: 16 }}>
        <p className="ofc-lbl" style={{ margin: "0 0 6px" }}>The levels</p>
        {data.levels.map((level) => (
          <p key={level.key} style={{ margin: "0 0 4px", fontSize: 14, lineHeight: 1.45 }}>
            <strong>{level.name}:</strong> <span className="pb-quiet">{level.does}</span>
          </p>
        ))}
        {data.porch.kind === "church" ? (
          <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.45 }}>
            <strong>Office head:</strong> <span className="pb-quiet">set on each office; sees only their own office, and the details of people who contacted it.</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AddAdmin({ church, levels, onDone }: { church: boolean; levels: Data["levels"]; onDone: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ userId: string; name: string; username: string }[]>([]);
  const [chosen, setChosen] = useState<{ userId: string; name: string } | null>(null);
  const [level, setLevel] = useState<Level>(church ? "moderator" : "public_editor");
  const [error, setError] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      adminCandidates({ data: { query } })
        .then((rows) => !cancel && setFound(rows))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query]);
  async function save() {
    if (!chosen) return;
    setError("");
    const result = await addAdmin({ data: { userId: chosen.userId, level } }).catch(() => null);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through.");
      return;
    }
    onDone(`${chosen.name} is now ${levels.find((l) => l.key === level)?.name ?? "an admin"}.`);
  }
  return (
    <div className="pb-card ofc-form">
      <p className="ofc-lbl" style={{ margin: 0 }}>Add an admin</p>
      {chosen ? (
        <p style={{ margin: 0, fontSize: 15 }}>
          <strong>{chosen.name}</strong>{" "}
          <button type="button" className="welcome-link" onClick={() => setChosen(null)}>
            Change
          </button>
        </p>
      ) : (
        <>
          <input
            className="ofc-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={church ? "Find a member by name" : "Find someone by username"}
            autoCapitalize="none"
          />
          {found.map((person) => (
            <button key={person.userId} type="button" className="ofc-row pb-card" style={{ textAlign: "left", font: "inherit", padding: "10px 14px" }} onClick={() => setChosen(person)}>
              <span className="ofc-words">
                <span className="ofc-name" style={{ fontSize: 15 }}>{person.name}</span>
                {person.username && church ? <span className="ofc-hint">@{person.username}</span> : null}
              </span>
            </button>
          ))}
          {query.trim().length >= 2 && !found.length ? (
            <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>{church ? "No member by that name (only members can be admins)." : "No account with that username."}</p>
          ) : null}
        </>
      )}
      <div className="adm-levels" role="radiogroup" aria-label="Level">
        {levels.map((item) => (
          <button key={item.key} type="button" role="radio" aria-checked={level === item.key} className={`adm-level${level === item.key ? " is-on" : ""}`} onClick={() => setLevel(item.key)}>
            <strong>{item.name}</strong>
            <small>{item.does}</small>
          </button>
        ))}
      </div>
      {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
      <div className="ofc-admin">
        <button type="button" className="pb-btn" disabled={!chosen} onClick={() => void save()}>
          Add
        </button>
        <button type="button" className="pb-btn2" onClick={() => onDone("")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
