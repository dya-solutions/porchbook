// Stage 6 + N5: the public porch screens (design-reference/Public.dc.html and PorchPage.dc.html),
// in the Porchbook brand look: the feed of porches you follow, Find porches, a porch's public page,
// and the posting desk an admin sees while acting as their porch.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  createPublicPost,
  findPorches,
  myPorchPublicPosts,
  porchPage,
  publicFeed,
  reactPublic,
  removePublicPost,
  saveDescription,
  setFollow,
  sharePublicPost,
  type PorchCard,
  type PublicPost,
} from "@/lib/porch/public-porch";
import { formatWhen, REACTION_META, type ReactionKind } from "@/lib/porch/model";
import { MINISTRY_TYPES } from "@/lib/porch/porch-kinds";
import { accentOf } from "@/lib/porch/brand";
import { initialsOf, PbIcon } from "@/components/porch/pb-shell";
import { CountryPicker } from "@/components/porch/country-picker";

/** From Find porches: the church someone with no church asked to join (the join form opens on the home). */
export const JOIN_PORCH_KEY = "porch-join-porch";
export function keepJoinPorch(id: number) {
  try {
    if (id) localStorage.setItem(JOIN_PORCH_KEY, String(id));
    else localStorage.removeItem(JOIN_PORCH_KEY);
  } catch {
    /* fine */
  }
}
export function keptJoinPorch(): number {
  try {
    return Number(localStorage.getItem(JOIN_PORCH_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** A porch's badge: its initials on its accent colour. */
export function PorchBadge({ name, accent, size = 42 }: { name: string; accent: string; size?: number }) {
  const colour = accentOf(accent).light;
  return (
    <span className="pp-badge" aria-hidden="true" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: colour, fontSize: Math.round(size * 0.36) }}>
      {initialsOf(name)}
    </span>
  );
}

const Verified = () => (
  <span className="pp-verified" title="Approved by Porchbook" aria-label="Approved by Porchbook">
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </span>
);

/** One public post. Only reactions: no comments on the public porch. */
export function PublicPostCard({ post, canShare, onChanged }: { post: PublicPost; canShare: boolean; onChanged?: () => void }) {
  const [reactions, setReactions] = useState(post.reactions);
  const [sharing, setSharing] = useState<"" | "ask" | "busy" | "done" | string>("");
  useEffect(() => setReactions(post.reactions), [post.reactions]);
  async function react(kind: ReactionKind) {
    // Show it at once; the server has the last word.
    setReactions((list) => list.map((r) => (r.kind === kind ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r)));
    const result = await reactPublic({ data: { postId: post.id, kind } }).catch(() => null);
    if (!result?.ok) setReactions(post.reactions);
    onChanged?.();
  }
  async function share() {
    setSharing("busy");
    const result = await sharePublicPost({ data: { postId: post.id } }).catch(() => null);
    setSharing(result?.ok ? "done" : (result?.error ?? "That didn't go through."));
  }
  const reactorLine = post.reactors.length
    ? `${post.reactors.map((r) => `@${r.name}${r.church ? ` (${r.church})` : ""}`).join(", ")}${post.reactorCount > post.reactors.length ? ` and ${post.reactorCount - post.reactors.length} more` : ""}`
    : "";
  return (
    <article className="pb-card pb-post pp-post">
      <header className="pb-post-head">
        <Link to="/porch/$porchId" params={{ porchId: String(post.porchId) }} className="pp-who">
          <PorchBadge name={post.porchName} accent={post.accent} />
          <span className="pp-who-words">
            <span className="pp-name">
              {post.porchName}
              {post.verified ? <Verified /> : null}
            </span>
            <span className="pp-meta">
              {post.porchType} · {formatWhen(post.at)}
            </span>
          </span>
        </Link>
      </header>
      <p className="pp-body">{post.body}</p>
      <div className="pb-reacts">
        {reactions.map((r, index) => (
          <button
            key={r.kind}
            type="button"
            aria-pressed={r.mine}
            aria-label={`${REACTION_META[r.kind].label}${r.count ? `, ${r.count}` : ""}`}
            className={`pb-react${r.mine ? " is-on" : ""}`}
            onClick={() => void react(r.kind)}
          >
            {index === 0 ? <PbIcon name="heart" size={16} /> : null}
            {REACTION_META[r.kind].label}
            {r.count > 0 ? <span className="tabular-nums">{r.count}</span> : null}
          </button>
        ))}
      </div>
      {reactorLine ? <p className="pp-reactors">{reactorLine}</p> : null}
      {canShare ? (
        <div className="pp-share">
          {sharing === "" ? (
            <button type="button" className="pb-link" onClick={() => setSharing("ask")}>
              Share to my church
            </button>
          ) : sharing === "ask" ? (
            <span>
              Post a link to this in your church's porch?{" "}
              <button type="button" className="welcome-link" onClick={() => void share()}>
                Yes, share
              </button>{" "}
              <button type="button" className="welcome-link" style={{ color: "var(--pb-quiet)" }} onClick={() => setSharing("")}>
                Cancel
              </button>
            </span>
          ) : sharing === "busy" ? (
            <span className="pb-quiet">Sharing…</span>
          ) : sharing === "done" ? (
            <span className="pb-quiet">Shared in your church's porch (Inform).</span>
          ) : (
            <span className="text-danger">{sharing}</span>
          )}
        </div>
      ) : null}
    </article>
  );
}

/** The public porch: posts from the porches you follow (Public.dc.html). */
export function PublicFeed({ member }: { member: boolean }) {
  const [data, setData] = useState<{ following: number; posts: PublicPost[] } | null>(null);
  const load = useCallback(() => {
    publicFeed()
      .then(setData)
      .catch(() => setData({ following: 0, posts: [] }));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <div className="pb-body pp-feed">
      <div className="pp-follow-row">
        <p>
          From the <strong>{data ? data.following : "…"} {data?.following === 1 ? "porch" : "porches"}</strong> you follow
        </p>
        <Link to="/find" className="pb-chip is-on pp-find">
          <PbIcon name="search" size={16} />
          Find porches
        </Link>
      </div>
      {data && !data.posts.length ? (
        <div className="pb-card pp-empty">
          <p style={{ margin: 0, fontWeight: 700 }}>{data.following ? "Nothing posted yet" : "You don't follow any porches yet"}</p>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.45 }}>
            {data.following ? "Posts from the porches you follow show here." : "Find churches and ministries, and follow them to see their posts here."}
          </p>
          <Link to="/find" className="pb-btn" style={{ textDecoration: "none", marginTop: 12 }}>
            Find porches
          </Link>
        </div>
      ) : null}
      {(data?.posts ?? []).map((post) => (
        <PublicPostCard key={post.id} post={post} canShare={member} />
      ))}
      <p className="pp-note">
        You only see porches you follow. Only porches post here; people react. To post, <Link to="/start">start a porch</Link>.
      </p>
    </div>
  );
}

const TYPE_CHOICES: { key: string; name: string }[] = [
  { key: "", name: "All" },
  { key: "church", name: "Churches" },
  { key: "ministry", name: "Ministries" },
  ...MINISTRY_TYPES.map((t) => ({ key: `ministry:${t.key}`, name: t.key === "other" ? "Other ministries" : t.name })),
];

/** Find porches: by name, country and type. Following is the only thing that fills your feed. */
export function FindPorches() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState("");
  const [results, setResults] = useState<PorchCard[] | null>(null);
  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      findPorches({ data: { query, country, type } })
        .then((rows) => !cancel && setResults(rows))
        .catch(() => !cancel && setResults([]));
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query, country, type]);
  return (
    <div className="pb ps pp-find-page">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>Find porches</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>Churches and ministries on Porchbook. Follow them to see their posts on your public porch.</p>
      </div>
      <label className="pb-search">
        <span className="sr-only">Search by name</span>
        <span className="pb-search-icon">
          <PbIcon name="search" size={20} />
        </span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" />
      </label>
      <div className="pp-types" role="radiogroup" aria-label="Type">
        {TYPE_CHOICES.map((choice) => (
          <button key={choice.key} type="button" role="radio" aria-checked={type === choice.key} className={`pb-chip${type === choice.key ? " is-on" : ""}`} onClick={() => setType(choice.key)}>
            {choice.name}
          </button>
        ))}
      </div>
      <div className="pp-country">
        <CountryPicker value={country} onChange={setCountry} label="Country (optional)" />
        {country ? (
          <button type="button" className="pb-link" onClick={() => setCountry("")}>
            Any country
          </button>
        ) : null}
      </div>
      {results && !results.length ? <p className="pb-quiet">No porches found. Try another name, type or country.</p> : null}
      {(results ?? []).map((porch) => (
        <PorchResult key={porch.id} porch={porch} onAsk={() => {
          keepJoinPorch(porch.id);
          void navigate({ to: "/", search: { room: "all" } as never });
        }} />
      ))}
    </div>
  );
}

function FollowButton({ porch, onChange }: { porch: PorchCard; onChange?: (following: boolean) => void }) {
  const [following, setFollowing] = useState(porch.following);
  const [busy, setBusy] = useState(false);
  useEffect(() => setFollowing(porch.following), [porch.following]);
  if (porch.ownChurch) return <span className="pb-tag is-green pp-own">Your church</span>;
  // Fix 3: anyone who runs a porch always follows it while they're its admin.
  if (porch.adminHere) return <span className="pb-tag is-green pp-own">You run it · following</span>;
  return (
    <button
      type="button"
      className={following ? "pb-btn2 pp-follow" : "pb-btn pp-follow"}
      disabled={busy}
      aria-pressed={following}
      onClick={async () => {
        setBusy(true);
        const result = await setFollow({ data: { porchId: porch.id, follow: !following } }).catch(() => null);
        setBusy(false);
        if (result?.ok) {
          setFollowing(result.following);
          onChange?.(result.following);
        }
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

function PorchResult({ porch, onAsk }: { porch: PorchCard; onAsk: () => void }) {
  return (
    <div className="pb-card pp-result">
      <Link to="/porch/$porchId" params={{ porchId: String(porch.id) }} className="pp-who">
        <PorchBadge name={porch.name} accent={porch.accent} />
        <span className="pp-who-words">
          <span className="pp-name">
            {porch.name}
            {porch.verified ? <Verified /> : null}
          </span>
          <span className="pp-meta">{[porch.typeName, porch.country].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
      {porch.description ? <p className="pp-desc">{porch.description}</p> : null}
      <div className="pp-actions">
        <FollowButton porch={porch} />
        {porch.canAskToJoin ? (
          <button type="button" className="pb-btn2 pp-follow" onClick={onAsk}>
            Ask to join
          </button>
        ) : null}
      </div>
    </div>
  );
}

type PageData = Extract<Awaited<ReturnType<typeof porchPage>>, { ok: true }>;

/** A porch's public page (PorchPage.dc.html). */
export function PorchPublicPage({ porchId, member }: { porchId: number; member: boolean }) {
  const navigate = useNavigate();
  const [page, setPage] = useState<PageData | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    porchPage({ data: { porchId } })
      .then((result) => (result.ok ? setPage(result) : setError(result.error)))
      .catch(() => setError("Couldn't open this porch."));
  }, [porchId]);
  if (error) return <p className="pb-quiet" style={{ padding: 16 }}>{error}</p>;
  if (!page) return <p className="pb-quiet" style={{ padding: 16 }}>Opening…</p>;
  const porch = page.porch;
  async function share() {
    const link = `${window.location.origin}/porch/${porch.id}`;
    try {
      if (navigator.share) await navigator.share({ title: porch.name, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setNote("Link copied.");
      }
    } catch {
      /* closed */
    }
  }
  return (
    <div className="pb ps pp-page">
      <div className="pb-card pp-hero">
        <PorchBadge name={porch.name} accent={porch.accent} size={64} />
        <h1 className="pb-ttl pp-hero-name">
          {porch.name}
          {porch.verified ? <Verified /> : null}
        </h1>
        <p className="pp-meta" style={{ textAlign: "center" }}>
          {[porch.typeName, porch.country, page.branches.length ? `${page.branches.length} ${page.branches.length === 1 ? "branch" : "branches"}` : ""].filter(Boolean).join(" · ")}
        </p>
        <p className="pp-hero-desc">{porch.description || (porch.kind === "church" ? "This church hasn't written a welcome yet." : "This ministry hasn't described itself yet.")}</p>
        {!page.porch.approved ? <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>Only you (its admins) can see this page until Porchbook approves the porch.</p> : null}
        <div className="pp-actions" style={{ justifyContent: "center" }}>
          <FollowButton porch={porch} />
          <button type="button" className="pb-btn2 pp-follow" onClick={() => void share()}>
            Share
          </button>
          {porch.canAskToJoin ? (
            <button
              type="button"
              className="pb-btn2 pp-follow"
              onClick={() => {
                keepJoinPorch(porch.id);
                void navigate({ to: "/", search: { room: "all" } as never });
              }}
            >
              Ask to join
            </button>
          ) : null}
        </div>
        {note ? <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      </div>
      {page.branches.length ? (
        <section>
          <p className="ofc-sec">Branches</p>
          <div className="pb-card ofc-list" style={{ marginTop: 0 }}>
            {page.branches.map((branch) => (
              <Link key={branch.id} to="/porch/$porchId" params={{ porchId: String(branch.id) }} className="ofc-row">
                <span className="ofc-words">
                  <span className="ofc-name" style={{ fontSize: 15 }}>{branch.name}</span>
                  <span className="ofc-hint">{branch.place}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <p className="ofc-sec">Public posts</p>
        {page.posts.length ? (
          page.posts.map((post) => <PublicPostCard key={post.id} post={post} canShare={member} />)
        ) : (
          <p className="pb-quiet" style={{ margin: 0 }}>No public posts yet.</p>
        )}
      </section>
    </div>
  );
}

/** While acting as a porch: post on the public porch for it, its posts, and its description. */
export function PorchPublicDesk({
  porchId,
  porchName,
  approved,
  description,
  country,
  onDescription,
}: {
  porchId: number;
  porchName: string;
  approved: boolean;
  description: string;
  country: string;
  onDescription: (description: string) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const load = useCallback(() => {
    myPorchPublicPosts()
      .then((result) => result.ok && setPosts(result.posts))
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => setDraft(description), [description]);
  async function post() {
    setBusy(true);
    setError("");
    const result = await createPublicPost({ data: { body } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't post. Try again.");
      return;
    }
    setBody("");
    load();
  }
  async function saveWords() {
    const result = await saveDescription({ data: { description: draft } }).catch(() => null);
    if (result?.ok) {
      onDescription(draft.trim());
      setEditing(false);
    }
  }
  return (
    <>
      <div className="pb-card welcome-card">
        <p className="ofc-lbl" style={{ margin: 0 }}>Post on the public porch for {porchName}</p>
        {approved ? (
          <>
            <textarea
              className="ofc-input"
              rows={4}
              value={body}
              maxLength={1500}
              placeholder="Share news, an invitation or a word with everyone who follows this porch"
              onChange={(event) => setBody(event.target.value)}
              style={{ resize: "vertical", minHeight: 110 }}
            />
            {error ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{error}</p> : null}
            <button type="button" className="pb-btn" disabled={busy || !body.trim()} onClick={() => void post()}>
              {busy ? "Posting…" : "Post publicly"}
            </button>
            <p className="pb-quiet" style={{ margin: 0, fontSize: 13 }}>Everyone who follows {porchName} sees it. People react; there are no comments.</p>
          </>
        ) : (
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            {porchName} can post publicly once Porchbook approves it. Until then, its public page is only visible to its admins.
          </p>
        )}
      </div>
      <div className="pb-card welcome-card">
        <p className="ofc-lbl" style={{ margin: 0 }}>About {porchName} (on its public page)</p>
        {editing ? (
          <>
            <textarea className="ofc-input" rows={4} value={draft} maxLength={400} onChange={(event) => setDraft(event.target.value)} style={{ resize: "vertical", minHeight: 110 }} />
            <div className="ofc-admin">
              <button type="button" className="pb-btn" onClick={() => void saveWords()}>
                Save
              </button>
              <button type="button" className="pb-btn2" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{description || "Nothing written yet."}</p>
            <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>{[country, approved ? "Approved" : "Waiting for approval"].filter(Boolean).join(" · ")}</p>
            <div className="ofc-admin">
              <button type="button" className="pb-btn2" onClick={() => setEditing(true)}>
                Edit
              </button>
              <Link to="/porch/$porchId" params={{ porchId: String(porchId) }} className="pb-btn2" style={{ textDecoration: "none" }}>
                Public page
              </Link>
            </div>
          </>
        )}
      </div>
      {posts.length ? (
        <div className="pb-card welcome-card">
          <p className="ofc-lbl" style={{ margin: 0 }}>Its public posts</p>
          {posts.map((item) => (
            <div key={item.id} className="pp-mine">
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{item.body}</p>
              <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {formatWhen(item.at)} · {item.reactions.reduce((n, r) => n + r.count, 0)} reactions ·{" "}
                <button
                  type="button"
                  className="welcome-link"
                  style={{ fontSize: 13, minHeight: 0 }}
                  onClick={() => void removePublicPost({ data: { postId: item.id } }).then(load)}
                >
                  Take down
                </button>
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
