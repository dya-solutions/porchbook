import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { listRoll, removeMember, type RollPerson } from "@/lib/porch/roll";
import { formatWhen } from "@/lib/porch/model";
import { Avatar, quietButtonClass } from "@/components/porch/bits";

export function RollView() {
  const user = useCurrentUser();
  const [people, setPeople] = useState<RollPerson[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    listRoll({ data: { displayName, email, imageUrl } })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setStatus("denied");
          return;
        }
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

  async function remove(person: RollPerson) {
    if (!window.confirm(`Remove ${person.displayName} from the porch? Their posts and messages go with them.`)) return;
    setPendingId(person.userId);
    setError("");
    const result = await removeMember({
      data: { userId: person.userId, displayName, email, imageUrl },
    });
    setPendingId("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPeople((current) => current.filter((item) => item.userId !== person.userId));
  }

  if (status === "loading") return null;
  if (status === "error") return <p className="text-danger">Couldn't open the roll.</p>;
  if (status === "denied") return <p className="text-muted">Only an admin can see the roll.</p>;

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">The roll</h1>
      <p className="mt-1 text-muted">Only you can see who has joined, and who leads an office.</p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
        {people.map((person) => {
          const meta = [person.role, person.team].filter(Boolean).join(" · ");
          return (
            <li key={person.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={person.displayName} imageUrl={person.imageUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">
                  {person.displayName}
                  {person.founder ? " · admin" : ""}
                </span>
                {meta ? <span className="block truncate text-sm text-muted">{meta}</span> : null}
                {person.offices ? (
                  <span className="block truncate text-sm text-ink">{person.offices}</span>
                ) : null}
                <time className="block text-xs text-faint" dateTime={person.joinedAt}>
                  Joined {formatWhen(person.joinedAt)}
                </time>
              </span>
              {person.founder ? null : (
                <button
                  type="button"
                  className={`${quietButtonClass} text-danger`}
                  disabled={pendingId === person.userId}
                  onClick={() => void remove(person)}
                >
                  {pendingId === person.userId ? "Removing…" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
