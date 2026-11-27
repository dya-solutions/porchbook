import { W, WHint, useWord } from "@/components/porch/words";
import { BrandLogo } from "@/components/porch/brand-logo";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { HandHeart, Heart, Mail, ThumbsUp, Waves } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getFeed,
  pinPost,
  setCommentReaction,
  setReaction,
  toggleLock,
  updateComment,
  updatePost,
  founderDesk,
  listPeople,
} from "@/lib/porch/api";
import { Fault } from "@/components/porch/trouble";
import { playDropSound } from "@/lib/porch/button-sound-play";
import { toggleFounderDesk } from "@/components/porch/frame";
import {
  FILTER_META,
  REACTIONS,
  REACTION_META,
  ROOM_META,
  ROOMS,
  formatWhen,
  type FeedFilter,
  type Post,
  type Profile,
  type ReactionKind,
  type Room,
  type Seed,
} from "@/lib/porch/model";
import { RhemaChip } from "@/components/porch/rhema";
import { RestingFly, flyHome, flyToBox } from "@/components/porch/logo-fly";
import { Avatar, CallLink, LinkText, PersonLink, PostWindow, KeptPhoto, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { PostSlides } from "@/components/porch/post-slides";
import { ManualCard } from "@/components/porch/manual-card";
import { PbAvatar, PbIcon } from "@/components/porch/pb-shell";

const ICONS = {
  care: Heart,
  thanks: ThumbsUp,
  insight: HandHeart,
  cheer: Waves,
} as const;

/** The rooms' icons in the new design. */
const ROOM_ICON: Record<Room, string> = { proclaim: "star", inform: "bulb", ask: "ask" };

const FEED_CACHE = "porch-feed";

function feedStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readFeed(filter: FeedFilter, mine: boolean): { posts: Post[]; hasMore: boolean } | null {
  const store = feedStore();
  if (!store) return null;
  try {
    const raw = store.getItem(FEED_CACHE) || window.sessionStorage.getItem(FEED_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { filter?: string; mine?: boolean; posts?: Post[]; hasMore?: boolean };
    if (parsed.filter !== filter || Boolean(parsed.mine) !== mine || !Array.isArray(parsed.posts)) return null;
    return { posts: parsed.posts, hasMore: Boolean(parsed.hasMore) };
  } catch {
    return null;
  }
}

function saveFeed(filter: FeedFilter, mine: boolean, posts: Post[], hasMore: boolean) {
  const store = feedStore();
  if (!store) return;
  try {
    store.setItem(FEED_CACHE, JSON.stringify({ filter, mine, posts, hasMore }));
  } catch {
    // A full store should not block the feed.
  }
}

function seedOf(user: { displayName: string | null; primaryEmail: string | null; profileImageUrl: string | null }): Seed {
  return {
    displayName: user.displayName ?? "",
    email: user.primaryEmail,
    imageUrl: user.profileImageUrl,
  };
}

function PostRing({
  posts,
  userId,
  seed,
  onChange,
  hasMore,
  paging,
  onOlder,
}: {
  posts: Post[];
  userId: string;
  seed: Seed;
  onChange: () => void;
  hasMore: boolean;
  paging: boolean;
  onOlder: () => void;
}) {
  const ring = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const focusRef = useRef(0);
  const frame = useRef(0);
  const postsRef = useRef(posts);
  const drag = useRef({ on: false, origin: 0, originY: 0, x: 0, at: 0, moved: 0, velocity: 0, start: 0, pointer: -1, axis: "", kind: "" });
  const [focus, setFocus] = useState(0);
  const [opened, setOpened] = useState(false);
  const openedRef = useRef(false);
  postsRef.current = posts;
  openedRef.current = opened;

  function put(value: number) {
    const max = Math.max(0, postsRef.current.length - 1);
    const next = Math.min(max, Math.max(0, value));
    focusRef.current = next;
    setFocus(next);
  }

  function glide(target: number) {
    if (frame.current) cancelAnimationFrame(frame.current);
    const start = focusRef.current;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 420);
      const eased = 1 - (1 - t) ** 3;
      put(start + (target - start) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    const node = ring.current;
    if (!node) return;
    const begin = (clientX: number, clientY: number, pointer: number, kind: string, target: EventTarget | null) => {
      const hit = target instanceof Element ? target : null;
      if (hit?.closest("input, textarea, select")) return;
      if (openedRef.current) return;
      if (frame.current) cancelAnimationFrame(frame.current);
      drag.current = {
        on: true,
        origin: clientX,
        originY: clientY,
        x: clientX,
        at: performance.now(),
        moved: 0,
        velocity: 0,
        start: focusRef.current,
        pointer,
        axis: "",
        kind,
      };
    };
    const apply = (clientX: number) => {
      const dx = clientX - drag.current.origin;
      const now = performance.now();
      const step = clientX - drag.current.x;
      const width = node.clientWidth || 320;
      if (step !== 0) drag.current.velocity = -(step / width) / Math.max(16, now - drag.current.at);
      drag.current.x = clientX;
      drag.current.at = now;
      drag.current.moved = Math.abs(dx);
      put(drag.current.start - (dx * 0.9) / width);
    };
    const finish = () => {
      if (!drag.current.on) return;
      const axis = drag.current.axis;
      drag.current.on = false;
      if (axis !== "x") return;
      const speed = drag.current.velocity;
      const shift = focusRef.current - drag.current.start;
      const passed = Math.abs(shift) > 0.28;
      const flicked = Math.abs(speed) > 0.0006;
      if (!passed && !flicked) {
        glide(Math.round(drag.current.start));
        return;
      }
      const direction = Math.sign(shift || speed || 1);
      const steps = Math.abs(speed) > 0.0024 ? 2 : 1;
      glide(Math.round(drag.current.start) + direction * steps);
    };
    const claim = (dx: number, dy: number) => {
      if (!drag.current.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return false;
        drag.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      return drag.current.axis === "x";
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      begin(event.clientX, event.clientY, event.pointerId, event.pointerType, event.target);
    };
    const move = (event: PointerEvent) => {
      if (drag.current.kind === "touch" || !drag.current.on || event.pointerId !== drag.current.pointer) return;
      const dx = event.clientX - drag.current.origin;
      const dy = event.clientY - drag.current.originY;
      if (!claim(dx, dy)) return;
      if (event.cancelable) event.preventDefault();
      apply(event.clientX);
    };
    const up = (event: PointerEvent) => {
      if (drag.current.kind === "touch" || event.pointerId !== drag.current.pointer) return;
      finish();
    };
    const touchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      begin(touch.clientX, touch.clientY, touch.identifier, "touch", event.target);
    };
    const touchMove = (event: TouchEvent) => {
      if (!drag.current.on || drag.current.kind !== "touch") return;
      const touch = [...event.touches].find((item) => item.identifier === drag.current.pointer);
      if (!touch) return;
      const dx = touch.clientX - drag.current.origin;
      const dy = touch.clientY - drag.current.originY;
      if (!claim(dx, dy)) return;
      event.preventDefault();
      apply(touch.clientX);
    };
    const touchEnd = (event: TouchEvent) => {
      if (drag.current.kind !== "touch") return;
      const touch = [...event.changedTouches].find((item) => item.identifier === drag.current.pointer);
      if (!touch) return;
      finish();
    };
    const swallow = (event: Event) => {
      if (drag.current.moved >= 12) {
        event.preventDefault();
        event.stopPropagation();
        drag.current.moved = 0;
        return;
      }
      if (openedRef.current) return;
      const hit = event.target instanceof Element ? event.target : null;
      if (hit?.closest("a, button, input, textarea, select, label")) return;
      event.preventDefault();
      event.stopPropagation();
      setOpened(true);
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("touchstart", touchStart, { passive: true });
    node.addEventListener("touchmove", touchMove, { passive: false });
    node.addEventListener("touchend", touchEnd);
    node.addEventListener("touchcancel", touchEnd);
    node.addEventListener("click", swallow, true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("touchstart", touchStart);
      node.removeEventListener("touchmove", touchMove);
      node.removeEventListener("touchend", touchEnd);
      node.removeEventListener("touchcancel", touchEnd);
      node.removeEventListener("click", swallow, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // The listeners read the latest posts through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const asked = useRef(-1);
  useEffect(() => {
    if (!hasMore || paging) return;
    if (posts.length > 1 && focus > posts.length - 2 && asked.current !== posts.length) {
      asked.current = posts.length;
      onOlder();
    }
  }, [focus, hasMore, paging, posts.length, onOlder]);

  const chosen = posts[Math.min(posts.length - 1, Math.max(0, Math.round(focus)))];

  return (
    <div>
      <div ref={ring} className="post-ring">
        <div ref={scene} className="post-ring-scene">
          {posts.map((post, index) => {
            const delta = index - focus;
            if (Math.abs(delta) > 1.35) return null;
            const front = Math.abs(delta) < 0.55;
            const tilt = Math.max(-5, Math.min(5, -delta * 4));
            return (
              <div
                key={post.id}
                className="post-ring-item"
                style={{
                  transform: `translate3d(${delta * 70}%, 0, 0) rotateY(${tilt}deg)`,
                  zIndex: front ? 3 : 1,
                  pointerEvents: front ? "auto" : "none",
                  ["--shine" as string]: `${48 - delta * 18}%`,
                }}
              >
                <div className="post-peruse-fit">
                  <div className="post-ring-card">
                    <PostCard post={post} userId={userId} seed={seed} onChange={onChange} compact />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {paging ? <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-sm text-muted">Loading…</p> : null}
      </div>
      {opened && chosen && typeof document !== "undefined"
        ? createPortal(
            <div className="post-open-sheet">
              <div className="post-open-fit">
                <div className="post-ring-card">
                  <PostCard post={chosen} userId={userId} seed={seed} onChange={onChange} />
                </div>
              </div>
              <button type="button" className="post-back" onClick={() => setOpened(false)}>
                BACK
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function FeedView({
  filter,
  onMeta,
}: {
  filter: FeedFilter;
  onMeta: (meta: { peopleCount: number; me: Profile | null }) => void;
}) {
  const user = useCurrentUser();
  const [posts, setPosts] = useState<Post[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tick, setTick] = useState(0);
  const [paging, setPaging] = useState(false);
  const [mineOn, setMineOn] = useState(false);

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const generation = useRef(0);
  const prevFilter = useRef(filter);
  const hasPosts = useRef(false);
  // No data: Home shows the posts kept on this phone (up to 50).
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up = () => {
      setOffline(false);
      setTick((value) => value + 1);
    };
    const down = () => setOffline(true);
    if (navigator.onLine === false) setOffline(true);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useLayoutEffect(() => {
    const cached = readFeed(filter, mineOn);
    if (!cached) return;
    hasPosts.current = cached.posts.length > 0;
    setPosts(cached.posts);
    setHasMore(cached.hasMore);
    setStatus("ready");
  }, [filter, mineOn]);

  useEffect(() => {
    setMineOn(window.localStorage.getItem("porch-mine") === "1");
  }, []);

  useEffect(() => {
    if (!userId) return;
    const requestId = ++generation.current;
    const filterChanged = prevFilter.current !== filter;
    prevFilter.current = filter;
    if (filterChanged) {
      const cached = readFeed(filter, mineOn);
      setPosts(cached?.posts ?? []);
      setHasMore(cached?.hasMore ?? false);
      hasPosts.current = Boolean(cached?.posts.length);
    }
    let cancel = false;
    if (!hasPosts.current) setStatus("loading");
    getFeed({
      data: { filter, before: null, mine: mineOn, displayName, email, imageUrl },
    })
      .then((page) => {
        if (cancel || requestId !== generation.current) return;
        hasPosts.current = page.posts.length > 0;
        setOffline(false);
        saveFeed(filter, mineOn, page.posts, page.hasMore);
        setPosts(page.posts);
        setHasMore(page.hasMore);
        onMetaRef.current({ peopleCount: page.peopleCount, me: page.me });
        setStatus("ready");
      })
      .catch(() => {
        if (cancel || requestId !== generation.current) return;
        if (navigator.onLine === false) setOffline(true);
        if (!hasPosts.current) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [userId, displayName, email, imageUrl, filter, tick, mineOn]);

  async function loadOlder() {
    const last = posts.at(-1);
    if (!last || paging) return;
    setPaging(true);
    try {
      const page = await getFeed({
        data: { filter, before: last.createdAt, mine: mineOn, displayName, email, imageUrl },
      });
      setPosts((current) => {
        const next = [...current, ...page.posts];
        saveFeed(filter, mineOn, next.slice(0, 50), page.hasMore || next.length > 50);
        return next;
      });
      setHasMore(page.hasMore);
    } catch {
      // No data: keep what's showing (the posts on this phone).
      if (navigator.onLine === false) setOffline(true);
      else setStatus("error");
    } finally {
      setPaging(false);
    }
  }

  const refresh = () => setTick((value) => value + 1);

  return (
    <div className="pb-feed relative z-10 flex flex-col gap-3">
      <Composer
        filter={filter}
        mineOn={mineOn}
        seed={{ displayName, email, imageUrl }}
        onPosted={refresh}
        onToggleMine={() => {
          setMineOn((on) => {
            const next = !on;
            window.localStorage.setItem("porch-mine", next ? "1" : "0");
            return next;
          });
        }}
      />
      <div className="pb-chips" role="group" aria-label="Rooms">
        {(["all", ...ROOMS] as FeedFilter[]).map((item) => (
          <Link
            key={item}
            to="/"
            search={{ room: item } as never}
            aria-current={filter === item ? "true" : undefined}
            className={`pb-chip${filter === item ? " is-on" : ""}`}
          >
            {item === "all" ? null : <PbIcon name={ROOM_ICON[item]} size={15} />}
            {item === "all" ? "All" : ROOM_META[item].label}
          </Link>
        ))}
        <button
          type="button"
          aria-pressed={mineOn}
          className={`pb-chip${mineOn ? " is-on" : ""}`}
          onClick={() => {
            setMineOn((on) => {
              const next = !on;
              window.localStorage.setItem("porch-mine", next ? "1" : "0");
              return next;
            });
          }}
        >
          <PbIcon name="person" size={15} />
          Mine
        </button>
      </div>
      {offline && posts.length ? (
        <p className="feed-offline" role="status">
          📴 No data: showing the posts saved on this phone. Posting, reactions and comments wait for data.
        </p>
      ) : null}
      {status === "error" ? (
        <div className="pb-card pointer-events-auto p-5">
          <p className="font-medium text-ink">{offline ? "No data, and no posts are saved on this phone yet." : "The feed didn't load."}</p>
          <button type="button" className={`${quietButtonClass} mt-2`} onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}
      {status === "ready" && posts.length === 0 ? (
        <div className="pb-card pointer-events-auto px-5 py-10 text-center">
          {/* Stage 4e: the Porchbook circle of people (no longer a speaker's photo, which every new church would see). */}
          <span className="mx-auto mb-4 flex justify-center" style={{ color: "var(--pb-main)" }}>
            <BrandLogo kind="mark" height={88} />
          </span>
          <h2 className="font-display text-2xl text-ink">Porchbook is quiet</h2>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            {filter === "all"
              ? "Inspire them, inform them, or inquire."
              : `Nothing in ${FILTER_META[filter].label} yet. Be the first.`}
          </p>
        </div>
      ) : null}
      {posts.length && mineOn ? (
        <PostRing
          key={`${filter}-mine`}
          posts={posts}
          userId={userId}
          seed={{ displayName, email, imageUrl }}
          onChange={refresh}
          hasMore={hasMore}
          paging={paging}
          onOlder={() => void loadOlder()}
        />
      ) : null}
      {posts.length && !mineOn ? (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} userId={userId} seed={{ displayName, email, imageUrl }} onChange={refresh} />
            </li>
          ))}
        </ul>
      ) : null}
      {!mineOn && hasMore ? (
        <button type="button" className="pb-btn2 pointer-events-auto w-full" onClick={() => void loadOlder()} disabled={paging}>
          {paging ? "Loading…" : "Older posts"}
        </button>
      ) : null}
    </div>
  );
}

function photoMark(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  if (!pen) return "";
  pen.drawImage(img, 0, 0, 9, 8);
  const data = pen.getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const a = data[left] * 0.3 + data[left + 1] * 0.59 + data[left + 2] * 0.11;
      const b = data[right] * 0.3 + data[right + 1] * 0.59 + data[right + 2] * 0.11;
      bits += a > b ? "1" : "0";
    }
  }
  let hex = "";
  for (let index = 0; index < 64; index += 4) hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

function encodePhoto(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const edge = Math.max(img.width, img.height);
  const scale = Math.min(1, maxEdge / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const pen = canvas.getContext("2d");
  if (!pen) return "";
  pen.drawImage(img, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", quality);
}

function shrinkPhoto(file: File): Promise<{ data: string; hash: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const hash = photoMark(img);
      if (hash.length !== 16) {
        resolve(null);
        return;
      }
      const tries: [number, number][] = [
        [4096, 0.92],
        [4096, 0.86],
        [3200, 0.9],
        [2400, 0.88],
        [1600, 0.86],
      ];
      for (const [edge, quality] of tries) {
        const data = encodePhoto(img, edge, quality);
        const raw = data.slice(data.indexOf(",") + 1);
        if (data.startsWith("data:image/") && raw.length < 2_800_000) {
          resolve({ data, hash });
          return;
        }
      }
      resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function Composer({
  filter,
  mineOn,
  seed,
  onPosted,
  onToggleMine,
}: {
  filter: FeedFilter;
  mineOn: boolean;
  seed: Seed;
  onPosted: () => void;
  onToggleMine: () => void;
}) {
  const [room, setRoom] = useState<Room>(filter === "all" ? "proclaim" : filter);
  const [body, setBody] = useState("");
  const [typingHere, setTypingHere] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [founder, setFounder] = useState(false);
  const [photo, setPhoto] = useState("");
  const [photoHash, setPhotoHash] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [askTo, setAskTo] = useState<{ id: string; name: string } | null>(null);
  // The post box is one line until tapped (approved for the redesign, CHANGES.md).
  const [open, setOpen] = useState(false);
  // The logo's butterfly comes down to rest on the box while someone writes, and goes home when they post.
  const postBox = useRef<HTMLDivElement>(null);
  const writing = Boolean(body.trim());
  useEffect(() => {
    if (writing) flyToBox(postBox.current);
    else flyHome();
  }, [writing]);
  useEffect(() => () => flyHome(), []);

  useEffect(() => {
    if (filter !== "all") setRoom(filter);
  }, [filter]);

  useEffect(() => {
    let cancel = false;
    founderDesk({ data: seed })
      .then((result) => {
        if (!cancel) setFounder(result.isFounder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [seed.displayName, seed.email, seed.imageUrl]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() && !photo) {
      if (founder) toggleFounderDesk();
      return;
    }
    event.preventDefault();
    setError("");
    setPending(true);
    const result = await createPost({
      data: {
        room,
        body,
        photo: photo ? photo.slice(photo.indexOf(",") + 1) : "",
        photoMime: photo.startsWith("data:image/webp") ? "image/webp" : photo ? "image/jpeg" : "",
        photoHash,
        askedTo: room === "ask" ? (askTo?.id ?? "") : "",
        ...seed,
      },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAskTo(null);
    setBody("");
    setPhoto("");
    setPhotoHash("");
    setOpen(false);
    onPosted();
  }

  if (!open && !body && !photo) {
    return (
      <>
        <ManualCard />
        <button
          type="button"
          className="pb-card pb-share pointer-events-auto"
          onClick={() => {
            setOpen(true);
            window.setTimeout(() => document.getElementById("composer")?.focus(), 40);
          }}
        >
          <PbAvatar name={seed.displayName || "You"} imageUrl={seed.imageUrl} size={36} />
          <span>Share with your porch…</span>
          <span style={{ color: "var(--pb-second)", display: "flex" }}>
            <PbIcon name="photo" size={20} />
          </span>
        </button>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} className="pb-card pb-compose pointer-events-auto">
      <ManualCard />
      <div ref={postBox} className="relative">
        <RestingFly />
        <textarea
          id="composer"
          value={body}
          onFocus={() => setTypingHere(true)}
          onBlur={() => setTypingHere(false)}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder={`Share with your porch… (${ROOM_META[room].label})`}
          aria-label={`Write a post (${ROOM_META[room].label})`}
          className={typingHere ? "is-typing" : undefined}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>
      <div className="pb-chips" role="group" aria-label="Room">
        {ROOMS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={room === item}
            onClick={() => setRoom(item)}
            className={`pb-chip${room === item ? " is-on" : ""}`}
          >
            <PbIcon name={ROOM_ICON[item]} size={15} />
            {ROOM_META[item].label}
          </button>
        ))}
      </div>
      {room === "ask" ? <AskSomeone seed={seed} chosen={askTo} onChoose={setAskTo} /> : null}
      {photo ? (
        <div>
          <img src={photo} alt="" className="w-full rounded-2xl" />
          <button type="button" className="pb-link" onClick={() => { setPhoto(""); setPhotoHash(""); }}>
            Remove photo
          </button>
        </div>
      ) : null}
      <div className="pb-compose-keys">
        <label className={`pb-chip${photo ? " is-on" : ""}`}>
          <PbIcon name="photo" size={15} />
          Photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setPhotoError("");
              void shrinkPhoto(file).then((next) => {
                if (!next) {
                  setPhotoError("Use a smaller photo.");
                  return;
                }
                setPhoto(next.data);
                setPhotoHash(next.hash);
              });
            }}
          />
        </label>
        <RhemaChip near className="pb-chip pd-rhema" />
        <span className="pb-spacer" />
        <button
          type="button"
          className="pb-link"
          onClick={() => {
            setOpen(false);
            setBody("");
            setPhoto("");
            setPhotoHash("");
            setError("");
          }}
        >
          Cancel
        </button>
        <button type="submit" className="pb-btn" style={{ minHeight: 44 }} disabled={pending || (!body.trim() && !photo && !founder)}>
          {pending ? "…" : "Post"}
        </button>
      </div>
      {photoError ? <p className="text-sm text-danger">{photoError}</p> : null}
      <Fault text={error} />
    </form>
  );
}

/** Inquire: optionally ask one person; only they answer until they do. */
function AskSomeone({ seed, chosen, onChoose }: { seed: Seed; chosen: { id: string; name: string } | null; onChoose: (next: { id: string; name: string } | null) => void }) {
  const self = useCurrentUser();
  const [people, setPeople] = useState<{ userId: string; displayName: string; imageUrl: string | null }[] | null>(null);
  const [query, setQuery] = useState("");
  const hAsk = useWord("ask.someone-hint", "Ask someone (optional): type a name");
  useEffect(() => {
    if (people || !query.trim()) return;
    listPeople({ data: seed })
      .then((list) => setPeople(list.people.map((p) => ({ userId: p.userId, displayName: p.displayName, imageUrl: p.imageUrl ?? null }))))
      .catch(() => setPeople([]));
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  if (chosen) {
    return (
      <p className="ask-chosen">
        <span>
          <W k="ask.asking" vars={{ name: chosen.name }}>{"Asking {name}. Only they can answer until they do."}</W>
        </span>
        <button type="button" onClick={() => onChoose(null)}>
          ✕
        </button>
      </p>
    );
  }
  const needle = query.trim().toLowerCase();
  const found = needle ? (people ?? []).filter((p) => p.userId !== self?.id && p.displayName.toLowerCase().includes(needle)).slice(0, 6) : [];
  return (
    <div className="ask-pick">
      <input className={fieldClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={hAsk} />
      <WHint k="ask.someone-hint">Ask someone (optional): type a name</WHint>
      {found.map((p) => (
        <button
          key={p.userId}
          type="button"
          onClick={() => {
            onChoose({ id: p.userId, name: p.displayName });
            setQuery("");
          }}
        >
          <Avatar name={p.displayName} imageUrl={p.imageUrl} size="sm" />
          <span>{p.displayName}</span>
        </button>
      ))}
    </div>
  );
}

export function PostCard({
  post,
  userId,
  seed,
  onChange,
  compact = false,
}: {
  post: Post;
  userId: string;
  seed: Seed;
  onChange: () => void;
  compact?: boolean;
}) {
  const mine = post.authorId === userId;
  const owner = post.askedTo?.id === userId;
  const waiting = Boolean(post.askedTo) && !post.answered;
  const closedToMe = waiting && !owner;
  const answer = post.askedTo && post.answered ? post.comments.find((c) => c.authorId === post.askedTo?.id) : undefined;
  const others = answer ? post.comments.filter((c) => c.id !== answer.id) : post.comments;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [room, setRoom] = useState<Room>(post.room);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pin, Edit, Lock and Remove live in a small "⋯" menu so the feed stays calm (Stage 4b).
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuBox.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const replyRef = useRef<HTMLInputElement>(null);
  const [shattered, setShattered] = useState(false);
  const shatterTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(shatterTimer.current), []);

  function openReply() {
    setDetails(true);
    window.setTimeout(() => replyRef.current?.focus(), 0);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await updatePost({ data: { id: post.id, body, room } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    onChange();
  }

  async function pin() {
    setBusy(true);
    const result = await pinPost({ data: { id: post.id } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange();
  }

  async function remove() {
    setBusy(true);
    const result = await deletePost({ data: { id: post.id } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange();
  }

  const [sending, setSending] = useState<{ key: number; body: string }[]>([]);
  // Once the feed has a sent reply, its "Sending…" copy goes.
  useEffect(() => {
    if (!sending.length) return;
    setSending((list) => list.filter((item) => !post.comments.some((c) => c.authorId === userId && c.body.trim() === item.body)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.comments]);

  async function react(kind: ReactionKind) {
    playDropSound();
    const result = await setReaction({ data: { postId: post.id, kind, ...seed } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange();
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!text || busy) return;
    // The reply shows straight away (marked "Sending…") and the box is free again; the feed catches up after.
    const key = Date.now();
    setSending((list) => [...list, { key, body: text }]);
    setReply("");
    setDetails(true);
    setError("");
    setBusy(true);
    try {
      const result = await addComment({ data: { postId: post.id, body: text, ...seed } });
      if (!result.ok) {
        setSending((list) => list.filter((item) => item.key !== key));
        setReply(text);
        setError(result.error);
        return;
      }
      onChange();
    } catch {
      setSending((list) => list.filter((item) => item.key !== key));
      setReply(text);
      setError("Your reply didn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const meta = [post.authorRole, post.authorTeam].filter(Boolean).join(" · ");

  if (shattered) {
    return (
      <div className="post-gone pointer-events-auto" role="status">
        <span>Post shattered.</span>
        <button
          type="button"
          onClick={() => {
            window.clearTimeout(shatterTimer.current);
            setShattered(false);
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <PostWindow
      className="pb-card pb-post pointer-events-auto"
      shatter={editing ? undefined : mine ? "delete" : "fun"}
      onShattered={() => {
        setShattered(true);
        // 5 seconds to undo, then it's really deleted.
        shatterTimer.current = window.setTimeout(() => {
          void deletePost({ data: { id: post.id } })
            .then((result) => {
              if (result.ok) onChange();
              else {
                setShattered(false);
                setError(result.error);
              }
            })
            .catch(() => setShattered(false));
        }, 5000);
      }}
    >
      <header className="pb-post-head">
        <Link to="/people/$userId" params={{ userId: post.authorId }} aria-label={`${post.authorName}'s page`}>
          <PbAvatar id={post.authorId} name={post.authorName} imageUrl={post.authorImage} />
        </Link>
        <Link to="/people/$userId" params={{ userId: post.authorId }} className="pb-post-who">
          <b>{post.authorName}</b>
          <small>
            <span className={`pb-room-${post.room}`}>{ROOM_META[post.room].label}</span>
            {meta ? ` · ${meta}` : ""}
            {" · "}
            <time dateTime={post.createdAt}>{formatWhen(post.createdAt)}</time>
            {post.editedAt ? " · edited" : ""}
            {post.pinned ? " · pinned" : ""}
          </small>
        </Link>
        {!mine ? (
          <>
            <CallLink userId={post.authorId} name={post.authorName} className="pb-iconbtn is-green" />
            <Link to="/messages/$userId" params={{ userId: post.authorId }} aria-label={`Message ${post.authorName}`} className="pb-iconbtn">
              <PbIcon name="chat" size={18} />
            </Link>
          </>
        ) : null}
        {mine && !editing ? (
          <div ref={menuBox} className="pb-menu-wrap">
            <button type="button" className="pb-iconbtn" aria-label="More for this post" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>⋯</span>
            </button>
            {menu ? (
              <div className="pb-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenu(false); void pin(); }} disabled={busy}>
                  {post.pinned ? "Unpin" : "Pin"}
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>
                  Edit
                </button>
                <LockButton postId={post.id} locked={post.locked} onChange={onChange} onError={setError} className="pb-menu-lock" />
                {confirming ? (
                  <button type="button" role="menuitem" className="text-danger" onClick={() => { setMenu(false); void remove(); }} disabled={busy}>
                    Delete for good
                  </button>
                ) : (
                  <button type="button" role="menuitem" onClick={() => setConfirming(true)}>
                    Remove
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      {editing ? (
        <form onSubmit={save} className="grid gap-3">
          <textarea
            className={`${fieldClass} min-h-24 !text-post`}
            value={body}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="pb-chips">
            {ROOMS.map((item) => (
              <button key={item} type="button" onClick={() => setRoom(item)} className={`pb-chip${room === item ? " is-on" : ""}`}>
                <PbIcon name={ROOM_ICON[item]} size={15} />
                {ROOM_META[item].label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="pb-btn" disabled={busy || !body.trim()}>
              Save
            </button>
            <button
              type="button"
              className="pb-btn2"
              onClick={() => {
                setEditing(false);
                setBody(post.body);
                setRoom(post.room);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="cursor-pointer" onClick={() => setDetails((open) => !open)}>
          <PostBody text={post.body.trim()} green={post.room === "ask"} />
          {post.photo ? <KeptPhoto src={post.photo} compact={compact} title={post.authorName} /> : null}
          {post.sharedPublicPostId ? (
            <Link
              to="/public/$postId"
              params={{ postId: String(post.sharedPublicPostId) }}
              className="pp-shared-link"
              onClick={(event) => event.stopPropagation()}
            >
              Open on the public porch →
            </Link>
          ) : null}
        </div>
      )}
      {post.askedTo ? (
        <p className="ask-to">
          <W k="ask.asked-to" vars={{ name: owner ? "you" : post.askedTo.name }}>{"Asked to: {name}"}</W>
          {waiting ? <span> · {owner ? <W k="ask.awaited">Your answer is awaited</W> : <W k="ask.waiting" vars={{ name: post.askedTo.name }}>{"Waiting for {name}'s answer"}</W>}</span> : null}
        </p>
      ) : null}
      {answer ? (
        <div className="ask-answer">
          <p className="ask-answer-head"><W k="ask.answer-from" vars={{ name: post.askedTo?.name ?? "" }}>{"Answer from {name}"}</W></p>
          <ul>
            <CommentRow
              comment={answer}
              canRemove={answer.authorId === userId}
              selfId={userId}
              seed={seed}
              onReply={openReply}
              locked={post.locked}
              onChange={onChange}
              onError={setError}
            />
          </ul>
        </div>
      ) : null}
      {closedToMe ? null : (
        <div className="pb-reacts">
          {REACTIONS.map((kind, index) => {
            const summary = post.reactions.find((item) => item.kind === kind);
            const count = summary?.count ?? 0;
            const active = summary?.mine ?? false;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                aria-label={`${REACTION_META[kind].label}${count ? `, ${count}` : ""}`}
                onClick={() => react(kind)}
                className={`pb-react${active ? " is-on" : ""}`}
              >
                {index === 0 ? <PbIcon name="heart" size={16} /> : null}
                {REACTION_META[kind].label}
                {count > 0 ? <span className="tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      {post.noticedCount > 0 ? (
        <p className="text-sm text-muted">
          {noticedLine(
            post.noticed,
            post.noticedCount,
            seed.displayName,
            post.reactions.some((item) => item.mine),
          )}
        </p>
      ) : null}
      {details && (others.length > 0 || sending.length > 0) ? (
        <ul className="space-y-3 border-t border-line pt-3">
          {others.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              canRemove={comment.authorId === userId || mine}
              selfId={userId}
              seed={seed}
              onReply={openReply}
              locked={post.locked}
              onChange={onChange}
              onError={setError}
            />
          ))}
          {sending.map((item) => (
            <li key={item.key} className="flex gap-3 opacity-70">
              <Avatar name={seed.displayName || "You"} imageUrl={seed.imageUrl} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {seed.displayName || "You"} <span className="font-normal text-muted">· Sending…</span>
                </p>
                <p className="text-sm text-post whitespace-pre-wrap">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pb-post-actions">
        {post.locked || closedToMe ? null : (
          <button type="button" className="pb-link" onClick={openReply}>
            {waiting && owner ? "Answer" : `Reply${others.length > 0 ? ` · ${others.length}` : ""}`}
          </button>
        )}
        {post.locked ? <span className="pb-link">Locked</span> : null}
      </div>
      {details && !post.locked && !closedToMe ? (
        <form onSubmit={sendReply} className="flex gap-2">
          <label className="sr-only" htmlFor={`reply-${post.id}`}>
            Reply
          </label>
          <input
            ref={replyRef}
            id={`reply-${post.id}`}
            className={`${fieldClass} min-w-0 flex-1 !text-post`}
            value={reply}
            maxLength={800}
            placeholder={waiting && owner ? "Write your answer" : "Write a reply"}
            onChange={(event) => setReply(event.target.value)}
          />
          <button type="submit" className="pb-btn shrink-0" style={{ minHeight: 44 }} disabled={busy || !reply.trim()}>
            {busy ? "…" : "Reply"}
          </button>
        </form>
      ) : null}
      <Fault text={error} />
    </PostWindow>
  );
}

function CommentRow({
  comment,
  canRemove,
  selfId,
  seed,
  onReply,
  locked,
  onChange,
  onError,
}: {
  comment: Post["comments"][number];
  canRemove: boolean;
  selfId: string;
  seed: Seed;
  onReply: () => void;
  locked: boolean;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const mine = comment.authorId === selfId;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);

  useEffect(() => {
    setBody(comment.body);
  }, [comment.body]);

  async function remove() {
    setBusy(true);
    const result = await deleteComment({ data: { id: comment.id } });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onChange();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await updateComment({ data: { id: comment.id, body } });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setEditing(false);
    onChange();
  }

  async function react(kind: ReactionKind) {
    playDropSound();
    const result = await setCommentReaction({ data: { commentId: comment.id, kind, ...seed } });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onChange();
  }

  return (
    <li className="flex gap-3">
      <Link to="/people/$userId" params={{ userId: comment.authorId }} className="shrink-0">
        <Avatar name={comment.authorName} imageUrl={comment.authorImage} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <Link
            to="/people/$userId"
            params={{ userId: comment.authorId }}
            className="font-semibold text-ink hover:underline"
          >
            {comment.authorName}
          </Link>
          {comment.authorId !== selfId ? (
            <CallLink
              userId={comment.authorId}
              name={comment.authorName}
              className="ml-1 inline-grid size-7 place-items-center align-middle text-pine"
            />
          ) : null}{" "}
          <time className="text-muted" dateTime={comment.createdAt}>
            {formatWhen(comment.createdAt)}
          </time>
          {comment.editedAt ? <span className="text-muted"> · edited</span> : null}
        </p>
        {editing ? (
          <form onSubmit={save} className="mt-2 grid gap-2">
            <textarea
              className={`${fieldClass} min-h-20 !text-post`}
              value={body}
              maxLength={800}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" className={primaryButtonClass} disabled={busy || !body.trim()}>
                Save
              </button>
              <button
                type="button"
                className={quietButtonClass}
                onClick={() => {
                  setEditing(false);
                  setBody(comment.body);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <LinkText text={comment.body} className="text-sm text-post" />
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {REACTIONS.map((kind) => {
            const summary = comment.reactions.find((item) => item.kind === kind);
            const Icon = ICONS[kind];
            const count = summary?.count ?? 0;
            const active = summary?.mine ?? false;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                aria-label={REACTION_META[kind].label}
                onClick={() => react(kind)}
                className={`inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-sm font-medium ${
                  active ? "bg-pine-soft text-pine" : "text-muted hover:bg-line hover:text-ink"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {REACTION_META[kind].label}
                {count > 0 ? <span className="tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap">
          {locked ? null : (
            <button type="button" className={`${quietButtonClass} px-2`} onClick={onReply}>
              Reply
            </button>
          )}
          {mine && !editing ? (
            <button type="button" className={`${quietButtonClass} px-2`} onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
          {canRemove ? (
            <button type="button" className={`${quietButtonClass} px-2`} onClick={remove} disabled={busy}>
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function PostBody({ text, green = false }: { text: string; green?: boolean }) {
  const long = text.length > 320 || text.split("\n").length > 8;
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <LinkText text={text} className={`text-base ${green ? "text-muted" : "text-post"} ${long && !open ? "line-clamp-6" : ""}`} />
      {long && !open ? (
        <button type="button" className="mt-1 min-h-11 text-sm font-medium text-muted" onClick={() => setOpen(true)}>
          Keep reading
        </button>
      ) : null}
    </div>
  );
}

function LockButton({
  postId,
  locked,
  onChange,
  onError,
  className,
}: {
  postId: number;
  locked: boolean;
  onChange: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const [on, setOn] = useState(locked);
  const [busy, setBusy] = useState(false);

  useEffect(() => setOn(locked), [locked]);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    const result = await toggleLock({ data: { postId } });
    setBusy(false);
    if (!result.ok) {
      setOn(!next);
      onError(result.error);
      return;
    }
    onChange();
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      role={className ? "menuitem" : undefined}
      className={className ?? `${quietButtonClass} mt-1 px-0 ${on ? "text-pine" : ""}`}
      onClick={toggle}
      disabled={busy}
    >
      {className ? (on ? "Unlock replies" : "Lock replies") : on ? "Locked" : "Lock"}
    </button>
  );
}

function noticedLine(names: string[], total: number, you: string, mine: boolean): string {
  const mineName = you.trim();
  const others = names.filter((name) => name && name !== mineName);
  const ordered = mine ? ["You", ...others] : names.filter(Boolean);
  const shown = ordered.slice(0, 3);
  const more = Math.max(0, total - shown.length);
  const parts = more > 0 ? [...shown, `${more} ${more === 1 ? "other" : "others"}`] : shown;
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}
