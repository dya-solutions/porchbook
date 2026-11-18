import { W, WHint, useWord } from "@/components/porch/words";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { Avatar, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { Fault } from "@/components/porch/trouble";
import { listPeople } from "@/lib/porch/api";
import { PorchLoader } from "@/components/porch/porch-loader";
import {
  addGroupAccount,
  addToGroup,
  listGroupAccounts,
  listLeaders,
  removeGroupAccount,
  type GroupAccount,
  myGroups,
  openPlainGroup,
  removeFromGroup,
  setLeader,
  startGroup,
  type PlainGroup,
  type PlainMember,
} from "@/lib/porch/groups";

/**
 * Groups, kept simple: a leader starts a group and adds the people under him;
 * a member can leave, or the leader can remove them. Nothing else happens inside for now.
 */

type Seed = { displayName: string; email: string | null; imageUrl: string | null };
function seedOf(user: { displayName: string | null; primaryEmail: string | null; profileImageUrl?: string | null } | null): Seed {
  return { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: user?.profileImageUrl ?? null };
}
type Person = { userId: string; displayName: string; imageUrl: string | null };

export function GroupsHome({ onOpen }: { onOpen?: (id: string) => void } = {}) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [groups, setGroups] = useState<PlainGroup[]>([]);
  const [canStart, setCanStart] = useState(false);
  const [founder, setFounder] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showLeaders, setShowLeaders] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    myGroups({ data: seedOf(user) })
      .then((page) => {
        if (cancel) return;
        setGroups(page.groups);
        setCanStart(page.canStart);
        setFounder(page.founder);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(id: number) {
    if (onOpen) onOpen(String(id));
    else void navigate({ to: "/groups/$groupId", params: { groupId: String(id) } });
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await startGroup({ data: { ...seedOf(user), name, purpose } }).catch(() => null);
    setPending(false);
    if (!result?.ok) {
      setError(result?.error ?? "Couldn't start the group. Try again.");
      return;
    }
    open(result.id);
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-ink"><W k="groups.title">Groups</W></h1>
      <p className="mt-1 text-sm text-muted"><W k="groups.intro">Teams growing together in the Lord. Your leader adds you to your group.</W></p>
      {canStart ? (
        <button type="button" className={`${primaryButtonClass} mt-4`} onClick={() => setMaking((value) => !value)}>
          {making ? "Close" : "Start a group"}
        </button>
      ) : null}
      {making ? (
        <form onSubmit={(event) => void start(event)} className="mt-3 grid gap-2 rounded-3xl glass-edge bg-card p-4">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Group name" className={fieldClass} />
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={280} placeholder="Its purpose, in a sentence" className={fieldClass} />
          <button type="submit" className={primaryButtonClass} disabled={pending || !name.trim() || !purpose.trim()}>
            {pending ? "Starting…" : "Start"}
          </button>
          <Fault text={error} />
        </form>
      ) : null}
      {status === "error" ? <p className="mt-4 text-sm text-muted">Couldn't load groups.</p> : null}
      {status === "ready" && groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{canStart ? <W k="groups.none-leader">You haven't started a group yet.</W> : <W k="groups.none">You're not in a group yet. Your leader adds you.</W>}</p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {groups.map((group) => (
          <li key={group.id}>
            <button type="button" onClick={() => open(group.id)} className="block w-full rounded-2xl glass-edge bg-black p-4 text-left">
              <span className="block font-semibold text-ink">{group.name}</span>
              <span className="mt-0.5 block text-sm text-muted">{group.purpose}</span>
              <span className="mt-1 block text-xs text-[#f8a018]">
                Led by {group.ownerName} · {group.members} {group.members === 1 ? "member" : "members"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {founder ? (
        <div className="mt-6">
          <button type="button" className={quietButtonClass} onClick={() => setShowLeaders((value) => !value)}>
            {showLeaders ? "Hide leaders" : "Leaders"}
          </button>
          {showLeaders ? <LeadersPanel onChanged={() => undefined} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The founder marks who the Leaders are (they can start groups). */
function LeadersPanel({ onChanged }: { onChanged: () => void }) {
  const user = useCurrentUser();
  const [people, setPeople] = useState<Person[]>([]);
  const [leaders, setLeaders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancel = false;
    Promise.all([listPeople({ data: seedOf(user) }), listLeaders()])
      .then(([list, lead]) => {
        if (cancel) return;
        setPeople(list.people.map((person) => ({ userId: person.userId, displayName: person.displayName, imageUrl: person.imageUrl ?? null })));
        setLeaders(new Set(lead.leaderIds));
      })
      .catch(() => setNote("Couldn't load people."));
    return () => {
      cancel = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const rows = people.filter((person) => !needle || person.displayName.toLowerCase().includes(needle));
    return rows.sort((a, b) => Number(leaders.has(b.userId)) - Number(leaders.has(a.userId))).slice(0, 40);
  }, [people, needle, leaders]);

  async function toggle(person: Person) {
    const on = !leaders.has(person.userId);
    const result = await setLeader({ data: { userId: person.userId, on } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't change that. Try again.");
      return;
    }
    setLeaders((current) => {
      const next = new Set(current);
      if (on) next.add(person.userId);
      else next.delete(person.userId);
      return next;
    });
    onChanged();
  }

  return (
    <div className="mt-3 rounded-2xl glass-edge bg-black p-4">
      <p className="text-sm text-muted">Leaders can start groups. Tap a name to mark or unmark them.</p>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find someone" className={`${fieldClass} mt-3`} />
      <ul className="mt-3 space-y-1">
        {shown.map((person) => (
          <li key={person.userId}>
            <button type="button" onClick={() => void toggle(person)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left">
              <Avatar name={person.displayName} imageUrl={person.imageUrl} size="sm" />
              <span className="flex-1 text-sm text-ink">{person.displayName}</span>
              <span className={`text-xs font-bold ${leaders.has(person.userId) ? "text-[#f8a018]" : "text-muted"}`}>{leaders.has(person.userId) ? "Leader" : "Mark leader"}</span>
            </button>
          </li>
        ))}
      </ul>
      <Fault text={note} />
    </div>
  );
}

export function GroupHomeView({ groupId, onBack }: { groupId: string; onBack?: () => void }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [page, setPage] = useState<{
    group: { id: number; name: string; purpose: string; ownerId: string; ownerName: string };
    members: PlainMember[];
    canManage: boolean;
    isMember: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [sureLeave, setSureLeave] = useState(false);
  const [sureRemove, setSureRemove] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    openPlainGroup({ data: { id: Number(groupId), seed: seedOf(user) } })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPage(result);
      })
      .catch(() => {
        if (!cancel) setError("Couldn't open the group.");
      });
    return () => {
      cancel = true;
    };
  }, [user?.id, groupId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adding || people.length) return;
    listPeople({ data: seedOf(user) })
      .then((list) => setPeople(list.people.map((person) => ({ userId: person.userId, displayName: person.displayName, imageUrl: person.imageUrl ?? null }))))
      .catch(() => setError("Couldn't load people."));
  }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps

  function back() {
    if (onBack) onBack();
    else void navigate({ to: "/groups" });
  }

  const inGroup = new Set(page?.members.map((member) => member.userId) ?? []);
  const needle = query.trim().toLowerCase();
  const candidates = people.filter((person) => !inGroup.has(person.userId) && needle && person.displayName.toLowerCase().includes(needle)).slice(0, 12);

  async function add(person: Person) {
    if (!page) return;
    const result = await addToGroup({ data: { groupId: page.group.id, userId: person.userId } }).catch(() => null);
    if (!result?.ok) {
      setError(result?.error ?? "Couldn't add them. Try again.");
      return;
    }
    setQuery("");
    setTick((n) => n + 1);
  }

  async function remove(userId: string) {
    if (!page) return;
    const result = await removeFromGroup({ data: { groupId: page.group.id, userId } }).catch(() => null);
    setSureRemove("");
    if (!result?.ok) {
      setError(result?.error ?? "Couldn't do that. Try again.");
      return;
    }
    if (userId === user?.id) back();
    else setTick((n) => n + 1);
  }

  const header = (
    <div className="flex items-center gap-2">
      {onBack ? (
        <button type="button" aria-label="All groups" className={`${quietButtonClass} px-2`} onClick={back}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : (
        <Link to="/groups" aria-label="All groups" className={`${quietButtonClass} px-2`}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
      )}
      <h1 className="min-w-0 truncate font-display text-2xl text-ink">{page?.group.name ?? "Group"}</h1>
    </div>
  );

  if (!page) {
    return (
      <div>
        {header}
        {error ? <p className="mt-4 text-sm text-muted">{error}</p> : <PorchLoader className="is-card" label="Opening" />}
      </div>
    );
  }

  const isLeader = page.group.ownerId === user?.id;
  return (
    <div>
      {header}
      <p className="mt-2 text-sm text-ink">{page.group.purpose}</p>
      <p className="mt-1 text-xs text-[#f8a018]">Led by {page.group.ownerName}</p>

      {page.canManage ? (
        <div className="mt-4">
          <button type="button" className={primaryButtonClass} onClick={() => setAdding((value) => !value)}>
            {adding ? "Done adding" : "Add people"}
          </button>
          {adding ? (
            <div className="mt-3">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a name" className={fieldClass} />
              <ul className="mt-2 space-y-1">
                {candidates.map((person) => (
                  <li key={person.userId}>
                    <button type="button" onClick={() => void add(person)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left">
                      <Avatar name={person.displayName} imageUrl={person.imageUrl} size="sm" />
                      <span className="flex-1 text-sm text-ink">{person.displayName}</span>
                      <span className="text-xs font-bold text-[#f8a018]">Add</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-muted">
        Members · {page.members.length}
      </h2>
      <ul className="mt-2 space-y-1">
        {page.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
            <Avatar name={member.displayName} imageUrl={member.imageUrl} size="sm" />
            <span className="flex-1 text-sm text-ink">
              {member.displayName}
              {member.leader ? <span className="text-xs font-bold text-[#f8a018]">{"  "}Leader</span> : null}
            </span>
            {page.canManage && !member.leader ? (
              sureRemove === member.userId ? (
                <span className="flex gap-2">
                  <button type="button" className="text-xs font-bold text-[#f8a018]" onClick={() => void remove(member.userId)}>
                    Remove
                  </button>
                  <button type="button" className="text-xs text-muted" onClick={() => setSureRemove("")}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="text-xs text-muted" onClick={() => setSureRemove(member.userId)}>
                  Remove
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>

      {page.canManage ? <GroupAccountability groupId={page.group.id} myId={user?.id ?? ""} /> : null}

      {page.isMember && !isLeader ? (
        <div className="mt-6">
          {sureLeave ? (
            <span className="flex items-center gap-3 text-sm text-ink">
              Leave this group?
              <button type="button" className="font-bold text-[#f8a018]" onClick={() => void remove(user?.id ?? "")}>
                Leave
              </button>
              <button type="button" className="text-muted" onClick={() => setSureLeave(false)}>
                Stay
              </button>
            </span>
          ) : (
            <button type="button" className={quietButtonClass} onClick={() => setSureLeave(true)}>
              <W k="groups.leave">Leave this group</W>
            </button>
          )}
        </div>
      ) : null}
      <Fault text={error} />
    </div>
  );
}

/** Accountability: the group's leader accounts for what happens in the group. Only the leader and the founder see it. */
function GroupAccountability({ groupId, myId }: { groupId: number; myId: string }) {
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [accounts, setAccounts] = useState<GroupAccount[] | null>(null);
  const [founder, setFounder] = useState(false);
  const [writing, setWriting] = useState(false);
  const [day, setDay] = useState(today);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sureGone, setSureGone] = useState(0);
  const [open, setOpen] = useState(0);

  async function load() {
    const result = await listGroupAccounts({ data: { groupId } }).catch(() => null);
    if (!result) return setError("Couldn't load the accountability. Try again.");
    if (!result.ok) return setError(result.error);
    setAccounts(result.accounts);
    setFounder(result.founder); // the founder can remove any account; a leader only their own
  }
  useEffect(() => {
    void load();
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return setError("Write the activity.");
    setBusy(true);
    setError("");
    const result = await addGroupAccount({ data: { groupId, happenedOn: day, attended: null, body, needs: "" } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "That didn't save. Try again.");
    setBody("");
    setDay(today());
    setWriting(false);
    void load();
  }

  async function remove(id: number) {
    const result = await removeGroupAccount({ data: { groupId, id } }).catch(() => null);
    setSureGone(0);
    if (!result?.ok) return setError(result?.error ?? "Couldn't remove it.");
    void load();
  }

  const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-muted">Accountability{accounts ? ` · ${accounts.length}` : ""}</h2>
      <p className="mt-1 text-xs text-muted">Only you and the developer see this. Account for what happens in your group.</p>
      {writing ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => void save(event)}>
          <label className="block text-xs text-muted">
            Day
            <input type="date" value={day} max={today()} onChange={(event) => setDay(event.target.value)} className={fieldClass} />
          </label>
          <label className="block text-xs text-muted">
            Activity
            <textarea
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                // Grows with what's written, so there's always room to keep typing.
                event.target.style.height = "auto";
                event.target.style.height = `${Math.max(event.target.scrollHeight, 280)}px`;
              }}
              rows={12}
              maxLength={20000}
              className={`${fieldClass} min-h-[280px]`}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {busy ? "Saving…" : "Save account"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => setWriting(true)}>
          New account
        </button>
      )}
      {accounts === null ? (
        error ? null : <PorchLoader className="is-card" label="Opening" />
      ) : accounts.length ? (
        <ul className="mt-3 space-y-2">
          {accounts.map((a) => (
            <li key={a.id} className="rounded-xl px-2 py-2">
              <button type="button" className="flex w-full items-baseline justify-between gap-3 text-left" onClick={() => setOpen((now) => (now === a.id ? 0 : a.id))}>
                <span className="text-sm font-semibold text-ink">{nice(a.happenedOn)}</span>
                <span className="text-xs text-muted">{a.attended !== null ? `${a.attended} attended` : ""}</span>
              </button>
              <p className={`mt-1 whitespace-pre-wrap text-sm text-ink ${open === a.id ? "" : "line-clamp-2"}`}>{a.body}</p>
              {open === a.id ? (
                <>
                  {a.needs ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                      <span className="text-xs font-bold text-[#f8a018]">Needs · </span>
                      {a.needs}
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-center gap-3 text-xs text-muted">
                    By {a.authorName || "the leader"}
                    {a.authorId === myId || founder ? (
                      sureGone === a.id ? (
                        <>
                          <button type="button" className="font-bold text-[#f8a018]" onClick={() => void remove(a.id)}>
                            Remove
                          </button>
                          <button type="button" onClick={() => setSureGone(0)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setSureGone(a.id)}>
                          Remove
                        </button>
                      )
                    ) : null}
                  </p>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No accounts yet.</p>
      )}
      <Fault text={error} />
    </section>
  );
}
