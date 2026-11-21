import { Link } from "@tanstack/react-router";
import { MemberDetailsCard } from "@/components/porch/member-pages";
import { YourPorches } from "@/components/porch/porch-approvals";
import { onlineState, usePorch } from "@/lib/porch/presence-store";
import { useEffect, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getPerson, updateMe } from "@/lib/porch/api";
import { amIFounder, founderResetPassword } from "@/lib/porch/password-reset";
import { ROOM_META, clipWords, formatWhen, wordCount, type PersonPage, type Profile } from "@/lib/porch/model";
import { FacePicker, FounderRemoveFace } from "@/components/porch/face-picker";
import { PhotoViewer } from "@/components/porch/photo-viewer";
import { AccountCard } from "@/components/porch/frame";
import { Avatar, CallLink, LinkText, PostWindow, KeptPhoto, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";

export function ProfileView({ userId }: { userId: string }) {
  const user = useCurrentUser();
  usePorch(); // re-draws "On the porch now"
  const [page, setPage] = useState<PersonPage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);

  const viewerId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!viewerId) return;
    let cancel = false;
    setStatus("loading");
    getPerson({ data: { userId, displayName, email, imageUrl } })
      .then((result) => {
        if (cancel) return;
        setPage(result);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [viewerId, displayName, email, imageUrl, userId, tick]);

  if (status === "loading" && !page) return null;
  if (status === "error") {
    return <p className="text-danger">Couldn't open that profile.</p>;
  }
  if (!page?.profile) {
    return (
      <div className="rounded-3xl glass-edge bg-card px-5 py-10 text-center">
        <h1 className="font-display text-2xl">Nobody here yet</h1>
        <p className="mt-2 text-muted">That person hasn't joined Porchbook.</p>
        <Link to="/people" className={`${quietButtonClass} mt-3`}>
          Back to people
        </Link>
      </div>
    );
  }

  const profile = page.profile;

  return (
    <div className="pb pb-profile space-y-4">
      <section className="pb-card" style={{ padding: 20 }}>
        <div className="flex items-start gap-4">
          {page.isSelf ? (
            <FacePicker name={profile.displayName} imageUrl={profile.imageUrl} onChanged={() => setTick((value) => value + 1)} />
          ) : (
            <ProfileFace name={profile.displayName} imageUrl={profile.imageUrl} userId={profile.userId} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1 className="pb-ttl min-w-0 flex-1" style={{ fontSize: 26, lineHeight: 1.15 }}>{profile.displayName}</h1>
              {page.isSelf ? null : (
                <span className="flex shrink-0" style={{ gap: 8 }}>
                  <CallLink userId={profile.userId} name={profile.displayName} className="pb-iconbtn is-green" />
                  <CallLink video userId={profile.userId} name={profile.displayName} className="pb-iconbtn is-green" />
                </span>
              )}
            </div>
            <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
              {[profile.role, profile.team].filter(Boolean).join(" · ") || "No role yet"}
            </p>
            {!page.isSelf && onlineState(profile.userId) ? (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--pb-second)" }}>
                <span className="pb-dot" />
                On the porch now
              </p>
            ) : null}
          </div>
        </div>
        <Detail label="Spiritual identity" text={profile.spiritualIdentity} />
        <Detail label="Spiritual responsibility" text={profile.spiritualResponsibility} />
        {page.isSelf ? (
          <button type="button" className="pb-btn2" style={{ marginTop: 16, minHeight: 44, fontSize: 15 }} onClick={() => setEditing((open) => !open)}>
            {editing ? "Close" : "Edit profile"}
          </button>
        ) : (
          <Link
            to="/messages/$userId"
            params={{ userId: profile.userId }}
            className="pb-btn"
            style={{ marginTop: 16, width: "100%" }}
          >
            <Mail className="size-4" aria-hidden="true" />
            Message
          </Link>
        )}
        {!page.isSelf ? <FounderReset userId={profile.userId} name={profile.displayName} /> : null}
        {!page.isSelf && profile.imageUrl ? <FounderRemoveFace userId={profile.userId} onRemoved={() => setTick((value) => value + 1)} /> : null}
        {page.isSelf && editing ? (
          <EditForm
            profile={profile}
            onSaved={() => {
              setEditing(false);
              setTick((value) => value + 1);
            }}
          />
        ) : null}
      </section>
      {page.isSelf && user ? <AccountCard user={user} /> : null}
      {page.isSelf ? <YourPorches /> : <MemberDetailsCard userId={profile.userId} />}
      <section>
        <h2 className="pb-ttl" style={{ fontSize: 20, margin: "8px 4px 0" }}>Recent posts</h2>
        {page.posts.length === 0 ? <p className="mt-2 text-muted">Nothing posted yet.</p> : null}
        <ul className="mt-3 space-y-3">
          {page.posts.map((post) => (
            <li key={post.id}>
              <PostWindow className="pb-card p-4">
              <p className="text-sm text-muted">
                <span className={`font-semibold ${ROOM_META[post.room].mark}`}>{ROOM_META[post.room].label}</span>
                {" · "}
                <time dateTime={post.createdAt}>{formatWhen(post.createdAt)}</time>
                {post.reactionCount ? ` · ${post.reactionCount} reactions` : ""}
                {post.commentCount ? ` · ${post.commentCount} replies` : ""}
              </p>
              <LinkText text={post.body.trim()} className="mt-2 text-post" />
              {post.photo ? <KeptPhoto src={post.photo} title={profile.displayName} /> : null}
              </PostWindow>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function EditForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [role, setRole] = useState(profile.role);
  const [team, setTeam] = useState(profile.team);
  const [identity, setIdentity] = useState(profile.spiritualIdentity);
  const [responsibility, setResponsibility] = useState(profile.spiritualResponsibility);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateMe({
      data: { displayName, role, team, spiritualIdentity: identity, spiritualResponsibility: responsibility },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 border-t border-line pt-4">
      <Field label="Name" value={displayName} onChange={setDisplayName} maxLength={60} />
      <Field label="Role" value={role} onChange={setRole} maxLength={60} />
      <Field label="Team" value={team} onChange={setTeam} maxLength={60} />
      <WordField label="Spiritual identity" value={identity} onChange={setIdentity} />
      <WordField label="Spiritual responsibility" value={responsibility} onChange={setResponsibility} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" className="pb-btn" disabled={pending || !displayName.trim()}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <p className="mt-4">
      <span className="block text-sm font-medium text-muted">{label}</span>
      <span className="mt-1 block text-pretty text-post">{text}</span>
    </p>
  );
}

function WordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const count = wordCount(value);
  return (
    <label className="grid gap-1 text-sm font-medium text-ink">
      {label}
      <textarea
        className={`${fieldClass} min-h-20 !text-post`}
        value={value}
        onChange={(event) => onChange(clipWords(event.target.value))}
      />
      <span className="text-xs font-normal text-muted">{count} of 50 words</span>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-ink">
      {label}
      <input className={fieldClass} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function suggestPassword(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

/** Founder-only: set a temporary password for a member who forgot theirs. */
function FounderReset({ userId, name }: { userId: string; name: string }) {
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let cancel = false;
    amIFounder()
      .then((result) => {
        if (!cancel) setFounder(result.founder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  if (!founder) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setDone("");
    try {
      const result = await founderResetPassword({ data: { userId, password } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(password);
      setPassword("");
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`${quietButtonClass} mt-3 block px-0`}
        onClick={() => {
          setOpen(true);
          setPassword(suggestPassword());
          setError("");
          setDone("");
        }}
      >
        Reset password
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-2 rounded-2xl glass-edge bg-paper p-4">
      <p className="text-sm font-semibold text-ink">Reset {name}'s password</p>
      {done ? (
        <>
          <p className="text-sm text-muted">
            Done. Tell {name} to sign in with this password. Any old sign-ins on their phones end within 5 minutes.
          </p>
          <p className="select-all rounded-lg bg-card px-3 py-2 font-mono text-lg text-ink">{done}</p>
          <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setOpen(false)}>
            Close
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Give them a temporary password in person or on WhatsApp. At least 8 characters.
          </p>
          <label className="text-sm text-muted" htmlFor={`reset-${userId}`}>
            New password
          </label>
          <input
            id={`reset-${userId}`}
            className={`${fieldClass} font-mono`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            minLength={8}
            maxLength={128}
            required
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <button type="submit" className={primaryButtonClass} disabled={pending}>
              {pending ? "Saving…" : "Set password"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** Someone's profile photo: a tap opens it big, in a Porchbook window. */
function ProfileFace({ name, imageUrl, userId }: { name: string; imageUrl: string | null; userId: string }) {
  const [open, setOpen] = useState(false);
  if (!imageUrl) return <Avatar name={name} imageUrl={null} size="lg" userId={userId} />;
  return (
    <>
      <button type="button" className="shrink-0 rounded-full" aria-label={`See ${name}'s photo`} onClick={() => setOpen(true)}>
        <Avatar name={name} imageUrl={imageUrl} size="lg" userId={userId} />
      </button>
      {open ? <PhotoViewer src={imageUrl} title={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
