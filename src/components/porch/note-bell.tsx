import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { bellCount, bellNotes, bellSeen, type BellNote } from "@/lib/porch/notes";
import { getOnePost } from "@/lib/porch/api";
import { setBellOn, useNoteStyle } from "@/lib/porch/note-style";
import type { Post, Seed } from "@/lib/porch/model";

/**
 * The bell 🔔 beside LITE: a red count of new reactions, replies and questions for you.
 * Tapping it opens the list (newest first, by day; several reactions to one post become one line).
 * Tapping a line opens that post.
 */
const REACT: Record<string, [string, string]> = {
  care: ["❤️", "loved"],
  thanks: ["👍", "liked"],
  insight: ["✨", "marked {} Touching"],
  cheer: ["🌊", "marked {} Deep"],
};
const TINTS = ["#2f7d14", "#d9800f", "#3d8a12", "#b8650a"];
type Tab = "all" | "reaction" | "reply" | "question";
type Line = { key: string; notes: BellNote[] };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
const tint = (id: string) => TINTS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

function dayOf(at: string) {
  const d = new Date(at);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function ago(at: string) {
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400 && dayOf(at) === "Today") return `${Math.floor(s / 3600)} hr${s >= 7200 ? "s" : ""} ago`;
  return `${dayOf(at)}, ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase()}`;
}

function sentence(line: Line) {
  const first = line.notes[0];
  const place = first.target === "reply" ? "your reply" : "your post";
  const others = line.notes.length - 1;
  const who = (
    <>
      <b>{first.actorName}</b>
      {others > 0 ? (
        <>
          {" "}
          and <b>{others === 1 ? line.notes[1].actorName : `${others} others`}</b>
        </>
      ) : null}
    </>
  );
  if (first.kind === "reply") return <>{who} replied to your post</>;
  if (first.kind === "question") return <>{who} asked you a question</>;
  const verb = REACT[first.reaction]?.[1] ?? "reacted to";
  return (
    <>
      {who} {verb.includes("{}") ? verb.replace("{}", place) : `${verb} ${place}`}
    </>
  );
}

export function NoteBell({ userId, seed }: { userId: string; seed: Seed }) {
  const [shown, setShown] = useState(false);
  const [unread, setUnread] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<BellNote[] | null>(null);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [post, setPost] = useState<Post | null>(null);
  const [Card, setCard] = useState<ComponentType<{ post: Post; userId: string; seed: Seed; onChange: () => void }> | null>(null);
  const style = useNoteStyle();

  const count = useCallback(() => {
    void bellCount()
      .then((r) => {
        setShown(r.show);
        setBellOn(r.show);
        setUnread(r.unread);
        setWaiting(r.show && "waiting" in r ? Number(r.waiting ?? 0) : 0);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    count();
    // Every 2 minutes, and when the phone comes back to Porchbook.
    const timer = window.setInterval(() => document.visibilityState === "visible" && count(), 120_000);
    const back = () => document.visibilityState === "visible" && count();
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [count]);

  async function openList() {
    setOpen(true);
    setTab("all");
    const r = await bellNotes({ data: {} }).catch(() => null);
    setNotes(r?.ok ? r.notes : []);
    setMore(Boolean(r?.more));
    if (unread) {
      setUnread(0);
      void bellSeen().catch(() => undefined);
    }
  }
  async function earlier() {
    const last = notes?.[notes.length - 1];
    if (!last) return;
    const r = await bellNotes({ data: { before: last.at } }).catch(() => null);
    if (r?.ok) {
      setNotes((n) => [...(n ?? []), ...r.notes]);
      setMore(r.more);
    }
  }
  async function openPost(postId: number) {
    if (!postId) return;
    const [r, mod] = await Promise.all([getOnePost({ data: { postId } }).catch(() => null), Card ? null : import("@/components/porch/feed-view")]);
    if (mod) setCard(() => mod.PostCard as never);
    if (r?.ok) setPost(r.post);
  }
  async function refreshPost() {
    if (!post) return;
    const r = await getOnePost({ data: { postId: post.id } }).catch(() => null);
    if (r?.ok) setPost(r.post);
  }

  // Lines: reactions of the same kind to the same post or reply, on the same day, become one line.
  const days = useMemo(() => {
    const list = (notes ?? []).filter((n) => tab === "all" || n.kind === tab);
    const lines: Line[] = [];
    const byKey = new Map<string, Line>();
    for (const n of list) {
      const key = n.kind === "reaction" ? `r-${n.target}-${n.refId}-${n.reaction}-${dayOf(n.at)}` : `${n.kind}-${n.id}`;
      const found = byKey.get(key);
      if (found) found.notes.push(n);
      else {
        const line = { key, notes: [n] };
        byKey.set(key, line);
        lines.push(line);
      }
    }
    const out: { day: string; lines: Line[] }[] = [];
    for (const line of lines) {
      const day = dayOf(line.notes[0].at);
      if (out[out.length - 1]?.day !== day) out.push({ day, lines: [] });
      out[out.length - 1].lines.push(line);
    }
    return out;
  }, [notes, tab]);

  if (!shown) return null;
  return (
    <>
      <button
        type="button"
        className="note-bell"
        aria-label={unread || waiting ? `${unread} new notifications${waiting ? `, ${waiting} waiting to join` : ""}` : "Notifications"}
        onClick={() => void openList()}
      >
        {/* The design's outline bell (Stage 4a). */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z" />
          <path d="M10 21h4" />
        </svg>
        {unread + waiting ? <b>{unread + waiting > 99 ? "99+" : unread + waiting}</b> : null}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="note-shade" onClick={() => setOpen(false)}>
              <div className={`note-sheet is-${style}`} role="dialog" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
                <div className="note-head">
                  <h3>Notifications</h3>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                    ✕
                  </button>
                </div>
                <div className="note-tabs">
                  {(
                    [
                      ["all", "All"],
                      ["reaction", "Reactions"],
                      ["reply", "Replies"],
                      ["question", "Questions"],
                    ] as const
                  ).map(([key, label]) => (
                    <button key={key} type="button" className={tab === key ? "is-on" : ""} onClick={() => setTab(key)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="note-list">
                  {waiting ? (
                    <Link to="/waiting-to-join" className="note-waiting" onClick={() => setOpen(false)}>
                      <span>
                        <strong>
                          {waiting} {waiting === 1 ? "person" : "people"} waiting to join
                        </strong>
                        <small>Let them in, or decline</small>
                      </span>
                      <span className="note-waiting-go">Review</span>
                    </Link>
                  ) : null}
                  {notes === null ? <p className="note-empty">Loading…</p> : null}
                  {notes && !days.length && !waiting ? (
                    <p className="note-empty">Nothing yet. When someone reacts to your posts, replies or asks you something, it shows here.</p>
                  ) : null}
                  {days.map((group) => (
                    <div key={group.day}>
                      <p className="note-day">{group.day}</p>
                      {group.lines.map((line) => {
                        const first = line.notes[0];
                        const fresh = line.notes.some((n) => !n.seen);
                        const mark = first.kind === "reply" ? "💬" : first.kind === "question" ? "❓" : (REACT[first.reaction]?.[0] ?? "❤️");
                        return (
                          <button key={line.key} type="button" className={`note-item${fresh ? " is-new" : ""}`} onClick={() => void openPost(first.postId)}>
                            <span className="note-av" style={{ background: tint(first.actorId) }}>
                              {first.actorImage ? <img src={first.actorImage} alt="" /> : initials(first.actorName)}
                              <em>{mark}</em>
                            </span>
                            <span className="note-tx">
                              {sentence(line)}
                              {first.snippet ? <q>{first.snippet}</q> : null}
                              <small>{ago(first.at)}</small>
                            </span>
                            {fresh ? <span className="note-dot" aria-label="New" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {more ? (
                  <button type="button" className="note-foot" onClick={() => void earlier()}>
                    See earlier
                  </button>
                ) : null}
              </div>
              {post && Card ? (
                <div className="post-open-sheet" onClick={(e) => e.stopPropagation()}>
                  <div className="post-open-fit">
                    <div className="post-ring-card">
                      <Card post={post} userId={userId} seed={seed} onChange={() => void refreshPost()} />
                    </div>
                  </div>
                  <button type="button" className="post-back" onClick={() => setPost(null)}>
                    BACK
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
