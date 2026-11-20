import { AskNews, RideNews } from "@/components/porch/transport-team";
import { ThemesSheet } from "@/components/porch/themes";
import { playButtonSound } from "@/lib/porch/button-sound-play";
import { RadioNews } from "@/components/porch/radio-news";
import { shown as featureShown } from "@/lib/porch/on-hold";
import { EditWordsButton, W, WordsEditor } from "@/components/porch/words";
import { capturePlace, finishRestore, keepForReload, keepInMemory, onCall, placeToRestore, restoreDrafts, scroller } from "@/lib/porch/place";
import { guardStart, toast, useBackLayer } from "@/lib/porch/back-stack";
import { KeepRunning, OPEN_KEEP, inPorchApp } from "@/components/porch/keep-running";
import { AppUpdateCard, checkForAppUpdate } from "@/components/porch/app-update";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { warmDevotion } from "@/lib/porch/devotion-cache";
import { LiteKey, LiteOffer } from "@/components/porch/lite-bits";
import { NoteBell } from "@/components/porch/note-bell";
import { WelcomeScreen } from "@/components/porch/welcome-screen";
import { BottomNav, PbIcon, TopBar, usePorchLook } from "@/components/porch/pb-shell";
import { NuggetLink } from "@/components/porch/nugget-bits";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleHelp, House, Landmark, Mail, Megaphone, MessageCircle, Share2, Users, Bell, AudioLines, RefreshCw, Eye, EyeOff, Palette } from "lucide-react";
import { HomeTourSwitch, ThemePlate, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { ButtonSoundSetter, useButtonSound } from "@/components/porch/button-sound";
import { MessageSoundSetter } from "@/components/porch/message-sound";
import { CallLookSetter, HeaderPhotoSetter, useHeaderPhoto } from "@/components/porch/header-photo";
import { LegacyImportSetter } from "@/components/porch/legacy-import";
import { PcSide } from "@/components/porch/pc-side";
import { useMyFace } from "@/components/porch/face-picker";
import { OnlineTicker, PresenceChoice, PresenceInvite } from "@/components/porch/porch-online";
import { LogoFlyer, useLogoAway } from "@/components/porch/logo-fly";
import { isDoNotDisturb, startPresence } from "@/lib/porch/presence-store";
import { CallCard, useGlassCalls } from "@/components/porch/call-card";
import { CreditWarningStrip } from "@/components/porch/credit-warning";
import { WelcomePhone } from "@/components/porch/welcome-phone";
import { updateIfReady, watchForUpdates } from "@/lib/porch/app-update";
import { isLite } from "@/lib/porch/lite";
import { radioPlaying, refreshStation, tuneIn, useFm } from "@/lib/porch/fm-player";
import { refreshMessageSound, ringForUnread } from "@/lib/porch/message-sound-play";
import { GroundSetter, useGround } from "@/components/porch/ground";
import { ShelfSetter } from "@/components/porch/shelf";
import { HideSetter } from "@/components/porch/hide";
import { DoorSetter } from "@/components/porch/door";
import { playSignOutSound } from "@/lib/porch/button-sound-play";
import { authClient, GROK_PROVIDERS, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { IncomingCall } from "@/components/porch/call-asks";
import { DigitalClock, RhemaChip, RhemaSetter, RhemaStage, useRhemaPlay } from "@/components/porch/rhema";
import { founderDesk, inboxUnread, sendToAll } from "@/lib/porch/api";
import { porchStanding } from "@/lib/porch/roll";
import { alertPermission, alertsSupported, enableAlerts, keepAlertsCurrent, pushIsArmed } from "@/lib/porch/alerts";
import { INBOX_EVENT } from "@/lib/porch/inbox-events";
import { ClearEvents } from "@/components/porch/city-events";
import { COMPLAINTS_EVENT, Fault, TroubleBar } from "@/components/porch/trouble";
import { claimLine, hangUp, useLine } from "@/lib/porch/line-call";
import { OnAirBar } from "@/components/porch/fm";
import { firebaseReady, watchFirebaseMember } from "@/lib/porch/firebase-call";
import { FILTERS, ROOM_META, ROOMS, type FeedFilter } from "@/lib/porch/model";

export function Welcome() {
  // Stage 5a: the Welcome screen from design-reference/Main.dc.html (join with an invite code,
  // start a porch, or sign in). The earlier phone-on-the-block welcome (WelcomePhone) is kept, unused.
  return <WelcomeScreen account={(mode, note) => <AuthCard key={mode} startMode={mode} note={note} />} />;
}

/** The phone-on-the-block welcome used before Stage 5a (kept for reference). */
export function WelcomeOnTheBlock() {
  return <WelcomePhone form={(mode) => <AuthCard key={mode} startMode={mode} />} />;
}

/** The earlier welcome page (kept for reference). */
export function WelcomeClassic() {
  return (
    <main className="mx-auto w-full max-w-5xl overflow-y-auto px-5 pt-6 pb-28 lg:px-8">
      <div className="grid items-start gap-8 lg:min-h-[70dvh] lg:grid-cols-2 lg:items-center">
        <section className="welcome-pitch">
          <img src="/logo.png?v=4" alt="Porchbook" className="mb-6 h-28 w-auto sm:h-36" />
          <h1 className="font-display text-4xl leading-tight tracking-tight text-ink sm:text-5xl">
            Welcome to Porchbook.
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted">
            A community of communion with other believers in the Lord Jesus Christ. Welcome to the world of God's Word.
          </p>
          <p className="mt-8 text-ink">Enjoy the following:</p>
          <ul className="mt-3 space-y-3 text-ink">
            <li className="flex items-center gap-3">
              <House className="size-5 text-pine" aria-hidden="true" />
              Inspire, Inform, and Inquire, on one feed
            </li>
            <li className="flex items-center gap-3">
              <Mail className="size-5 text-pine" aria-hidden="true" />
              Private messages between two people
            </li>
            <li className="flex items-center gap-3">
              <Landmark className="size-5 text-pine" aria-hidden="true" />
              Five offices you can write to
            </li>
            <li className="flex items-center gap-3">
              <AudioLines className="size-5 text-pine" aria-hidden="true" />
              Groups, and a call when you need to talk
            </li>
            <li className="flex items-center gap-3">
              <Users className="size-5 text-pine" aria-hidden="true" />
              The people of the porch, in one list
            </li>
          </ul>
        </section>
        <div className="welcome-form">
          <AuthCard />
        </div>
      </div>
      <p className="pt-10 text-center text-sm text-muted">Property of Phaneroo Ministries Mbarara</p>
    </main>
  );
}

export function AuthCard({ startMode = "join", note }: { startMode?: "join" | "enter"; note?: ReactNode }) {
  const [mode, setMode] = useState<"join" | "enter">(startMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("Enter a real email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (mode === "join" && name.trim().length < 2) {
      setError("Add the name your team uses.");
      return;
    }
    setPending(true);
    const result =
      mode === "join"
        ? await authClient.signUp.email({
            name: name.trim(),
            email: cleanEmail,
            password,
          })
        : await authClient.signIn.email({
            email: cleanEmail,
            password,
          });
    if (result.error) {
      setPending(false);
      setError(result.error.message || "That didn't work. Try again.");
      return;
    }
    const session = await authClient.getSession();
    if (!session.data?.user) {
      setPending(false);
      setMode("enter");
      setError("Account created. Sign in with that email.");
    }
  }

  return (
    <div className="rounded-3xl glass-edge bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-2xl text-ink">{mode === "join" ? "Create your account" : "Welcome back"}</h2>
      {note}
      <p className="mt-1 text-sm text-muted">
        {GROK_PROVIDERS.length > 0
          ? "Sign in with work Google, X, or an email just for this team."
          : mode === "join"
            ? "Your email and a password you choose."
            : "Sign in with your email and password."}
      </p>
      {GROK_PROVIDERS.length > 0 && (
      <>
      <div className="mt-5 grid gap-2">
        {GROK_PROVIDERS.map((provider) => (
          <button
            key={provider.providerId}
            type="button"
            onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
            className="min-h-11 rounded-lg glass-edge bg-paper px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-line"
          >
            Continue with {provider.label}
          </button>
        ))}
      </div>
      <div className="my-5 flex items-center gap-3 text-xs font-medium tracking-wide text-faint uppercase">
        <span className="h-px flex-1 bg-line" />
        or email
        <span className="h-px flex-1 bg-line" />
      </div>
      </>
      )}
      {GROK_PROVIDERS.length === 0 && <div className="mt-5" />}
      <form onSubmit={onSubmit} className="grid gap-3">
        {mode === "join" ? (
          <label className="grid gap-1 text-sm font-medium text-ink">
            Name
            <input
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={60}
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm font-medium text-ink">
          Email
          <input
            className={fieldClass}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={200}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-ink">
          Password
          <span className="relative block">
            <input
              className={`${fieldClass} pw-field`}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "join" ? "new-password" : "current-password"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={8}
              maxLength={128}
            />
            <button
              type="button"
              className="pw-eye"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((on) => !on)}
            >
              {showPassword ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
            </button>
          </span>
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} disabled={pending}>
          {pending ? "One moment…" : mode === "join" ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        className="mt-4 block text-sm font-medium text-pine"
        onClick={() => {
          setMode(mode === "join" ? "enter" : "join");
          setError("");
        }}
      >
        {mode === "join" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      <Link to="/privacy" className="mt-1 flex min-h-11 items-center text-sm font-medium text-muted">
        Privacy
      </Link>
    </div>
  );
}

function HeadMeasure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector("header") ?? ref.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty("--porch-head", `calc(${el.offsetHeight}px + var(--radio-strip, 0px))`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{children}</div>;
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-3 py-2 sm:px-4 lg:px-6">
          <HeadLogo />
          <div className="mt-2">
            <HomeTourSwitch side="home" />
          </div>
        </div>
      </header>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Feed", icon: House, match: (path: string) => path === "/" },
  { to: "/messages", label: "Chat", icon: Mail, match: (path: string) => path.startsWith("/messages") },
  { to: "/invite", label: "Invite", icon: Share2, match: (path: string) => path === "/invite" },
] as const;

const ROOM_ICONS = {
  proclaim: Megaphone,
  inform: MessageCircle,
  ask: CircleHelp,
} as const;

function activeRoom(pathname: string, search: unknown): FeedFilter | null {
  if (pathname !== "/") return null;
  if (search && typeof search === "object" && "room" in search) {
    const room = (search as { room?: unknown }).room;
    if (typeof room === "string" && (FILTERS as readonly string[]).includes(room)) {
      return room as FeedFilter;
    }
  }
  return "all";
}

function useUnread(user: AppUser | null, pathname: string) {
  const [unread, setUnread] = useState(0);
  const seen = useRef<number | null>(null);
  // The founder's message sound: played gently for a new message (see message-sound-play).
  const line = useLine();
  const inCall = useRef(false);
  inCall.current = Boolean(line.call);
  const id = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;
  const imageUrl = user?.profileImageUrl ?? null;

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    const load = () => {
      inboxUnread({ data: { displayName, email, imageUrl } })
        .then((result) => {
          if (cancel) return;
          if (
            seen.current !== null &&
            result.unread > seen.current &&
            document.hidden &&
            alertsSupported() &&
            Notification.permission === "granted" &&
            !pushIsArmed()
          ) {
            const notice = new Notification("Porchbook", { body: "New private message" });
            notice.onclick = () => {
              window.focus();
              window.location.assign("/messages");
            };
          }
          // Ring for unread messages: on opening and for new ones, 3 times 10 s apart (see message-sound-play).
          ringForUnread(result.unread, { reading: pathname.startsWith("/messages") || isDoNotDisturb(), inCall: inCall.current });
          seen.current = result.unread;
          setUnread(result.unread);
        })
        .catch(() => undefined);
    };
    void refreshMessageSound({ displayName, email, imageUrl }).catch(() => undefined);
    // Say "I'm here" to the porch (who's online), every 30 s while Porchbook is on screen.
    startPresence({ displayName, email, imageUrl }, id);
    // A new sound from the founder reaches open phones within a few minutes.
    const freshen = window.setInterval(() => void refreshMessageSound({ displayName, email, imageUrl }, true).catch(() => undefined), 180_000);
    const timer = window.setTimeout(load, 800);
    const pulse = window.setInterval(load, 5000);
    const onPing = () => load();
    window.addEventListener(INBOX_EVENT, onPing);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      window.clearInterval(pulse);
      window.clearInterval(freshen);
      window.removeEventListener(INBOX_EVENT, onPing);
    };
  }, [id, displayName, email, imageUrl, pathname]);

  return unread;
}

function NameMenu({
  user,
  signingOut,
  onLeave,
}: {
  user: AppUser;
  signingOut: boolean;
  onLeave: () => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<NotificationPermission | "unsupported">("unsupported");
  const [themes, setThemes] = useState(false);
  const [alertNote, setAlertNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const name = user.displayName ?? "You";
  const alertsOn = alerts === "granted";
  const myFace = useMyFace(user.id) ?? user.profileImageUrl ?? null;

  useEffect(() => {
    setAlerts(alertPermission());
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${name}: account menu`}
        className="porch-avatar no-sink"
        onClick={() => setOpen((value) => !value)}
      >
        {myFace ? (
          <img src={myFace} alt="" />
        ) : (
          <span aria-hidden="true">
            {name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0).toUpperCase())
              .join("") || "?"}
          </span>
        )}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+0.35rem)] z-40 w-56 rounded-md border border-line bg-paper py-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
          <Link
            to="/people/$userId"
            params={{ userId: user.id }}
            role="menuitem"
            className="block min-h-11 px-3 py-2 text-left text-sm font-semibold text-ink"
            onClick={() => setOpen(false)}
          >
            Your page
          </Link>
          {alerts === "unsupported" ? null : (
            <button
              type="button"
              role="menuitem"
              className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold ${alertsOn ? "text-pine" : "text-ink"}`}
              onClick={() => {
                setAlertNote("");
                void enableAlerts({
                  displayName: user.displayName ?? "",
                  email: user.primaryEmail ?? null,
                  imageUrl: user.profileImageUrl ?? null,
                }).then((result) => {
                  setAlerts(alertPermission());
                  if (!result.ok) setAlertNote(result.error);
                });
              }}
            >
              <Bell className="size-4 shrink-0" aria-hidden="true" />
              {alertsOn ? "Alerts on" : "Alerts"}
            </button>
          )}
          {alertNote ? <p className="px-3 pb-1 text-xs text-muted">{alertNote}</p> : null}
          {inPorchApp() ? (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink"
              onClick={() => window.dispatchEvent(new Event(OPEN_KEEP))}
            >
              <AudioLines className="size-4 shrink-0" aria-hidden="true" />
              Keep Porchbook running
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent("porch-trouble", { detail: "__choose" }));
            }}
          >
            <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
            Feedback
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink"
            onClick={() => {
              setOpen(false);
              setThemes(true);
            }}
          >
            <span className="size-4 shrink-0 text-center leading-4" aria-hidden="true">◐</span>
            Themes
            <span className="ml-auto text-xs text-muted">buttons, top bar, post box</span>
          </button>
          <PresenceChoice />
          <button
            type="button"
            role="menuitem"
            className="block min-h-11 w-full px-3 py-2 text-left text-sm font-semibold text-ink disabled:opacity-60"
            disabled={signingOut}
            onClick={() => {
              setOpen(false);
              onLeave();
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
      {themes ? <ThemesSheet onClose={() => setThemes(false)} /> : null}
    </div>
  );
}

function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 9 ? "9+" : String(count);
  return (
    <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-pine px-1.5 text-xs font-semibold text-on-pine">
      {label}
    </span>
  );
}

const DESK_EVENT = "porch-founder-desk";
export const REFRESH_EVENT = "porch-refresh-app";

export function toggleFounderDesk() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DESK_EVENT));
}

function FounderDesk({ user, home }: { user: AppUser; home: boolean }) {
  const [isFounder, setIsFounder] = useState(false);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user.displayName ?? "",
    email: user.primaryEmail ?? null,
    imageUrl: user.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user.id) return;
    let cancel = false;
    const load = () => {
      founderDesk({ data: seed })
        .then((result) => {
          if (cancel) return;
          setIsFounder(result.isFounder);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [user.id, seed.displayName, seed.email, seed.imageUrl]);

  useEffect(() => {
    const toggle = () => setShown((value) => !value);
    window.addEventListener(DESK_EVENT, toggle);
    return () => window.removeEventListener(DESK_EVENT, toggle);
  }, []);

  // The founder also gets a warning strip when the AI or the devotional voice runs low.
  const strip = isFounder && featureShown("devotionVoice") ? <CreditWarningStrip /> : null;
  if (!(home && isFounder && shown)) return strip;

  async function send(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await sendToAll({ data: { body, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBody("");
    setOpen(false);
    const fresh = await founderDesk({ data: seed });
    setIsFounder(fresh.isFounder);
  }

  return (
    <section className="rounded-3xl glass-edge bg-card p-4">
      {strip}
      {open ? (
          <form onSubmit={send} className="">
            <label className="grid gap-1 text-sm font-medium text-ink">
              Message everyone
              <textarea
                className={`${fieldClass} min-h-24 !text-post`}
                value={body}
                maxLength={500}
                onChange={(event) => setBody(event.target.value)}
                placeholder="A message for the whole team"
              />
            </label>
            <Fault text={error} />
            <div className="mt-3 flex gap-2">
              <button type="submit" className={primaryButtonClass} disabled={pending || !body.trim()}>
                {pending ? "Sending…" : "Send to everyone"}
              </button>
              <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setOpen(true)}>
            Message everyone
          </button>
        )}
      <Link to="/roll" className={`${quietButtonClass} mt-3 px-0`}>
          The roll
        </Link>
      <ButtonSoundSetter />
      <MessageSoundSetter />
      {/* The old photo and texture settings are hidden (BUILD-BRIEF.md decision 2); a logo and cover photo come later. */}
      {featureShown("oldLooks") ? (
        <>
          <HeaderPhotoSetter />
          <CallLookSetter />
          <GroundSetter />
          <ShelfSetter />
          <HideSetter />
          <DoorSetter />
        </>
      ) : null}
      <LegacyImportSetter />
      <RhemaSetter />
      <ClearEvents />
    </section>
  );
}

export function AppFrame({
  children,
  rail,
}: {
  children: ReactNode;
  rail?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
  const room = activeRoom(pathname, search);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const unread = useUnread(user, pathname);
  const guy = pathname === "/city" || pathname === "/porchguy";
  const rhema = useRhemaPlay();
  // These run on every draw, before any early return (React needs the same order every time).
  const look = usePorchLook();
  const face = useMyFace(user?.id ?? "");
  // Keep today's devotional on the phone so it opens instantly.
  useEffect(() => {
    if (!user?.id) return;
    warmDevotion({ displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While there's data, quietly load the screens that work without it (Read, the Bible, notes),
  // so they open later even with no data. The phone keeps what's loaded.
  const router = useRouter();
  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setTimeout(() => {
      if (navigator.onLine === false) return;
      void import("@/components/porch/notebook-page").catch(() => undefined);
      void import("@/components/porch/bible-reader").catch(() => undefined);
      void import("@/components/porch/library-book").catch(() => undefined);
      void import("@/components/porch/pdf-scroll").catch(() => undefined);
      router.preloadRoute({ to: "/read" }).catch(() => undefined);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useButtonSound();
  useGround();
  useHeaderPhoto();

  // Stay on the newest Porchbook: reload quietly at a calm moment (never during the radio, a call, or typing).
  const frameLine = useLine();
  const busyRef = useRef(false);
  busyRef.current = Boolean(frameLine.call);
  useEffect(() => {
    const canReload = () => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      return !busyRef.current && !radioPlaying() && !typing;
    };
    watchForUpdates(canReload, isLite());
    updateIfReady(canReload);
  }, [pathname]);

  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "PrintScreen") return;
      const cover = document.createElement("div");
      cover.setAttribute("aria-hidden", "true");
      cover.style.cssText = "position:fixed;inset:0;z-index:9999;background:#000";
      document.body.appendChild(cover);
      window.setTimeout(() => cover.remove(), 800);
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("keyup", onKey);
    };
  }, []);

  useEffect(() => {
    // At the very start, Back warns once before leaving Porchbook.
    guardStart();
  }, []);

  // A newer Porchbook is live: a bubble on Refresh (once per version) and a gentle glow until it's tapped.
  const [newBuild, setNewBuild] = useState("");
  const [hiddenBuild, setHiddenBuild] = useState(() => {
    try {
      return localStorage.getItem("porch-build-hidden") ?? "";
    } catch {
      return "";
    }
  });
  function hideBuild(build: string) {
    setHiddenBuild(build);
    try {
      localStorage.setItem("porch-build-hidden", build);
    } catch {
      /* for this visit */
    }
  }
  useEffect(() => {
    let stopped = false;
    async function check() {
      if (document.visibilityState === "hidden") return;
      const live = await fetch(`/api/build?t=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ build?: string }>) : null))
        .catch(() => null);
      if (!stopped && live?.build && live.build !== __PORCH_BUILD__) setNewBuild(live.build);
    }
    const first = window.setTimeout(() => void check(), 20000);
    const timer = window.setInterval(() => void check(), 4 * 60000);
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  // Tour on a phone: scrolling the page up tucks the header away (the radio and panels rise into
  // its space); scrolling back down, or reaching the top, brings it back.
  useEffect(() => {
    const root = document.documentElement;
    if (pathname !== "/next") {
      root.classList.remove("head-tucked");
      return;
    }
    let last = 0;
    let settleUntil = 0;
    const set = (tucked: boolean) => {
      if (root.classList.contains("head-tucked") === tucked) return;
      root.classList.toggle("head-tucked", tucked);
      // The page shifts as the header moves: ignore that shift, it isn't the finger.
      settleUntil = Date.now() + 400;
    };
    const onScroll = (event: Event) => {
      const box = event.target;
      if (!(box instanceof HTMLElement) || !box.matches("main > div.overflow-y-auto, #tour-fill")) return;
      if (window.innerWidth >= 1024) return;
      const top = box.scrollTop;
      const delta = top - last;
      last = top;
      if (Date.now() < settleUntil) return;
      if (top < 24) set(false);
      else if (delta > 6 && top > 60) set(true);
      else if (delta < -14) set(false);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      root.classList.remove("head-tucked");
    };
  }, [pathname]);

  // Refresh keeps your place: in place when nothing new is published, otherwise a reload that puts you back.
  const [refreshKey, setRefreshKey] = useState(0);
  const fmNow = useFm();
  useEffect(() => {
    const place = placeToRestore();
    if (!place) return;
    const timers = [
      window.setTimeout(() => {
        const box = scroller();
        if (box) box.scrollTop = place.scroll;
      }, 900),
      window.setTimeout(() => {
        const box = scroller();
        if (box && Math.abs(box.scrollTop - place.scroll) > 40) box.scrollTop = place.scroll;
        restoreDrafts(place.drafts);
      }, 2200),
      window.setTimeout(finishRestore, 6000),
    ];
    if (place.radio) void tuneIn();
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [refreshKey]);

  async function refreshApp() {
    if (refreshing || signingOut) return;
    // Only a call in progress holds Refresh back (the Calls page itself refreshes like any other).
    if (onCall()) {
      toast("Refresh after your call");
      return;
    }
    setRefreshing(true);
    const radioOn = fmNow.status === "on" || fmNow.status === "tuning";
    const live = await fetch(`/api/build?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ build?: string }>) : null))
      .catch(() => null);
    const newer = Boolean(live?.build && live.build !== __PORCH_BUILD__);
    if (!newer) {
      // Nothing new published: fresh posts, messages and lists right here, nothing closes.
      const offered = await checkForAppUpdate(() => undefined).catch(() => false);
      if (offered) {
        setRefreshing(false);
        return;
      }
      const place = await capturePlace(false);
      keepInMemory(place);
      setRefreshKey((key) => key + 1);
      void refreshStation().catch(() => undefined);
      window.dispatchEvent(new Event("porch-refresh"));
      window.setTimeout(() => setRefreshing(false), 700);
      return;
    }
    keepForReload(await capturePlace(radioOn));
    const go = () => {
      const url = new URL(window.location.href);
      url.searchParams.set("fresh", String(Date.now()));
      window.location.replace(url.toString());
    };
    const clear = async () => {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    };
    const host = window as Window & { PorchApp?: { refresh?: () => void } };
    const reload = () =>
      void clear().finally(() => {
        if (typeof host.PorchApp?.refresh === "function") host.PorchApp.refresh();
        else go();
      });
    // In the app, Refresh first asks whether a newer app is ready; "Later" carries on with the refresh.
    void checkForAppUpdate(reload).then((offered) => {
      if (offered) setRefreshing(false);
      else reload();
    });
  }

  // "Refresh Porchbook" on your account card asks the frame to refresh.
  const refreshRef = useRef(refreshApp);
  refreshRef.current = refreshApp;
  useEffect(() => {
    const run = () => void refreshRef.current();
    window.addEventListener(REFRESH_EVENT, run);
    return () => window.removeEventListener(REFRESH_EVENT, run);
  }, []);

  function leave() {
    if (signingOut) return;
    setSigningOut(true);
    void playSignOutSound();
    void signOut().catch(() => {
      setSigningOut(false);
    });
  }

  useEffect(() => {
    keepAlertsCurrent();
  }, []);

  useEffect(() => {
    return watchFirebaseMember((firebaseUser) => {
      if (firebaseUser) claimLine(firebaseUser.uid, firebaseUser.name);
      else if (!firebaseReady() && user?.id) claimLine(user.id, user.displayName ?? "");
    });
  }, [user?.id, user?.displayName]);

  const line = useLine();
  const glassCalls = useGlassCalls();
  useEffect(() => {
    // The glass call card appears right where you are; the old look opens the calls page.
    if (glassCalls) return;
    if (line.call?.incoming && pathname !== "/calls") void navigate({ to: "/calls", search: { to: "", name: "", video: "" } });
  }, [line.call, navigate, pathname, glassCalls]);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      porchStanding({
      data: {
        displayName: user.displayName ?? "",
        email: user.primaryEmail ?? null,
        imageUrl: user.profileImageUrl ?? null,
      },
    })
      .then((result) => {
        if (!cancel && result.removed) setRemoved(true);
      })
      .catch(() => undefined);
    }, 800);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl]);

  if (isPending || !user) {
    // The server can't see the sign-in yet, so it draws the neutral shell
    // rather than the sign-up page (which flashed on every refresh).
    if (isPending || typeof window === "undefined") return <ShellSkeleton />;
    return <Welcome />;
  }

  // Stage 5a: signed in but not in a church yet: join one with an invite code (or start a porch).
  if (look?.member === false && pathname !== "/start" && pathname !== "/porches-waiting") {
    return <WelcomeScreen signedIn />;
  }

  if (removed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-display text-3xl text-ink">You are no longer on this porch.</h1>
        <button type="button" className="mt-6 text-sm font-semibold text-muted" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  // My porch and Who is on the porch have the new design; the other screens get theirs in Stages 4b and 4c.
  const newScreen = pathname === "/" || pathname === "/presence";
  const showBars = !guy && pathname !== "/calls" && pathname !== "/call";
  const owner = look?.name ?? "Phaneroo Ministries Mbarara";

  return (
    <div
      className={`porch-shell flex h-dvh flex-col overflow-hidden${pathname === "/calls" ? " call-pass" : ""}`}
      style={{ ["--book-dock" as string]: showBars ? "calc(4.25rem + env(safe-area-inset-bottom))" : "0px" }}
    >
      {featureShown("radio") ? <OnAirBar /> : null}
      <CallCard />
      <HeadMeasure>
        {showBars && pathname !== "/presence" ? (
          <TopBar
            look={look}
            subtitle={screenName(pathname)}
            me={{ id: user.id, name: user.displayName ?? "", imageUrl: face ?? user.profileImageUrl ?? null }}
            bell={<NoteBell userId={user.id} seed={{ displayName: user.displayName ?? "", email: user.primaryEmail, imageUrl: user.profileImageUrl }} />}
          />
        ) : null}
        <IncomingCall />
        <LiteOffer />
        <PresenceInvite />
      </HeadMeasure>
      <div
        className={
          guy
            ? "relative mx-auto min-h-0 w-full max-w-none flex-1 overflow-hidden"
            : newScreen
              ? "min-h-0 w-full flex-1 overflow-hidden"
              : `mx-auto grid min-h-0 w-full flex-1 gap-4 overflow-hidden ${pathname === "/next" ? "tour-page-shell max-w-6xl px-4 py-3 lg:px-6" : `max-w-6xl px-4 py-3 lg:px-6 lg:grid-cols-[minmax(0,1fr)_16rem]${pathname === "/read" ? " pc-read" : ""}${pathname.startsWith("/messages") ? " pc-wide" : ""}`}`
        }
      >
        <main className="min-h-0 overflow-hidden">
          <div key={`${pathname}#${refreshKey}`} className="pb pb-legacy rise h-full min-h-0 overflow-y-auto">
            <div className={newScreen ? "pb pb-column" : undefined}>
              <FounderDesk user={user} home={pathname === "/"} />
              {children}
              {pathname === "/calls" ? null : <TroubleBar />}
              {pathname === "/calls" ? null : <RideNews />}
              {pathname === "/calls" ? null : <AskNews />}
              {pathname === "/calls" || !featureShown("radio") ? null : <RadioNews />}
              {featureShown("radio") ? <NuggetLink /> : null}
              {newScreen ? null : <p className="porch-property">Property of {owner}</p>}
              <WordsEditor />
              <KeepRunning />
              <AppUpdateCard />
            </div>
          </div>
        </main>
        {newScreen || pathname === "/next" || guy ? null : (
          <aside className="hidden lg:block">
            <div className="sticky top-4 space-y-4">{rail}</div>
          </aside>
        )}
      </div>
      <RhemaStage
        videoId={rhema.videoId}
        kind={rhema.kind}
        start={rhema.start}
        end={rhema.end}
        open={rhema.open}
        run={rhema.run}
        onClose={rhema.close}
        onEnded={rhema.markOver}
      />
      {newBuild && newBuild !== hiddenBuild ? (
        <div className="pb pb-update" role="status">
          <button type="button" className="pb-link" onClick={refreshApp}>
            <W k="refresh.bubble">Something new on Porchbook · tap Refresh</W>
          </button>
          <button type="button" className="pb-link" aria-label="Close" onClick={() => hideBuild(newBuild)}>
            ✕
          </button>
        </div>
      ) : null}
      {showBars ? <BottomNav pathname={pathname} unread={unread} /> : null}
    </div>
  );
}

/** What the top bar says under the porch's name. */
function screenName(pathname: string) {
  if (pathname === "/") return "Your porch";
  if (pathname === "/next") return "Tour";
  if (pathname.startsWith("/offices")) return "Offices";
  if (pathname === "/read") return "Read";
  if (pathname.startsWith("/messages")) return "Chat";
  if (pathname.startsWith("/people")) return "People";
  if (pathname.startsWith("/groups")) return "Groups";
  if (pathname === "/invite") return "Invite";
  if (pathname === "/porch-settings") return "Porch settings";
  if (pathname === "/porches-waiting") return "Waiting for approval";
  if (pathname === "/presence") return "On the porch now";
  if (pathname === "/roll") return "The roll";
  if (pathname.startsWith("/calls")) return "Calls";
  if (pathname === "/privacy") return "Privacy";
  return "Your porch";
}

/** ☀ at the end of the "on the porch" strip: a tap opens the brightness roller above it. */
function BrightKey() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useBackLayer(open, () => setOpen(false), "brightness");
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={box}>
      <button type="button" className={`bk-sun${open ? " is-on" : ""}`} aria-label="Brightness" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        ☀
      </button>
      {open ? (
        <div className="bk-pop" role="dialog" aria-label="Brightness">
          <p className="bk-title">☀ BRIGHTNESS</p>
          <ThemePlate flat />
        </div>
      ) : null}
    </div>
  );
}

/** The Porchbook logo at the top; its butterfly leaves it while it rests on a post box. */
function HeadLogo() {
  const away = useLogoAway();
  return (
    <>
      <img src={away ? "/logo-text.png?v=1" : "/logo.png?v=5"} alt="Porchbook" className="head-logo h-11 w-auto sm:h-12" />
      <LogoFlyer />
    </>
  );
}

/**
 * "Your account", on your own profile (Stage 4a). The top bar's picture now opens your profile,
 * so everything that was in the old account menu (and the old bottom bar's Invite and Refresh) lives here.
 */
export function AccountCard({ user }: { user: AppUser }) {
  const [alerts, setAlerts] = useState<NotificationPermission | "unsupported">("unsupported");
  const [alertNote, setAlertNote] = useState("");
  const [admin, setAdmin] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const accountLook = usePorchLook();
  const navigate = useNavigate();
  const seed = { displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null };
  useEffect(() => {
    setAlerts(alertPermission());
    founderDesk({ data: seed })
      .then((result) => setAdmin(result.isFounder))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);
  return (
    <section className="pb">
      <h2 className="pb-ttl" style={{ fontSize: 20, margin: "8px 4px 8px" }}>
        Your account
      </h2>
      <div className="pb-card pb-account">
        <Link to="/presence">
          <PbIcon name="eye" size={20} />
          Who is on the porch
        </Link>
        {alerts === "unsupported" ? null : (
          <button
            type="button"
            onClick={() => {
              setAlertNote("");
              void enableAlerts(seed).then((result) => {
                setAlerts(alertPermission());
                if (!result.ok) setAlertNote(result.error);
              });
            }}
          >
            <Bell className="size-5" aria-hidden="true" />
            Alerts
            <small>{alerts === "granted" ? "On" : "Off"}</small>
          </button>
        )}
        {alertNote ? <p style={{ padding: "0 16px 10px", fontSize: 13, color: "var(--pb-quiet)" }}>{alertNote}</p> : null}
        <Link to="/invite">
          <Share2 className="size-5" aria-hidden="true" />
          Invite someone
        </Link>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("porch-trouble", { detail: "__choose" }))}>
          <MessageCircle className="size-5" aria-hidden="true" />
          Feedback
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new Event(REFRESH_EVENT))}>
          <RefreshCw className="size-5" aria-hidden="true" />
          Refresh Porchbook
        </button>
        {inPorchApp() ? (
          <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_KEEP))}>
            <AudioLines className="size-5" aria-hidden="true" />
            Keep Porchbook running
          </button>
        ) : null}
        {accountLook?.owner ? (
          <Link to="/porches-waiting">
            <Landmark className="size-5" aria-hidden="true" />
            Porches waiting for approval
            <small>Approve or decline new porches</small>
          </Link>
        ) : null}
        <Link to="/start">
          <Users className="size-5" aria-hidden="true" />
          Start a porch
          <small>A ministry, artist or organisation porch</small>
        </Link>
        {admin ? (
          <Link to="/porch-settings">
            <Palette className="size-5" aria-hidden="true" />
            Porch settings
            <small>Theme and Tour doors</small>
          </Link>
        ) : null}
        {admin ? (
          <button
            type="button"
            onClick={() => {
              void navigate({ to: "/", search: { room: "all" } as never }).then(() => window.setTimeout(toggleFounderDesk, 60));
            }}
          >
            <Landmark className="size-5" aria-hidden="true" />
            Admin tools
            <small>Message everyone, the roll, sounds</small>
          </button>
        ) : null}
        {admin ? (
          <button type="button" onClick={() => window.dispatchEvent(new Event(COMPLAINTS_EVENT))}>
            <MessageCircle className="size-5" aria-hidden="true" />
            User's complaints
          </button>
        ) : null}
        {admin ? <EditWordsButton /> : null}
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void playSignOutSound();
            void signOut().catch(() => setLeaving(false));
          }}
        >
          {leaving ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <div className="pb-card" style={{ marginTop: 12, padding: "4px 0" }}>
        <PresenceChoice />
        <div style={{ padding: "8px 16px" }}>
          <LiteKey />
        </div>
      </div>
    </section>
  );
}
