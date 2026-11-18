import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { alertPermission, enableAlerts } from "@/lib/porch/alerts";
import { listPeople, listThreads } from "@/lib/porch/api";
import { formatWhen, type PublicProfile, type ThreadSummary } from "@/lib/porch/model";
import { Avatar, CallLink, fieldClass } from "@/components/porch/bits";
import { Fault } from "@/components/porch/trouble";

function AlertsNote({
  seed,
}: {
  seed: { displayName: string; email: string | null; imageUrl: string | null };
}) {
  const [state, setState] = useState<"unknown" | NotificationPermission | "unsupported">("unknown");
  const [error, setError] = useState("");

  useEffect(() => {
    setState(alertPermission());
  }, []);

  if (state === "unknown" || state === "unsupported" || state === "granted") return null;

  return (
    <div className="mt-4 rounded-2xl glass-edge bg-card px-4 py-3">
      <p className="text-sm text-ink">
        {state === "denied"
          ? "Alerts are blocked in this browser. Allow them in the site settings, then come back."
          : "Turn on alerts so a message can reach this phone even when Porchbook is closed. The message itself stays private."}
      </p>
      {state === "default" ? (
        <button
          type="button"
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-pine"
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

export function MessagesRail() {
  return (
    <div className="rounded-3xl glass-edge bg-card p-5">
      <h2 className="font-display text-xl text-ink">Off the feed</h2>
      <p className="mt-2 text-sm text-muted">
        A private message never lands in a room. Only you and the other person can read it.
      </p>
    </div>
  );
}

export function MessagesView() {
  const user = useCurrentUser();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    listThreads({ data: { displayName, email, imageUrl } })
      .then(async (result) => {
        if (cancel) return;
        setThreads(result.threads);
        try {
          const directory = await listPeople({ data: { displayName, email, imageUrl } });
          if (!cancel) setPeople(directory.people);
        } catch {
          if (!cancel) setPeople([]);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [userId, displayName, email, imageUrl]);

  const needle = query.trim().toLowerCase();
  const chatted = new Set(threads.map((thread) => thread.otherUserId));
  const matches = (value: string) => !needle || value.toLowerCase().includes(needle);
  const talked = threads.filter(
    (thread) => thread.otherUserId !== userId && matches(`${thread.otherName} ${thread.otherRole} ${thread.otherTeam} ${thread.lastBody}`),
  );
  const rest = people
    .filter((person) => person.userId !== userId && !chatted.has(person.userId))
    .filter((person) => matches(`${person.displayName} ${person.role} ${person.team}`))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const hasRows = talked.length > 0 || rest.length > 0;

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Messages</h1>
      <p className="mt-1 text-muted">Private messages between you and one person.</p>
      {userId ? (
        <Link
          to="/messages/$userId"
          params={{ userId }}
          className="mt-4 flex min-h-14 items-center gap-3 rounded-2xl glass-edge bg-card px-4"
        >
          <span className="grid size-10 place-items-center rounded-full bg-pine-soft font-semibold text-pine">You</span>
          <span>
            <span className="block font-semibold text-ink">My Space</span>
            <span className="block text-sm text-muted">Notes only you can read</span>
          </span>
        </Link>
      ) : null}
      <AlertsNote
        seed={{ displayName, email, imageUrl }}
      />
      <label className="mt-4 block">
        <span className="sr-only">Search messages</span>
        <input
          className={fieldClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search anyone on the porch"
        />
      </label>
      {status === "error" ? <p className="mt-4 text-danger">Couldn't load your messages.</p> : null}
      {status === "ready" && !hasRows ? (
        <p className="mt-6 text-muted">{needle ? "No one matches that." : "No one else is on the porch yet."}</p>
      ) : null}
      {hasRows ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
          {talked.map((thread) => {
            const meta = [thread.otherRole, thread.otherTeam].filter(Boolean).join(" · ");
            const preview = thread.lastMine ? `You: ${thread.lastBody}` : thread.lastBody;
            return (
              <li key={thread.otherUserId} className="flex items-stretch">
                <Link
                  to="/messages/$userId"
                  params={{ userId: thread.otherUserId }}
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-paper"
                >
                  <Avatar name={thread.otherName} imageUrl={thread.otherImage} userId={thread.otherUserId} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold text-ink">{thread.otherName}</span>
                      <time className="shrink-0 text-xs text-faint" dateTime={thread.lastAt}>
                        {formatWhen(thread.lastAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-3">
                      <span
                        className={`truncate text-sm ${thread.unread ? "font-medium text-ink" : "text-muted"}`}
                      >
                        {preview}
                      </span>
                      {thread.unread > 0 ? (
                        <span className="grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-pine px-1.5 text-xs font-semibold text-on-pine">
                          {thread.unread > 9 ? "9+" : thread.unread}
                        </span>
                      ) : null}
                    </span>
                    {meta ? <span className="block truncate text-xs text-faint">{meta}</span> : null}
                  </span>
                </Link>
                <CallLink
                  userId={thread.otherUserId}
                  name={thread.otherName}
                  className="grid min-w-12 place-items-center text-pine hover:bg-pine-soft"
                />
              </li>
            );
          })}
          {rest.map((person) => {
            const meta = [person.role, person.team].filter(Boolean).join(" · ");
            return (
              <li key={person.userId} className="flex items-stretch">
                <Link
                  to="/messages/$userId"
                  params={{ userId: person.userId }}
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-paper"
                >
                  <Avatar name={person.displayName} imageUrl={person.imageUrl} userId={person.userId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{person.displayName}</span>
                    <span className="block truncate text-sm text-muted">{meta || "New message"}</span>
                  </span>
                </Link>
                <CallLink
                  userId={person.userId}
                  name={person.displayName}
                  className="grid min-w-12 place-items-center text-pine hover:bg-pine-soft"
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
