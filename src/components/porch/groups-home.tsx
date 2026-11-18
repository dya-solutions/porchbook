import { Link, useNavigate } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { Avatar, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { BibleReader, passageOf } from "@/components/porch/bible-reader";
import { Fault } from "@/components/porch/trouble";
import { listPeople } from "@/lib/porch/api";
import { verseLine } from "@/lib/porch/bible-engine";
import { addMember } from "@/lib/porch/groups";
import {
  GROUP_CATEGORIES,
  browseGroups,
  followGroup,
  guideGroup,
  joinGroup,
  markGroupPost,
  markStudyDay,
  openGroup,
  postInGroup,
  saveGroupStudy,
  type GroupCard,
  type GroupHome,
  type GroupPost,
} from "@/lib/porch/groups";
import { formatWhen } from "@/lib/porch/model";

const BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

const KINDS = [
  ["discussion", "Discussion"],
  ["scripture", "Scripture"],
  ["question", "Question"],
  ["prayer", "Prayer"],
  ["study", "Bible study"],
  ["resource", "Resource"],
  ["event", "Event"],
  ["video", "Video"],
] as const;

function seedOf(user: { displayName: string | null; primaryEmail: string | null } | null) {
  return { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: null };
}

function matches(group: GroupCard, query: string) {
  if (!query) return true;
  const hay = `${group.name} ${group.purpose} ${group.category} ${group.whereAt}`.toLowerCase();
  return hay.includes(query);
}

export function GroupsHome({ onOpen }: { onOpen?: (id: string) => void } = {}) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [groups, setGroups] = useState<GroupCard[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"mine" | "discover" | "following" | "made">("mine");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState<string>(GROUP_CATEGORIES[0]);
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [joinMode, setJoinMode] = useState<"open" | "approval">("open");
  const [postMode, setPostMode] = useState<"members" | "admin">("members");
  const [whereAt, setWhereAt] = useState("");
  const [rules, setRules] = useState("Keep discussions respectful.\nKeep discussions relevant to Scripture.\nNo spam.\nNo harassment.\nNo inappropriate content.");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    browseGroups({ data: seedOf(user) })
      .then((page) => {
        if (!cancel) {
          setGroups(page.groups);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [user?.id, user?.displayName, user?.primaryEmail]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const rows = groups.filter((group) => matches(group, needle));
    if (tab === "mine") return rows.filter((group) => group.joined);
    if (tab === "following") return rows.filter((group) => group.followed && !group.joined);
    if (tab === "made") return rows.filter((group) => group.ownerId === user?.id);
    const liked = new Set(groups.filter((group) => group.joined).map((group) => group.category));
    return rows
      .filter((group) => !group.joined)
      .sort((a, b) => Number(liked.has(b.category)) - Number(liked.has(a.category)) || b.members - a.members);
  }, [groups, needle, tab, user?.id]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { createGroup } = await import("@/lib/porch/groups");
    const result = await createGroup({
      data: { ...seedOf(user), name, purpose, category, privacy, joinMode, postMode, rules, whereAt, cover: "" },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (onOpen) onOpen(String(result.id));
    else void navigate({ to: "/groups/$groupId", params: { groupId: String(result.id) } });
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Groups</h1>
      <p className="mt-1 text-sm text-muted">Study, pray, and stay with the people around Scripture.</p>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a group, a Scripture, or a place" className={`${fieldClass} mt-4`} />
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {(
          [
            ["mine", "My Groups"],
            ["discover", "Discover"],
            ["following", "Following"],
            ["made", "Created by Me"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={`${quietButtonClass} shrink-0 px-3 ${tab === key ? "text-ink" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <button type="button" className={`${primaryButtonClass} mt-4`} onClick={() => setMaking((value) => !value)}>
        {making ? "Close" : "Create a group"}
      </button>
      {making ? (
        <form onSubmit={(event) => void create(event)} className="mt-3 grid gap-2 rounded-3xl glass-edge bg-card p-4">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Group name" className={fieldClass} />
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={280} placeholder="A short description" className={fieldClass} />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass}>
            {GROUP_CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <input value={whereAt} onChange={(event) => setWhereAt(event.target.value)} maxLength={80} placeholder="Place, if it belongs to one" className={fieldClass} />
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value === "private" ? "private" : "public")} className={fieldClass}>
            <option value="public">Public. Anyone can find it.</option>
            <option value="private">Private. Only members see the talks.</option>
          </select>
          <select value={joinMode} onChange={(event) => setJoinMode(event.target.value === "approval" ? "approval" : "open")} className={fieldClass}>
            <option value="open">Anyone can join</option>
            <option value="approval">A leader approves new members</option>
          </select>
          <select value={postMode} onChange={(event) => setPostMode(event.target.value === "admin" ? "admin" : "members")} className={fieldClass}>
            <option value="members">Members can post</option>
            <option value="admin">Only leaders can post</option>
          </select>
          <textarea value={rules} onChange={(event) => setRules(event.target.value)} maxLength={600} rows={4} className={fieldClass} />
          <button type="submit" className={primaryButtonClass} disabled={pending || !name.trim() || !purpose.trim()}>
            {pending ? "Creating…" : "Create"}
          </button>
          <Fault text={error} />
        </form>
      ) : null}
      {status === "error" ? <p className="mt-4 text-sm text-muted">Couldn't load groups.</p> : null}
      {status === "ready" && shown.length === 0 ? <p className="mt-6 text-sm text-muted">Nothing in this list yet.</p> : null}
      <ul className="mt-4 space-y-3">
        {shown.map((group) => (
          <li key={group.id}>
            <GroupCardView group={group} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupCardView({ group, onOpen }: { group: GroupCard; onOpen?: (id: string) => void }) {
  return (
    <article className="overflow-hidden rounded-3xl glass-edge bg-card">
      <div className="h-16 bg-[#14300a]" style={group.cover ? { backgroundImage: `url(${group.cover})`, backgroundSize: "cover" } : undefined}>
        <p className="px-4 pt-4 text-xs font-semibold tracking-wide text-[#90c840]">{group.category}</p>
      </div>
      <div className="px-4 py-3">
        <h2 className="font-display text-2xl text-ink">{group.name}</h2>
        <p className="mt-1 text-sm text-post">{group.purpose}</p>
        <p className="mt-2 text-sm text-muted">
          {group.members} {group.members === 1 ? "member" : "members"} · {group.privacy === "private" ? "Private" : "Public"}
          {group.whereAt ? ` · ${group.whereAt}` : ""}
        </p>
        {onOpen ? (
          <button type="button" className={`${quietButtonClass} mt-3 px-3 text-ink`} onClick={() => onOpen(String(group.id))}>
            {group.joined ? "View group" : group.pending ? "Asked to join" : "View group"}
          </button>
        ) : (
          <Link to="/groups/$groupId" params={{ groupId: String(group.id) }} className={`${quietButtonClass} mt-3 px-3 text-ink`}>
            {group.joined ? "View group" : group.pending ? "Asked to join" : "View group"}
          </Link>
        )}
      </div>
    </article>
  );
}

export function GroupHomeView({ groupId, onBack }: { groupId: string; onBack?: () => void }) {
  const user = useCurrentUser();
  const [page, setPage] = useState<GroupHome | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [tab, setTab] = useState("home");
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [passage, setPassage] = useState<{ book: number; chapter: number; verse: number } | null>(null);
  const id = Number(groupId);

  useEffect(() => {
    if (!user?.id || !Number.isInteger(id)) return;
    let cancel = false;
    openGroup({ data: { id, ...seedOf(user) } })
      .then((next) => {
        if (cancel) return;
        if (!next) setStatus("missing");
        else {
          setPage(next);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [user?.id, user?.displayName, user?.primaryEmail, id, tick]);

  if (status === "loading") return null;
  if (status === "error") return <p className="text-sm text-muted">Couldn't open that group.</p>;
  if (!page) {
    return (
      <div>
        <h1 className="font-display text-2xl text-ink">That group is not open</h1>
        {onBack ? (
          <button type="button" className="mt-3 text-sm font-semibold text-ink" onClick={onBack}>
            Back to groups
          </button>
        ) : (
          <Link to="/groups" className="mt-3 inline-flex text-sm font-semibold text-ink">
            Back to groups
          </Link>
        )}
      </div>
    );
  }

  const lead = page.role === "owner" || page.role === "admin" || page.role === "moderator";
  const tabs = ["home", "discussions", "study", "prayer", "events", "resources", "members", "about", ...(lead ? ["desk"] : [])];

  async function refresh() {
    setTick((value) => value + 1);
  }

  return (
    <div>
      <div className="overflow-hidden rounded-3xl glass-edge bg-card">
        <div className="h-24 bg-[#14300a]" style={page.cover ? { backgroundImage: `url(${page.cover})`, backgroundSize: "cover" } : undefined} />
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-[#90c840]">{page.category}</p>
          <h1 className="font-display text-3xl text-ink">{page.name}</h1>
          <p className="mt-1 text-sm text-post">{page.purpose}</p>
          <p className="mt-2 text-sm text-muted">
            {page.memberCount} {page.memberCount === 1 ? "member" : "members"} · {page.privacy === "private" ? "Private" : "Public"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {page.joined ? <span className={`${quietButtonClass} px-3`}>Joined</span> : null}
            {!page.joined && !page.pending ? (
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  void joinGroup({ data: page.id }).then((result) => {
                    if (!result.ok) setError(result.error);
                    else void refresh();
                  });
                }}
              >
                Join
              </button>
            ) : null}
            {page.pending ? <span className="text-sm text-muted">Waiting for a leader to let you in.</span> : null}
            <button
              type="button"
              className={`${quietButtonClass} px-3`}
              onClick={() => {
                void followGroup({ data: page.id }).then(() => refresh());
              }}
            >
              Follow
            </button>
            <button
              type="button"
              className={`${quietButtonClass} px-3`}
              onClick={() => {
                const link = `${window.location.origin}/groups/${page.id}`;
                void navigator.clipboard?.writeText(link);
                setError("The group link is copied.");
              }}
            >
              Share
            </button>
          </div>
          <Fault text={error} />
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {tabs.map((item) => (
          <button key={item} type="button" className={`${quietButtonClass} shrink-0 px-3 capitalize ${tab === item ? "text-ink" : ""}`} onClick={() => setTab(item)}>
            {item === "study" ? "Bible Study" : item}
          </button>
        ))}
      </div>
      {page.joined && (tab === "home" || tab === "discussions" || tab === "prayer" || tab === "events" || tab === "resources") ? (
        <Composer page={page} user={user} tab={tab} onDone={refresh} onError={setError} />
      ) : null}
      {tab === "about" ? <About page={page} /> : null}
      {tab === "members" ? <Members page={page} userId={user?.id ?? ""} onDone={refresh} onError={setError} /> : null}
      {tab === "study" ? <Studies page={page} onDone={refresh} onError={setError} onPassage={setPassage} /> : null}
      {tab === "desk" && lead ? <Desk page={page} onDone={refresh} /> : null}
      {tab !== "about" && tab !== "members" && tab !== "study" && tab !== "desk" ? (
        page.joined ? (
          <PostList page={page} tab={tab} lead={lead} onDone={refresh} onPassage={setPassage} />
        ) : (
          <p className="mt-4 text-sm text-muted">{page.privacy === "private" ? "Join to see what this group shares." : "Join to take part. The talks open once you are in."}</p>
        )
      ) : null}
      {passage ? createPortal(<BibleReader onBack={() => setPassage(null)} passage={passage} />, document.body) : null}
    </div>
  );
}

function About({ page }: { page: GroupHome }) {
  return (
    <div className="mt-4 rounded-3xl glass-edge bg-card p-4">
      <p className="text-sm text-muted">{page.privacy === "private" ? "Private. People can find the group. Only members see the talks." : "Public. Anyone can find the group."}</p>
      <p className="mt-2 text-sm text-muted">{page.joinMode === "approval" ? "A leader approves new members." : "Anyone can join."}</p>
      <p className="mt-2 text-sm text-muted">{page.postMode === "admin" ? "Only leaders post. Members can still answer." : "Members can post."}</p>
      {page.whereAt ? <p className="mt-2 text-sm text-ink">{page.whereAt}</p> : null}
      {page.rules ? <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-post">{page.rules}</pre> : null}
    </div>
  );
}

function Composer({
  page,
  user,
  tab,
  onDone,
  onError,
}: {
  page: GroupHome;
  user: { displayName: string | null; primaryEmail: string | null } | null;
  tab: string;
  onDone: () => void;
  onError: (text: string) => void;
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>(tab === "prayer" ? "prayer" : tab === "events" ? "event" : tab === "resources" ? "resource" : "discussion");
  const [body, setBody] = useState("");
  const [book, setBook] = useState("Romans");
  const [chapter, setChapter] = useState("8");
  const [verse, setVerse] = useState("28");
  const [when, setWhen] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const lead = page.role === "owner" || page.role === "admin" || page.role === "moderator";
  if (page.postMode === "admin" && !lead) return <p className="mt-4 text-sm text-muted">Only a leader posts here. You can still answer under a post.</p>;

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    let scripture = "";
    let verseText = "";
    if (kind === "scripture" || kind === "study") {
      const line = await verseLine(book, Number(chapter) || 1, Number(verse) || 1).catch(() => "");
      scripture = `${book} ${Number(chapter) || 1}:${Number(verse) || 1}`;
      verseText = line;
    }
    const result = await postInGroup({
      data: { ...seedOf(user), groupId: page.id, kind, body, scripture, verseText, eventWhen: when, eventPlace: place },
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setBody("");
    onDone();
  }

  return (
    <form onSubmit={(event) => void send(event)} className="mt-4 rounded-3xl glass-edge bg-card p-4">
      <p className="text-sm font-semibold text-ink">What would you like to share?</p>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {KINDS.map(([key, label]) => (
          <button key={key} type="button" className={`${quietButtonClass} shrink-0 px-2 ${kind === key ? "text-ink" : ""}`} onClick={() => setKind(key)}>
            {label}
          </button>
        ))}
      </div>
      {kind === "scripture" || kind === "study" ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <select value={book} onChange={(event) => setBook(event.target.value)} className={fieldClass}>
            {BOOKS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <input value={chapter} onChange={(event) => setChapter(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="Chapter" className={fieldClass} />
          <input value={verse} onChange={(event) => setVerse(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="Verse" className={fieldClass} />
        </div>
      ) : null}
      {kind === "event" ? (
        <div className="mt-2 grid gap-2">
          <input value={when} onChange={(event) => setWhen(event.target.value)} placeholder="When" className={fieldClass} />
          <input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="Where, or a meeting link" className={fieldClass} />
        </div>
      ) : null}
      <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={800} rows={3} placeholder={kind === "scripture" ? "Share your thoughts about this Scripture." : "Write to the group"} className={`${fieldClass} mt-2`} />
      <button type="submit" className={`${primaryButtonClass} mt-2`} disabled={busy || !body.trim()}>
        {busy ? "Sending…" : "Share"}
      </button>
    </form>
  );
}

function PostList({
  page,
  tab,
  lead,
  onDone,
  onPassage,
}: {
  page: GroupHome;
  tab: string;
  lead: boolean;
  onDone: () => void;
  onPassage: (passage: { book: number; chapter: number; verse: number }) => void;
}) {
  const kinds =
    tab === "discussions" ? ["discussion", "scripture", "question", "video"] : tab === "prayer" ? ["prayer"] : tab === "events" ? ["event"] : tab === "resources" ? ["resource"] : null;
  const posts = page.posts.filter((post) => !post.parentId && (!kinds || kinds.includes(post.kind)));
  if (!posts.length) return <p className="mt-4 text-sm text-muted">Nothing here yet.</p>;
  return (
    <ul className="mt-4 space-y-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} page={page} lead={lead} onDone={onDone} onPassage={onPassage} />
      ))}
    </ul>
  );
}

function PostCard({
  post,
  page,
  lead,
  onDone,
  onPassage,
}: {
  post: GroupPost;
  page: GroupHome;
  lead: boolean;
  onDone: () => void;
  onPassage: (passage: { book: number; chapter: number; verse: number }) => void;
}) {
  const user = useCurrentUser();
  const [reply, setReply] = useState("");
  const replies = page.posts.filter((item) => item.parentId === post.id);
  const passage = post.scripture ? passageOf(post.scripture) : null;

  async function mark(kind: string) {
    await markGroupPost({ data: { noteId: post.id, kind } });
    onDone();
  }

  async function guide(action: string, noteId = post.id) {
    await guideGroup({ data: { groupId: page.id, noteId, action } });
    onDone();
  }

  return (
    <li className="rounded-3xl glass-edge bg-card p-4">
      <p className="text-sm">
        <span className="font-semibold text-ink">{post.authorName}</span> <span className="text-muted">{formatWhen(post.createdAt)}</span>
        {post.pinned ? <span className="text-muted"> · Pinned</span> : null}
      </p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#90c840]">{post.kind}</p>
      {post.scripture ? (
        <button type="button" className="mt-2 block text-left" onClick={() => passage && onPassage(passage)}>
          <span className="font-display text-xl text-ink">{post.scripture}</span>
          {post.verseText ? <span className="mt-1 block text-sm text-post">{post.verseText}</span> : null}
        </button>
      ) : null}
      <p className="mt-2 whitespace-pre-wrap text-ink">{post.body}</p>
      {post.eventWhen || post.eventPlace ? (
        <p className="mt-2 text-sm text-muted">
          {post.eventWhen}
          {post.eventPlace ? ` · ${post.eventPlace}` : ""}
        </p>
      ) : null}
      {post.answered ? <p className="mt-2 text-sm font-semibold text-[#90c840]">Prayer answered</p> : null}
      {post.helpful ? <p className="mt-2 text-sm font-semibold text-[#90c840]">Helpful answer</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {post.kind === "prayer" ? (
          <>
            <button type="button" className={quietButtonClass} onClick={() => void mark("pray")}>Pray {post.prays || ""}</button>
            <button type="button" className={quietButtonClass} onClick={() => void mark("support")}>Support {post.supports || ""}</button>
            {post.authorId === user?.id || lead ? (
              <button type="button" className={quietButtonClass} onClick={() => void guide("answered")}>
                {post.answered ? "Still praying" : "Prayer answered"}
              </button>
            ) : null}
          </>
        ) : null}
        {post.kind === "question" || post.kind === "discussion" || post.kind === "scripture" ? (
          <button type="button" className={quietButtonClass} onClick={() => void mark("up")}>Up {post.ups || ""}</button>
        ) : null}
        {post.kind === "event" ? (
          <>
            <button type="button" className={quietButtonClass} onClick={() => void mark("going")}>Going {post.going || ""}</button>
            <button type="button" className={quietButtonClass} onClick={() => void mark("maybe")}>Maybe {post.maybe || ""}</button>
            <button type="button" className={quietButtonClass} onClick={() => void mark("decline")}>Not going</button>
          </>
        ) : null}
        <button type="button" className={quietButtonClass} onClick={() => void guide("report")}>Report</button>
      </div>
      {lead ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={quietButtonClass} onClick={() => void guide(post.pinned ? "unpin" : "pin")}>{post.pinned ? "Unpin" : "Pin"}</button>
          <button type="button" className={quietButtonClass} onClick={() => void guide(post.locked ? "unlock" : "lock")}>{post.locked ? "Unlock" : "Lock"}</button>
          <button type="button" className={quietButtonClass} onClick={() => void guide("hide")}>Hide</button>
          <button type="button" className={quietButtonClass} onClick={() => void guide("delete")}>Delete</button>
          {post.reports ? <span className="text-sm text-muted">{post.reports} reports</span> : null}
        </div>
      ) : null}
      {replies.length ? (
        <ul className="mt-3 space-y-2 border-t border-line pt-3">
          {replies.map((item) => (
            <li key={item.id}>
              <p className="text-sm font-semibold text-ink">{item.authorName}</p>
              <p className="text-sm text-post">{item.body}</p>
              {item.helpful ? <p className="text-xs font-semibold text-[#90c840]">Helpful answer</p> : null}
              {lead ? (
                <button type="button" className={`${quietButtonClass} mt-1 px-2`} onClick={() => void guide("helpful", item.id)}>
                  {item.helpful ? "Unmark" : "Mark helpful"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!post.locked || lead ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void postInGroup({ data: { ...seedOf(user), groupId: page.id, parentId: post.id, kind: post.kind, body: reply } }).then((result) => {
              if (result.ok) {
                setReply("");
                onDone();
              }
            });
          }}
        >
          <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Answer" className={fieldClass} />
          <button type="submit" className={primaryButtonClass} disabled={!reply.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">This discussion is locked.</p>
      )}
    </li>
  );
}

function Studies({
  page,
  onDone,
  onError,
  onPassage,
}: {
  page: GroupHome;
  onDone: () => void;
  onError: (text: string) => void;
  onPassage: (passage: { book: number; chapter: number; verse: number }) => void;
}) {
  const user = useCurrentUser();
  const lead = page.role === "owner" || page.role === "admin" || page.role === "moderator";
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [passage, setPassage] = useState("Romans 1:1");
  const [days, setDays] = useState("30");
  return (
    <div className="mt-4 space-y-3">
      {lead ? (
        <form
          className="grid gap-2 rounded-3xl glass-edge bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveGroupStudy({ data: { ...seedOf(user), groupId: page.id, title, detail, passage, days: Number(days) || 1 } }).then((result) => {
              if (!result.ok) onError(result.error);
              else {
                setTitle("");
                onDone();
              }
            });
          }}
        >
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Study title" className={fieldClass} />
          <input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="What you will read, and the question for the day" className={fieldClass} />
          <input value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="Romans 1:1" className={fieldClass} />
          <input value={days} onChange={(event) => setDays(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Days" className={fieldClass} />
          <button type="submit" className={primaryButtonClass} disabled={!title.trim()}>
            Open the study
          </button>
        </form>
      ) : null}
      {page.studies.map((study) => {
        const today = Math.min(study.days, Math.max(1, study.done.length + 1));
        const width = Math.round((study.done.length / study.days) * 100);
        const opened = passageOf(study.passage);
        return (
          <article key={study.id} className="rounded-3xl glass-edge bg-card p-4">
            <h2 className="font-display text-2xl text-ink">{study.title}</h2>
            <p className="mt-1 text-sm text-post">{study.detail}</p>
            {opened ? (
              <button type="button" className="mt-2 text-sm font-semibold text-ink" onClick={() => onPassage(opened)}>
                {study.passage}
              </button>
            ) : (
              <p className="mt-2 text-sm text-ink">{study.passage}</p>
            )}
            <p className="mt-3 text-sm text-muted">
              Day {Math.min(study.done.length + 1, study.days)} of {study.days}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black">
              <div className="h-full bg-[#90c840]" style={{ width: `${width}%` }} />
            </div>
            <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void markStudyDay({ data: { studyId: study.id, day: today } }).then(() => onDone())}>
              {study.done.includes(today) ? "Read again" : "I read today"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function Members({ page, userId, onDone, onError }: { page: GroupHome; userId: string; onDone: () => void; onError: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<{ userId: string; displayName: string; imageUrl: string | null }[]>([]);
  const owner = page.role === "owner";
  useEffect(() => {
    if (!owner || query.trim().length < 2) return;
    let cancel = false;
    listPeople({ data: { displayName: "", email: null, imageUrl: null } })
      .then((result) => {
        if (cancel) return;
        const needle = query.trim().toLowerCase();
        setPeople(
          result.people
            .filter((person) => person.displayName.toLowerCase().includes(needle) && !page.members.some((member) => member.userId === person.userId))
            .slice(0, 6)
            .map((person) => ({ userId: person.userId, displayName: person.displayName, imageUrl: person.imageUrl })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [owner, query, page.members]);

  return (
    <div className="mt-4">
      <ul className="divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
        {page.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={member.displayName} imageUrl={member.imageUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{member.displayName}{member.userId === userId ? " · you" : ""}</span>
              <span className="block text-sm capitalize text-muted">{member.role}</span>
            </span>
            {owner && member.userId !== userId ? (
              <span className="flex gap-1">
                <button type="button" className={`${quietButtonClass} px-2`} onClick={() => void guideGroup({ data: { groupId: page.id, userId: member.userId, role: member.role === "moderator" ? "member" : "moderator", action: "role" } }).then(() => onDone())}>
                  {member.role === "moderator" ? "Member" : "Moderator"}
                </button>
                <button type="button" className={`${quietButtonClass} px-2`} onClick={() => void guideGroup({ data: { groupId: page.id, userId: member.userId, action: "ban" } }).then(() => onDone())}>
                  Remove
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {owner ? (
        <div className="mt-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invite someone by name" className={fieldClass} />
          <ul className="mt-2">
            {people.map((person) => (
              <li key={person.userId} className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-ink">{person.displayName}</span>
                <button
                  type="button"
                  className={`${quietButtonClass} px-2`}
                  onClick={() => {
                    void addMember({ data: { groupId: page.id, userId: person.userId } }).then((result) => {
                      if (!result.ok) onError(result.error);
                      else onDone();
                    });
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Desk({ page, onDone }: { page: GroupHome; onDone: () => void }) {
  return (
    <div className="mt-4 rounded-3xl glass-edge bg-card p-4">
      <h2 className="font-display text-2xl text-ink">Group overview</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted">Members</dt><dd className="text-ink">{page.memberCount}</dd></div>
        <div><dt className="text-muted">Posts</dt><dd className="text-ink">{page.postCount}</dd></div>
        <div><dt className="text-muted">Waiting</dt><dd className="text-ink">{page.waiting.length}</dd></div>
        <div><dt className="text-muted">Reports</dt><dd className="text-ink">{page.reportCount}</dd></div>
      </dl>
      {page.waiting.map((person) => (
        <div key={person.userId} className="mt-3 flex items-center justify-between gap-2">
          <span className="truncate text-ink">{person.displayName}</span>
          <span className="flex gap-2">
            <button type="button" className={quietButtonClass} onClick={() => void guideGroup({ data: { groupId: page.id, userId: person.userId, action: "approve" } }).then(() => onDone())}>Approve</button>
            <button type="button" className={quietButtonClass} onClick={() => void guideGroup({ data: { groupId: page.id, userId: person.userId, action: "reject" } }).then(() => onDone())}>No</button>
          </span>
        </div>
      ))}
    </div>
  );
}
