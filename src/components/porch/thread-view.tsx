import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type UIEvent } from "react";
import { ChevronLeft, Search, Send, Star, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getThread, sendMessage, setResponding } from "@/lib/porch/api";
import { deleteMessage, editMessage, pinMessage, reactMessage, starMessage } from "@/lib/porch/chat";
import { pingInbox } from "@/lib/porch/inbox-events";
import { CHAT_REACTS, type DirectMessage, type ThreadPage } from "@/lib/porch/model";
import { CallLink, LinkText, quietButtonClass } from "@/components/porch/bits";
import { PbAvatar, useConversationOpen } from "@/components/porch/pb-shell";
import { onlineState, usePorch } from "@/lib/porch/presence-store";
import { Fault } from "@/components/porch/trouble";

function dayLabel(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const day = new Date(t);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(day)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function clock(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function sameThread(current: ThreadPage, next: ThreadPage) {
  if (current.responding !== next.responding) return false;
  if (current.pinned?.id !== next.pinned?.id || current.pinned?.body !== next.pinned?.body) return false;
  if (current.messages.length !== next.messages.length) return false;
  return current.messages.every((message, index) => {
    const other = next.messages[index];
    if (!other) return false;
    return (
      message.id === other.id &&
      message.body === other.body &&
      message.edited === other.edited &&
      message.deleted === other.deleted &&
      message.starred === other.starred &&
      message.reactions.length === other.reactions.length &&
      message.reactions.every((reaction, at) => reaction.emoji === other.reactions[at]?.emoji && reaction.count === other.reactions[at]?.count && reaction.mine === other.reactions[at]?.mine)
    );
  });
}

export function ThreadView({ userId }: { userId: string }) {
  const user = useCurrentUser();
  useConversationOpen();
  usePorch(); // re-draws the "on the porch now" dot
  const [page, setPage] = useState<ThreadPage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [reply, setReply] = useState<DirectMessage | null>(null);
  const [editing, setEditing] = useState<DirectMessage | null>(null);
  const [menu, setMenu] = useState<DirectMessage | null>(null);
  const [find, setFind] = useState("");
  const [starsOnly, setStarsOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const hold = useRef<{ id: number; timer: number; x: number; y: number; swiped: boolean } | null>(null);

  const viewerId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!viewerId) return;
    let cancel = false;
    const load = (quiet: boolean) => {
      if (!quiet) setStatus("loading");
      getThread({ data: { userId, displayName, email, imageUrl } })
        .then((result) => {
          if (cancel) return;
          setPage((current) => (quiet && current && sameThread(current, result) ? current : result));
          setStatus("ready");
          pingInbox();
        })
        .catch(() => {
          if (!cancel && !quiet) setStatus("error");
        });
    };
    load(false);
    const timer = window.setInterval(() => load(true), 1000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [viewerId, displayName, email, imageUrl, userId, tick]);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [page?.messages, page?.responding]);

  useEffect(() => {
    if (!viewerId || userId === viewerId) return;
    const on = draft.trim().length > 0 && !editing;
    void setResponding({ data: { userId, on, displayName, email, imageUrl } });
  }, [draft, viewerId, userId, displayName, email, imageUrl, editing]);

  useEffect(() => {
    return () => {
      if (!viewerId) return;
      void setResponding({ data: { userId, on: false, displayName, email, imageUrl } });
    };
  }, [viewerId, userId, displayName, email, imageUrl]);

  if (status === "loading" && !page) return null;
  if (status === "error") {
    return <p className="text-danger">Couldn't open that conversation.</p>;
  }
  if (!page?.profile) {
    return (
      <div className="rounded-3xl glass-edge bg-card px-5 py-10 text-center">
        <h1 className="font-display text-2xl text-ink">Nobody here yet</h1>
        <p className="mt-2 text-muted">That person hasn't joined Porchbook.</p>
        <Link to="/messages" className={`${quietButtonClass} mt-3`}>
          Back to messages
        </Link>
      </div>
    );
  }
  const profile = page.profile;
  const mineSpace = page.isSelf;
  const here = !mineSpace && onlineState(profile.userId) !== null;
  const meta = mineSpace ? "Only you can read this" : [profile.role, profile.team].filter(Boolean).join(" · ");
  const seed = { displayName, email, imageUrl };
  const needle = find.trim().toLowerCase();
  const shown = page.messages.filter((message) => {
    if (starsOnly && !message.starred) return false;
    if (!needle) return true;
    return message.body.toLowerCase().includes(needle) || message.replyBody.toLowerCase().includes(needle);
  });

  async function refresh() {
    setTick((value) => value + 1);
    setMenu(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending || !page) return;
    setPending(true);
    setError("");
    if (editing) {
      const result = await editMessage({ data: { messageId: editing.id, body, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      setDraft("");
      await refresh();
      return;
    }
    const optimistic: DirectMessage = {
      id: -Date.now(),
      authorId: viewerId,
      body,
      createdAt: new Date().toISOString(),
      mine: true,
      edited: false,
      deleted: false,
      replyTo: reply?.id ?? null,
      replyBody: reply?.deleted ? "Deleted message" : (reply?.body ?? ""),
      starred: false,
      reactions: [],
      canEdit: true,
      canDeleteAll: true,
    };
    setPage({ ...page, messages: [...page.messages, optimistic], responding: page.responding });
    setDraft("");
    const answering = reply;
    setReply(null);
    stickRef.current = true;
    const result = await sendMessage({
      data: { userId, body, replyTo: answering?.id ?? null, ...seed },
    });
    setPending(false);
    if (!result.ok) {
      setPage(page);
      setDraft(body);
      setReply(answering);
      setError(result.error);
      return;
    }
    await refresh();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function pressStart(message: DirectMessage, event: ReactPointerEvent<HTMLDivElement>) {
    if (message.deleted) return;
    const point = { id: message.id, timer: 0, x: event.clientX, y: event.clientY, swiped: false };
    point.timer = window.setTimeout(() => setMenu(message), 420);
    hold.current = point;
  }

  function pressMove(message: DirectMessage, event: ReactPointerEvent<HTMLDivElement>) {
    const current = hold.current;
    if (!current || current.id !== message.id) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.abs(dy) > 24 || Math.abs(dx) > 12) window.clearTimeout(current.timer);
    if (!current.swiped && dx > 64 && Math.abs(dy) < 40) {
      current.swiped = true;
      setReply(message);
      setEditing(null);
      setMenu(null);
    }
  }

  function pressEnd() {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    const result = await run();
    if (!result.ok) {
      setError(result.error ?? "That didn't work.");
      return;
    }
    await refresh();
  }

  let lastDay = "";

  return (
    <div className="pb pb-convo pc-thread fixed inset-x-0 top-[var(--porch-head,7.25rem)] bottom-0 z-10 flex flex-col lg:relative lg:z-auto lg:h-[calc(100dvh-8.5rem)] lg:overflow-hidden lg:rounded-3xl">
      <header className="pb-convo-head">
        <Link to="/messages" aria-label="Back" className="pb-iconbtn">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        {mineSpace ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-ink">My Space</span>
            <span className="block truncate text-xs text-muted">{meta}</span>
          </span>
        ) : (
          <Link
            to="/people/$userId"
            params={{ userId: profile.userId }}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg"
          >
            <span className="pb-face">
              <PbAvatar name={profile.displayName} imageUrl={profile.imageUrl} id={profile.userId} size={40} />
              {here ? <span className="pb-face-dot" aria-hidden="true" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate" style={{ fontWeight: 700, fontSize: 16 }}>{profile.displayName}</span>
              <span className="block truncate" style={{ fontSize: 13, color: here && !page.responding ? "var(--pb-second)" : "var(--pb-quiet)" }}>
                {page.responding ? `${profile.displayName} is responding…` : here ? "On the porch now" : meta || "Private"}
              </span>
            </span>
          </Link>
        )}
        <button
          type="button"
          aria-label="Search this chat"
          className="pb-iconbtn pb-iconbtn-plain"
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search className="size-5" />
        </button>
        {mineSpace ? null : (
          <>
            <CallLink userId={profile.userId} name={profile.displayName} className="pb-iconbtn is-green" />
            <CallLink video userId={profile.userId} name={profile.displayName} className="pb-iconbtn is-green" />
          </>
        )}
      </header>
      {searchOpen ? (
        <div className="pb-convo-bar">
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Search this chat"
            className="ofc-compose-box" style={{ minHeight: 40, padding: "8px 16px", fontSize: 15 }}
          />
          <button
            type="button"
            className={`${quietButtonClass} px-3 ${starsOnly ? "text-[#f8a018]" : ""}`}
            onClick={() => setStarsOnly((value) => !value)}
          >
            Starred
          </button>
        </div>
      ) : null}
      {page.pinned ? (
        <button
          type="button"
          className="pb-convo-bar pb-convo-pinned"
          onClick={() => {
            document.getElementById(`msg-${page.pinned?.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          Pinned · {page.pinned.body}
        </button>
      ) : null}
      <div ref={scroller} onScroll={onScroll} className="pb-convo-notes">
        {shown.length === 0 ? (
          <p className="pb-quiet" style={{ paddingTop: 40, textAlign: "center", fontSize: 14 }}>
            {needle || starsOnly ? "Nothing matches." : mineSpace ? "A note just for you." : "Say hello. Swipe a message to reply."}
          </p>
        ) : (
          shown.map((message) => {
            const day = dayLabel(message.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={message.id} id={`msg-${message.id}`}>
                {showDay ? (
                  <p className="pb-quiet" style={{ margin: "10px auto", width: "fit-content", fontSize: 12 }}>{day}</p>
                ) : null}
                <div className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    onPointerDown={(event) => pressStart(message, event)}
                    onPointerMove={(event) => pressMove(message, event)}
                    onPointerUp={pressEnd}
                    onPointerCancel={pressEnd}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!message.deleted) setMenu(message);
                    }}
                    className={`ofc-bubble${message.mine ? " is-mine" : ""}`}
                  >
                    {message.replyTo ? (
                      <p className={`mb-1 truncate rounded-lg px-2 py-1 text-xs ${message.mine ? "bg-black/10" : "bg-white/10"}`}>
                        {message.replyBody || "Message"}
                      </p>
                    ) : null}
                    {message.deleted ? (
                      <p className="text-sm italic opacity-70">Message deleted</p>
                    ) : (
                      <LinkText
                        text={message.body}
                        linkClass="underline underline-offset-2"
                      />
                    )}
                    {message.reactions.length > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {message.reactions.map((reaction) => (
                          <button
                            key={reaction.emoji}
                            type="button"
                            className={`rounded-full px-1.5 text-xs ${reaction.mine ? "bg-black/20" : "bg-white/10"}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => void act(() => reactMessage({ data: { messageId: message.id, emoji: reaction.emoji, ...seed } }))}
                          >
                            {reaction.emoji} {reaction.count}
                          </button>
                        ))}
                      </p>
                    ) : null}
                    <p className="ofc-bubble-meta" style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: message.mine ? "flex-end" : "flex-start" }}>
                      {message.starred ? <Star className="size-3 fill-current" /> : null}
                      {message.edited ? <span>Edited</span> : null}
                      <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {page.responding ? (
          <div className="flex justify-start">
            <p className="ofc-bubble pb-quiet" style={{ fontSize: 14 }}>
              {profile.displayName} is responding…
            </p>
          </div>
        ) : null}
      </div>
      {menu ? (
        <div className="pb-convo-bar pb-convo-menu">
          <div className="flex gap-2">
            {CHAT_REACTS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="pb-react-btn"
                onClick={() => void act(() => reactMessage({ data: { messageId: menu.id, emoji, ...seed } }))}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button type="button" className={quietButtonClass} onClick={() => { setReply(menu); setEditing(null); setMenu(null); }}>
              Reply
            </button>
            {menu.canEdit ? (
              <button
                type="button"
                className={quietButtonClass}
                onClick={() => {
                  setEditing(menu);
                  setReply(null);
                  setDraft(menu.body);
                  setMenu(null);
                }}
              >
                Edit
              </button>
            ) : null}
            <button type="button" className={quietButtonClass} onClick={() => void act(() => starMessage({ data: { messageId: menu.id, ...seed } }))}>
              {menu.starred ? "Unstar" : "Star"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => void act(() => pinMessage({ data: { messageId: menu.id, ...seed } }))}>
              {page.pinned?.id === menu.id ? "Unpin" : "Pin"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => void act(() => deleteMessage({ data: { messageId: menu.id, everyone: false, ...seed } }))}>
              Delete for me
            </button>
            {menu.canDeleteAll ? (
              <button type="button" className={quietButtonClass} onClick={() => void act(() => deleteMessage({ data: { messageId: menu.id, everyone: true, ...seed } }))}>
                Delete for everyone
              </button>
            ) : null}
            <button type="button" className={quietButtonClass} onClick={() => setMenu(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {reply ? (
        <div className="pb-convo-bar pb-convo-note">
          <p className="min-w-0 flex-1 truncate">Reply · {reply.body}</p>
          <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="pb-convo-bar pb-convo-note">
          <p className="min-w-0 flex-1 truncate">Editing</p>
          <button
            type="button"
            aria-label="Cancel edit"
            onClick={() => {
              setEditing(null);
              setDraft("");
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="ofc-compose">
        <label className="sr-only" htmlFor="private-note">
          Message
        </label>
        <textarea
          id="private-note"
          className="ofc-compose-box"
          rows={1}
          maxLength={2000}
          value={draft}
          placeholder={editing ? "Edit message" : mineSpace ? "Note to yourself" : `Message ${profile.displayName.split(/\s+/)[0] || ""}…`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          aria-label="Send"
          className="ofc-send"
          disabled={pending || !draft.trim()}
        >
          <Send className="size-5" aria-hidden="true" />
        </button>
      </form>
      <Fault text={error} className="px-3 pb-2" />
    </div>
  );
}
