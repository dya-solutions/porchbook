// Stage 4c: Chat in the new design (design-reference/Chat.dc.html). One list for the people you
// message, your groups and your office conversations (marked "Office"), with online dots.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { alertPermission, enableAlerts } from "@/lib/porch/alerts";
import { listPeople, listThreads } from "@/lib/porch/api";
import { myGroups, type PlainGroup } from "@/lib/porch/groups";
import { myOfficeChats, type OfficeChat } from "@/lib/porch/offices";
import { formatWhen, type PublicProfile, type ThreadSummary } from "@/lib/porch/model";
import { onlineState, usePorch } from "@/lib/porch/presence-store";
import { PbAvatar, initialsOf } from "@/components/porch/pb-shell";
import { StatusTag } from "@/components/porch/office-screens";
import { Fault } from "@/components/porch/trouble";

type Filter = "all" | "people" | "groups" | "offices";

type Row =
  | { kind: "person"; key: string; at: string; thread: ThreadSummary }
  | { kind: "office"; key: string; at: string; chat: OfficeChat }
  | { kind: "group"; key: string; at: string; group: PlainGroup };

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Glyph({ name, size = 20 }: { name: "search" | "pen" | "note"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </>
      ) : name === "pen" ? (
        <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
      ) : (
        <>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M14 3v5h5M9 13h7M9 17h5" />
        </>
      )}
    </svg>
  );
}

/** A face with the green "on the porch now" dot. */
function Face({ name, imageUrl, id, size = 48, online }: { name: string; imageUrl?: string | null; id?: string; size?: number; online?: boolean }) {
  return (
    <span className="pb-face">
      <PbAvatar name={name} imageUrl={imageUrl} id={id} size={size} />
      {online ? <span className="pb-face-dot" aria-label="On the porch now" /> : null}
    </span>
  );
}

function AlertsNote({ seed }: { seed: { displayName: string; email: string | null; imageUrl: string | null } }) {
  const [state, setState] = useState<"unknown" | NotificationPermission | "unsupported">("unknown");
  const [error, setError] = useState("");
  useEffect(() => {
    setState(alertPermission());
  }, []);
  if (state === "unknown" || state === "unsupported" || state === "granted") return null;
  return (
    <div className="pb-card" style={{ padding: "12px 16px" }}>
      <p style={{ margin: 0, fontSize: 14 }}>
        {state === "denied"
          ? "Alerts are blocked in this browser. Allow them in the site settings, then come back."
          : "Turn on alerts so a message can reach this phone even when Porchbook is closed. The message itself stays private."}
      </p>
      {state === "default" ? (
        <button
          type="button"
          className="pb-link"
          style={{ color: "var(--pb-main)", padding: 0 }}
          onClick={() => {
            setError("");
            void enableAlerts(seed).then((result) => {
              setState(alertPermission());
              if (!result.ok) setError(result.error);
            });
          }}
        >
          Turn on alerts
        </button>
      ) : null}
      <Fault text={error} className="mt-1" />
    </div>
  );
}

export function ChatList() {
  const user = useCurrentUser();
  const porch = usePorch();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [groups, setGroups] = useState<PlainGroup[]>([]);
  const [offices, setOffices] = useState<OfficeChat[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const search = useRef<HTMLInputElement>(null);

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    const seed = { displayName, email, imageUrl };
    listThreads({ data: seed })
      .then((result) => {
        if (cancel) return;
        setThreads(result.threads);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    listPeople({ data: seed })
      .then((result) => !cancel && setPeople(result.people))
      .catch(() => undefined);
    myGroups({ data: seed })
      .then((result) => !cancel && setGroups(result.groups))
      .catch(() => undefined);
    myOfficeChats()
      .then((result) => !cancel && setOffices(result))
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [userId, displayName, email, imageUrl]);

  const needle = query.trim().toLowerCase();
  const matches = (value: string) => !needle || value.toLowerCase().includes(needle);
  void porch; // re-draws the online dots when "on the porch now" changes

  const rows = useMemo(() => {
    const list: Row[] = [];
    if (filter === "all" || filter === "people") {
      for (const thread of threads) {
        if (thread.otherUserId === userId) continue;
        if (!matches(`${thread.otherName} ${thread.otherRole} ${thread.otherTeam} ${thread.lastBody}`)) continue;
        list.push({ kind: "person", key: `p-${thread.otherUserId}`, at: thread.lastAt, thread });
      }
    }
    if (filter === "all" || filter === "offices") {
      for (const chat of offices) {
        if (!matches(`${chat.title} ${chat.officeName} ${chat.roomName} ${chat.lastBody}`)) continue;
        list.push({ kind: "office", key: `o-${chat.officeKey}-${chat.room}-${chat.memberId}`, at: chat.lastAt, chat });
      }
    }
    if (filter === "all" || filter === "groups") {
      for (const group of groups) {
        if (!matches(`${group.name} ${group.purpose}`)) continue;
        list.push({ kind: "group", key: `g-${group.id}`, at: "", group });
      }
    }
    // Newest conversations first; groups (no messages inside yet) after them.
    return list.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, offices, groups, filter, needle, userId]);

  const chatted = new Set(threads.map((thread) => thread.otherUserId));
  const others =
    filter === "all" || filter === "people"
      ? people
          .filter((person) => person.userId !== userId && !chatted.has(person.userId))
          .filter((person) => (needle || filter === "people" ? matches(`${person.displayName} ${person.role} ${person.team}`) : false))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      : [];

  return (
    <div className="pb pb-chat">
      <div className="pb-chat-top">
        <div className="pb-row">
          <h1 className="pb-ttl" style={{ fontSize: 28, flex: 1 }}>Chat</h1>
          <button
            type="button"
            className="pb-iconbtn pb-iconbtn-main"
            aria-label="New message"
            onClick={() => {
              setFilter("people");
              search.current?.focus();
            }}
          >
            <Glyph name="pen" />
          </button>
        </div>
        <label className="pb-search">
          <span className="sr-only">Search your porch</span>
          <span className="pb-search-icon">
            <Glyph name="search" />
          </span>
          <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your porch" />
        </label>
        <div className="pb-chips" role="tablist" aria-label="Show">
          {(["all", "people", "groups", "offices"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={filter === item} className={`pb-chip${filter === item ? " is-on" : ""}`} onClick={() => setFilter(item)}>
              {item === "all" ? "All" : item === "people" ? "People" : item === "groups" ? "Groups" : "Offices"}
            </button>
          ))}
        </div>
        <AlertsNote seed={{ displayName, email, imageUrl }} />
      </div>

      {status === "error" ? <p className="text-danger" style={{ padding: "0 16px" }}>Couldn't load your messages.</p> : null}

      <div className="pb-chat-rows">
        {userId && (filter === "all" || filter === "people") && matches("My Space notes") ? (
          <Link to="/messages/$userId" params={{ userId }} className="pb-chat-row">
            <span className="pb-tile-face">
              <Glyph name="note" size={22} />
            </span>
            <span className="pb-chat-words">
              <span className="pb-chat-name">My Space</span>
              <span className="pb-chat-last">Notes only you can read</span>
            </span>
          </Link>
        ) : null}

        {rows.map((row) => {
          if (row.kind === "person") {
            const thread = row.thread;
            return (
              <Link key={row.key} to="/messages/$userId" params={{ userId: thread.otherUserId }} className="pb-chat-row">
                <Face name={thread.otherName} imageUrl={thread.otherImage} id={thread.otherUserId} online={onlineState(thread.otherUserId) !== null} />
                <span className="pb-chat-words">
                  <span className="pb-chat-name">{thread.otherName}</span>
                  <span className={`pb-chat-last${thread.unread ? " is-unread" : ""}`}>{thread.lastMine ? `You: ${thread.lastBody}` : thread.lastBody}</span>
                </span>
                <span className="pb-chat-side">
                  <time dateTime={thread.lastAt}>{formatWhen(thread.lastAt)}</time>
                  {thread.unread > 0 ? <span className="pb-count">{thread.unread > 9 ? "9+" : thread.unread}</span> : null}
                </span>
              </Link>
            );
          }
          if (row.kind === "office") {
            const chat = row.chat;
            return (
              <Link
                key={row.key}
                to="/offices/$officeKey"
                params={{ officeKey: chat.officeKey }}
                search={{ member: chat.memberId, room: chat.room }}
                className="pb-chat-row"
              >
                {chat.asHead ? (
                  <Face name={chat.title} id={chat.memberId} online={onlineState(chat.memberId) !== null} />
                ) : (
                  <span className="pb-av tone-2" style={{ width: 48, height: 48, borderRadius: 24, fontSize: 17 }}>
                    {initialsOf(chat.officeName.replace(/^(the )?office of (the )?/i, "Office "))}
                  </span>
                )}
                <span className="pb-chat-words">
                  <span className="pb-chat-name">
                    <span className="pb-chat-title">{chat.title}</span>
                    <span className="pb-tag is-green">Office</span>
                  </span>
                  <span className={`pb-chat-last${chat.waiting ? " is-unread" : ""}`}>
                    {chat.asHead ? `${chat.officeName} · ${chat.roomName}: ` : `${chat.roomName}: `}
                    {chat.lastBody}
                  </span>
                </span>
                <span className="pb-chat-side">
                  <time dateTime={chat.lastAt}>{formatWhen(chat.lastAt)}</time>
                  {chat.room !== "official" ? <StatusTag status={chat.status} /> : null}
                </span>
              </Link>
            );
          }
          const group = row.group;
          return (
            <Link key={row.key} to="/groups/$groupId" params={{ groupId: String(group.id) }} className="pb-chat-row">
              <PbAvatar name={group.name} id={`group-${group.id}`} size={48} />
              <span className="pb-chat-words">
                <span className="pb-chat-name">
                  <span className="pb-chat-title">{group.name}</span>
                  <span className="pb-tag is-quiet">Group</span>
                </span>
                <span className="pb-chat-last">{group.purpose || `${group.members} ${group.members === 1 ? "member" : "members"} · led by ${group.ownerName}`}</span>
              </span>
            </Link>
          );
        })}

        {others.length ? <p className="ofc-sec" style={{ margin: "14px 16px 4px" }}>Everyone on the porch</p> : null}
        {others.map((person) => (
          <Link key={person.userId} to="/messages/$userId" params={{ userId: person.userId }} className="pb-chat-row">
            <Face name={person.displayName} imageUrl={person.imageUrl} id={person.userId} online={onlineState(person.userId) !== null} />
            <span className="pb-chat-words">
              <span className="pb-chat-name">{person.displayName}</span>
              <span className="pb-chat-last">{[person.role, person.team].filter(Boolean).join(" · ") || "New message"}</span>
            </span>
          </Link>
        ))}

        {status === "ready" && rows.length === 0 && others.length === 0 ? (
          <p className="pb-quiet" style={{ padding: "16px" }}>
            {needle
              ? "No one matches that."
              : filter === "groups"
                ? "You're not in a group yet."
                : filter === "offices"
                  ? "No office conversations yet. Write to an office from the Offices tab."
                  : "No conversations yet. Search for someone on your porch to message them."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
