import { useEffect, useState } from "react";
import { PbAvatar } from "@/components/porch/pb-shell";
import { Link } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { listPorch } from "@/lib/porch/roll";
import { Avatar, CallLink, fieldClass } from "@/components/porch/bits";

type Person = {
  userId: string;
  displayName: string;
  imageUrl: string | null;
  offices: string;
};

export function PeopleView() {
  const user = useCurrentUser();
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    listPorch({ data: { displayName, email, imageUrl } })
      .then((result) => {
        if (cancel) return;
        setPeople(result.people);
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
  const shown = needle
    ? people.filter((person) => `${person.displayName} ${person.offices}`.toLowerCase().includes(needle))
    : people;

  return (
    <div className="pb">
      <h1 className="pb-ttl" style={{ fontSize: 28 }}>People</h1>
      <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>Everyone on the porch. A name opens their page.</p>
      <label className="pb-search" style={{ marginTop: 14 }}>
        <span className="sr-only">Search people</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" style={{ paddingLeft: 16 }} />
      </label>
      {status === "error" ? <p className="mt-4 text-danger">Couldn't load the people.</p> : null}
      {status === "ready" && shown.length === 0 ? <p className="mt-6 text-muted">No one matches that.</p> : null}
      <ul className="pb-card mt-4 divide-y divide-line overflow-hidden">
        {shown.map((person) => (
          <li key={person.userId} className="flex items-stretch">
            <Link
              to="/people/$userId"
              params={{ userId: person.userId }}
              className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-paper"
            >
              <PbAvatar name={person.displayName} imageUrl={person.imageUrl} id={person.userId} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">
                  {person.displayName}
                  {person.userId === userId ? " · you" : ""}
                </span>
                {person.offices ? <span className="block truncate text-sm text-muted">{person.offices}</span> : null}
              </span>
            </Link>
            {person.userId === userId ? null : (
              <span className="flex shrink-0">
                <CallLink userId={person.userId} name={person.displayName} className="grid min-h-11 min-w-11 place-items-center" />
                <CallLink video userId={person.userId} name={person.displayName} className="grid min-h-11 min-w-11 place-items-center" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
