import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { Avatar, CallLink, fieldClass, primaryButtonClass, quietButtonClass, startTone, stopTone, tap } from "@/components/porch/bits";
import { Fault } from "@/components/porch/trouble";
import { finishCall, listCalls, ringPerson } from "@/lib/porch/call-ask";
import { startCall, type CallDiag, type CallTile } from "@/lib/porch/call-room";
import { primeCallAudio } from "@/lib/porch/call-audio";
import { holdRadio, releaseRadio, useFm } from "@/lib/porch/fm-player";
import {
  addGroupNote,
  addMember,
  createGroup,
  getGroup,
  leaveGroup,
  listGroups,
  callLeave,
  openPersonCall,
  type GroupPage,
  type GroupSummary,
} from "@/lib/porch/groups";
import { listPeople } from "@/lib/porch/api";
import { formatWhen, type PublicProfile } from "@/lib/porch/model";

function seedOf(user: { displayName: string | null; primaryEmail: string | null }) {
  return { displayName: user.displayName ?? "", email: user.primaryEmail, imageUrl: null };
}

export function GroupsView() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    listGroups({ data: { displayName, email, imageUrl: null } })
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
  }, [userId, displayName, email]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const result = await createGroup({ data: { name, purpose, displayName, email, imageUrl: null } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void navigate({ to: "/groups/$groupId", params: { groupId: String(result.id) } });
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Groups</h1>
      <p className="mt-1 text-ink">Two are Better than One.</p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-2">
        <label className="sr-only" htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          className={fieldClass}
          value={name}
          maxLength={40}
          placeholder="Name the group"
          onChange={(event) => setName(event.target.value)}
        />
        <label className="sr-only" htmlFor="group-purpose">
          Purpose
        </label>
        <input
          id="group-purpose"
          className={fieldClass}
          value={purpose}
          maxLength={160}
          placeholder="A brief purpose"
          onChange={(event) => setPurpose(event.target.value)}
        />
        <button type="submit" className={`${primaryButtonClass} justify-self-start`} disabled={pending || !name.trim() || !purpose.trim()}>
          Create
        </button>
      </form>
      <Fault text={error} />
      {status === "error" ? <p className="mt-4 text-danger">Couldn't load your groups.</p> : null}
      {status === "ready" && groups.length === 0 ? (
        <p className="mt-6 text-muted">No groups yet. Make one and add a few people.</p>
      ) : null}
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
        {groups.map((group) => (
          <li key={group.id} className="px-4 py-3">
            {group.joined ? (
              <Link
                to="/groups/$groupId"
                params={{ groupId: String(group.id) }}
                className="block truncate font-semibold text-ink"
              >
                {group.name}
              </Link>
            ) : (
              <p className="truncate font-semibold text-ink">{group.name}</p>
            )}
            {group.purpose ? <p className="mt-1 text-sm text-post">{group.purpose}</p> : null}
            <p className="mt-1 text-sm text-muted">
              Admin{" "}
              {group.ownerId === userId ? (
                <span className="font-semibold text-ink">{group.ownerName}</span>
              ) : (
                <Link
                  to="/messages/$userId"
                  params={{ userId: group.ownerId }}
                  className="font-semibold text-ink underline decoration-ink underline-offset-2"
                >
                  {group.ownerName}
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GroupRoom({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [page, setPage] = useState<GroupPage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const id = Number(groupId);

  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;

  useEffect(() => {
    if (!userId || !Number.isInteger(id)) return;
    let cancel = false;
    setStatus("loading");
    getGroup({ data: { id, displayName, email, imageUrl: null } })
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
  }, [userId, displayName, email, id, tick]);

  async function invite(memberId: string) {
    setError("");
    const result = await addMember({ data: { groupId: id, userId: memberId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTick((value) => value + 1);
  }

  async function remove(memberId: string) {
    setError("");
    const result = await leaveGroup({ data: { groupId: id, userId: memberId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (memberId === userId) {
      void navigate({ to: "/groups" });
      return;
    }
    setTick((value) => value + 1);
  }

  async function sendNote(event: FormEvent) {
    event.preventDefault();
    setError("");
    const result = await addGroupNote({ data: { groupId: id, body: note, displayName, email, imageUrl: null } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
    setTick((value) => value + 1);
  }

  if (status === "loading") return null;
  if (status === "error") return <p className="text-danger">Couldn't open that group.</p>;
  if (status === "missing" || !page) {
    return (
      <div className="rounded-3xl glass-edge bg-card px-5 py-10 text-center">
        <h1 className="font-display text-2xl text-ink">That group isn't yours</h1>
        <p className="mt-2 text-muted">Only people who were added can open it.</p>
        <Link to="/groups" className="mt-4 inline-flex min-h-11 items-center font-semibold text-pine">
          Back to groups
        </Link>
      </div>
    );
  }

  const others = query.trim()
    ? page.others.filter((person) => person.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    : page.others;

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">{page.name}</h1>
      <p className="mt-1 text-muted">Only these people. Notes stay here.</p>
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
        {page.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={member.displayName} imageUrl={member.imageUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">
                {member.displayName}
                {member.userId === userId ? " · you" : ""}
              </span>
              <span className="block truncate text-sm text-muted">
                {member.owner ? "Made this group" : member.role || "In the group"}
              </span>
            </span>
            {member.userId !== userId ? (
              <CallLink userId={member.userId} name={member.displayName} />
            ) : null}
            {page.owner || member.userId === userId ? (
              <button type="button" className={`${quietButtonClass} px-2`} onClick={() => remove(member.userId)}>
                {member.userId === userId ? "Leave" : "Remove"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {page.owner ? (
        <div className="mt-4">
          <label className="block">
            <span className="sr-only">Find someone to add</span>
            <input
              className={fieldClass}
              value={query}
              placeholder="Add someone from the team"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query.trim() && others.length === 0 ? <p className="mt-2 text-sm text-muted">No one matches that.</p> : null}
          {query.trim() && others.length > 0 ? (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
              {others.slice(0, 8).map((person) => (
                <li key={person.userId} className="flex items-center gap-3 px-4 py-2">
                  <Avatar name={person.displayName} imageUrl={person.imageUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-ink">{person.displayName}</span>
                  <button type="button" className={`${quietButtonClass} px-2 text-pine`} onClick={() => invite(person.userId)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ul className="mt-6 space-y-3">
        {page.notes.map((item) => (
          <li key={item.id} className="rounded-3xl glass-edge bg-card p-4">
            <p className="text-sm">
              <span className="font-semibold text-ink">{item.authorName}</span>{" "}
              <time className="text-muted" dateTime={item.createdAt}>
                {formatWhen(item.createdAt)}
              </time>
            </p>
            <p className="mt-1 text-ink">{item.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={sendNote} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="group-note">
          Note
        </label>
        <input
          id="group-note"
          className={`${fieldClass} min-w-0 flex-1`}
          value={note}
          maxLength={800}
          placeholder="Say something to the group"
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className={`${primaryButtonClass} shrink-0`} disabled={!note.trim()}>
          Send
        </button>
      </form>
      <Fault text={error} />
    </div>
  );
}

export function PersonCallView({
  userId: otherId,
  autoJoin = false,
  video = false,
  picking = false,
}: {
  userId: string;
  autoJoin?: boolean;
  video?: boolean;
  picking?: boolean;
}) {
  const user = useCurrentUser();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [callId, setCallId] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const userId = user?.id ?? "";
  const displayName = user?.displayName ?? "";
  const email = user?.primaryEmail ?? null;

  useEffect(() => {
    if (!userId || !otherId) return;
    let cancel = false;
    openPersonCall({ data: { userId: otherId, displayName, email, imageUrl: null } })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setGroupId(result.groupId);
        setName(result.name);
        setCallId(result.callId || 0);
      })
      .catch(() => {
        if (!cancel) setError("That call didn't open.");
      });
    return () => {
      cancel = true;
    };
  }, [userId, displayName, email, otherId]);

  if (!otherId) {
    return (
      <>
        <CallerPick />
        <CallHistory />
      </>
    );
  }
  if (error) {
    return (
      <>
        <Fault text={error} className="" />
        <CallerPick />
        <CallHistory />
      </>
    );
  }
  if (!groupId) return <h1 className="font-display text-3xl text-ink">Call</h1>;

  return (
    <>
      <GroupCall
        groupId={groupId}
        selfId={userId}
        ringUserId={otherId}
        name={displayName || "Teammate"}
        title={name ? `Call ${name}` : "Call"}
        hint="Just the two of you. Voice first. Camera if you want it."
        waiting={`Waiting for ${name || "them"} to join.`}
        autoJoin={autoJoin}
        startVideo={video}
        picking={picking}
        callId={picking ? callId : 0}
      />
      <CallHistory />
    </>
  );
}

function CallerPick() {
  const user = useCurrentUser();
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    listPeople({
      data: {
        displayName: user.displayName ?? "",
        email: user.primaryEmail,
        imageUrl: user.profileImageUrl,
      },
    })
      .then((result) => setPeople(result.people.filter((person) => person.userId !== user.id)))
      .catch(() => undefined);
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? people.filter((person) => person.displayName.toLowerCase().includes(needle)) : people;

  return (
    <section>
      <h1 className="font-display text-3xl text-ink">Call</h1>
      <label className="mt-3 block">
        <span className="sr-only">Who to call</span>
        <input
          className={fieldClass}
          value={query}
          placeholder="Who do you want to call?"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-3xl glass-edge bg-card">
        {shown.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No one by that name.</li> : null}
        {shown.map((person) => (
          <li key={person.userId} className="flex items-center gap-3 px-4 py-2">
            <Avatar name={person.displayName} imageUrl={person.imageUrl} />
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{person.displayName}</span>
            <CallLink userId={person.userId} name={person.displayName} className={`${primaryButtonClass} min-w-20 px-3`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function callWords(row: { kind: string; status: string; direction: string; seconds: number }) {
  const kind = row.kind === "video" ? "video" : "voice";
  if (row.status === "missed") return `Missed ${kind} call`;
  if (row.status === "declined") return `Declined ${kind} call`;
  if (row.status === "cancelled") return `Cancelled ${kind} call`;
  const way = row.direction === "out" ? "Outgoing" : "Incoming";
  const length = row.seconds > 0 ? ` · ${Math.floor(row.seconds / 60)}:${String(row.seconds % 60).padStart(2, "0")}` : "";
  return `${way} ${kind} call${length}`;
}

function CallHistory() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<{ id: number; userId: string; name: string; kind: string; status: string; direction: string; seconds: number; at: string }[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    listCalls({
      data: {
        displayName: user.displayName ?? "",
        email: user.primaryEmail,
        imageUrl: user.profileImageUrl,
      },
    })
      .then((result) => setRows(result.calls))
      .catch(() => undefined);
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl]);

  if (!rows.length) return null;
  return (
    <section className="mt-4">
      <h2 className="font-display text-xl text-ink">Calls</h2>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 rounded-2xl px-1">
            <span className="min-w-0 flex-1 text-sm text-muted">
              <span className="block font-medium text-ink">{row.name}</span>
              {callWords(row)} · {new Date(row.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
            <CallLink userId={row.userId} name={row.name} className={`${primaryButtonClass} min-w-20 px-3`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function askPhone(kind: "audio" | "video"): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(true);
  const native = (window as Window & { PorchMic?: { ask: (kind: string) => void } }).PorchMic;
  if (!native?.ask) return Promise.resolve(true);
  return new Promise((resolve) => {
    const host = window as Window & { __porchAllow?: (ok: boolean) => void };
    host.__porchAllow = (ok) => {
      host.__porchAllow = undefined;
      resolve(ok === true);
    };
    native.ask(kind);
  });
}

function GroupCall({
  groupId,
  selfId,
  name,
  ringUserId = "",
  title = "Call",
  hint = "Up to six people. Voice first. Camera if you want it.",
  waiting = "Waiting for someone in the group to join.",
  joinLabel = "Call",
  autoJoin = false,
  startVideo = false,
  picking = false,
  callId = 0,
}: {
  groupId: number;
  selfId: string;
  name: string;
  ringUserId?: string;
  title?: string;
  hint?: string;
  waiting?: string;
  joinLabel?: string;
  autoJoin?: boolean;
  startVideo?: boolean;
  picking?: boolean;
  callId?: number;
}) {
  // Call diagnostics are technical: only the founder (developer) sees them.
  const founder = Boolean(useFm().founder);
  const [live, setLive] = useState(false);
  // While in a group call, Porchbook Radio steps aside (and comes back after).
  useEffect(() => {
    if (live) holdRadio("group-call");
    else releaseRadio("group-call");
    return () => releaseRadio("group-call");
  }, [live]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(false);
  const [link, setLink] = useState<"excellent" | "good" | "weak" | "lost">("good");
  const [summary, setSummary] = useState("");
  const [voice, setVoice] = useState(false);
  const [diag, setDiag] = useState<CallDiag | null>(null);
  const [tiles, setTiles] = useState<CallTile[]>([]);
  const [error, setError] = useState("");
  const [begun, setBegun] = useState(0);
  const [clock, setClock] = useState("");
  const localRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<ReturnType<typeof startCall> | null>(null);
  const connected = useRef(false);
  const present = useRef(false);
  const watch = useRef(0);
  const facing = useRef<"user" | "environment">("user");
  const liveRef = useRef(false);
  const pickingRef = useRef(picking);
  liveRef.current = live;
  pickingRef.current = picking;

  useEffect(() => {
    connected.current = tiles.some((tile) => tile.state === "connected") || voice;
    present.current = tiles.length > 0;
    if (connected.current && !begun) setBegun(Date.now());
  }, [tiles, begun]);

  useEffect(() => {
    if (!begun) return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - begun) / 1000);
      const min = Math.floor(seconds / 60);
      const sec = String(seconds % 60).padStart(2, "0");
      setClock(`${min}:${sec}`);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [begun]);

  useEffect(() => {
    return () => {
      callRef.current?.stop();
      void callLeave({ data: { groupId } });
    };
  }, [groupId]);

  function showLocal(stream: MediaStream) {
    streamRef.current = stream;
    if (localRef.current) localRef.current.srcObject = stream;
  }

  useEffect(() => {
    if (localRef.current && streamRef.current) localRef.current.srcObject = streamRef.current;
  }, [live, camera]);

  async function join(withVideo = false) {
    primeCallAudio();
    setError("");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("No internet connection.");
      return;
    }
    const allowed = await askPhone("audio");
    if (!allowed) {
      setError("Allow the microphone and try the call again.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      if (!stream.getAudioTracks().length) {
        setError("No microphone track.");
        return;
      }
      let activeCall = callId;
      if (!pickingRef.current && ringUserId) {
        const rung = await ringPerson({ data: { userId: ringUserId, video: withVideo, displayName: name, email: null, imageUrl: null } });
        if (rung && "busy" in rung && rung.busy) {
          stream.getTracks().forEach((track) => track.stop());
          setError("They are on another call.");
          return;
        }
        if (rung && "callId" in rung && rung.callId) activeCall = rung.callId;
      }
      if (!activeCall) {
        stream.getTracks().forEach((track) => track.stop());
        setError("The call id was not created, so the offer was not sent.");
        return;
      }
      showLocal(stream);
      callRef.current = startCall({
        groupId,
        selfId,
        callId: activeCall,
        name,
        stream,
        onTiles: setTiles,
        onLink: setLink,
        onVoice: () => setVoice(true),
        onDiag: setDiag,
        onError: (message) => {
          setError(message);
          if (message.includes("six")) {
            callRef.current?.stop();
            callRef.current = null;
            streamRef.current = null;
            setLive(false);
            setTiles([]);
          }
        },
      });
      setSummary("");
      setLive(true);
      setCamera(withVideo);
      setMuted(false);
      if (!pickingRef.current && ringUserId) {
        const mine = watch.current + 1;
        watch.current = mine;
        window.setTimeout(() => {
          if (mine !== watch.current || connected.current || present.current) return;
          setError("No answer.");
          hangUp("missed");
        }, 90000);
      }
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(denied ? (withVideo ? "Camera and microphone permission required." : "Microphone permission required.") : "Unable to connect.");
    }
  }

  const joinRef = useRef(join);
  joinRef.current = join;
  useEffect(() => {
    const onAnswer = (event: Event) => {
      if (liveRef.current) return;
      const detail = (event as CustomEvent<{ video?: boolean; pick?: boolean }>).detail;
      if (detail?.pick) pickingRef.current = true;
      void joinRef.current(Boolean(detail?.video));
    };
    window.addEventListener("porch-answer", onAnswer);
    return () => window.removeEventListener("porch-answer", onAnswer);
  }, []);

  useEffect(() => {
    if (!autoJoin) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      if (!cancel) void join(startVideo);
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [autoJoin, startVideo]);

  useEffect(() => {
    const waiting = live && tiles.length === 0 && !voice;
    if (waiting) startTone("out");
    else stopTone();
    return () => stopTone();
  }, [live, tiles.length, voice]);

  useEffect(() => {
    const down = () => {
      if (liveRef.current) setError("No internet connection.");
    };
    const up = () => setError((current) => (current === "No internet connection." ? "" : current));
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, []);

  function hangUp(status: "completed" | "cancelled" | "missed" = "cancelled") {
    watch.current += 1;
    stopTone();
    const done = connected.current && status !== "missed" ? "completed" : status;
    if (liveRef.current) {
      const seconds = begun ? Math.max(0, Math.floor((Date.now() - begun) / 1000)) : 0;
      const length = seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";
      const who = (title || "Call").replace(/^Call\s+/, "");
      setSummary(`Call ended · ${who} · ${camera ? "Video" : "Voice"}${length ? ` · ${length}` : ""}`);
    }
    callRef.current?.stop();
    callRef.current = null;
    streamRef.current = null;
    if (localRef.current) localRef.current.srcObject = null;
    setLive(false);
    setTiles([]);
    setVoice(false);
    setCamera(false);
    setBegun(0);
    setClock("");
    connected.current = false;
    void callLeave({ data: { groupId } });
    if (ringUserId) void finishCall({ data: { userId: ringUserId, status: done } });
  }

  function toggleMute() {
    tap();
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }

  async function toggleCamera() {
    const stream = streamRef.current;
    if (!stream) return;
    if (camera) {
      stream.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      callRef.current?.replaceStream(stream);
      setCamera(false);
      return;
    }
    try {
      const allowed = await askPhone("video");
      if (!allowed) {
        setError("The camera didn't open.");
        return;
      }
      const video = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const [track] = video.getVideoTracks();
      if (!track) return;
      stream.addTrack(track);
      callRef.current?.replaceStream(stream);
      showLocal(stream);
      setCamera(true);
    } catch {
      setError("The camera didn't open.");
    }
  }

  async function flipCamera() {
    const stream = streamRef.current;
    if (!stream || !camera) return;
    const next = facing.current === "user" ? "environment" : "user";
    try {
      let video: MediaStream;
      try {
        video = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: next, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        video = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      const [track] = video.getVideoTracks();
      if (!track) return;
      facing.current = next;
      stream.getVideoTracks().forEach((old) => {
        old.stop();
        stream.removeTrack(old);
      });
      stream.addTrack(track);
      callRef.current?.replaceStream(stream);
      showLocal(stream);
    } catch {
      setError("The camera didn't switch.");
    }
  }

  const heard = tiles.some((tile) => tile.state === "connected") || voice;
  const slipping = tiles.some((tile) => tile.state === "disconnected" || tile.state === "failed");
  const line = !live ? "" : slipping ? "Reconnecting..." : heard ? "Connected" : "Calling...";

  return (
    <section className="mt-4 rounded-3xl glass-edge bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <p className="text-sm text-muted">{live ? `${line}${clock ? ` · ${clock}` : ""}` : hint}</p>
        </div>
        {live ? (
          <button type="button" className={`${quietButtonClass} gap-2`} onClick={() => hangUp()}>
            <PhoneOff className="size-4" aria-hidden="true" />
            Leave
          </button>
        ) : (
          <button type="button" className={`${primaryButtonClass} gap-2`} onClick={() => void join(false)}>
            <Phone className="size-4" aria-hidden="true" />
            {joinLabel}
          </button>
        )}
      </div>
      {!live && ringUserId ? (
        <button type="button" className={`${quietButtonClass} mt-3 gap-2`} onClick={() => void join(true)}>
          <Video className="size-4" aria-hidden="true" />
          Video
        </button>
      ) : null}
      {summary && !live ? <p className="mt-3 text-sm text-muted">{summary}</p> : null}
      <Fault text={error} />
      {live ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2">
            <Tile name={`${name} · you`} stream={streamRef.current} self muted={muted} videoRef={localRef} />
            {tiles.map((tile) => (
              <RemoteTile key={tile.id} tile={tile} />
            ))}
          </div>
          {tiles.length === 0 ? <p className="mt-3 text-sm text-muted">{waiting}</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" className={quietButtonClass} onClick={toggleMute}>
              {muted ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => void toggleCamera()}>
              {camera ? <VideoOff className="size-4" aria-hidden="true" /> : <Video className="size-4" aria-hidden="true" />}
              {camera ? "Camera off" : "Camera"}
            </button>
            {camera ? (
              <button type="button" className={quietButtonClass} onClick={() => void flipCamera()}>
                Switch
              </button>
            ) : null}
          </div>
          {founder ? (
          <details className="mt-3 text-xs text-muted">
            <summary>Porchbook call diagnostics</summary>
            <p>ICE SERVERS</p>
            <p>STUN: {diag?.stun ?? "UNKNOWN"}</p>
            <p>TURN: {diag?.turn ?? "FAIL"}</p>
            <p>TURN UDP: {diag?.turnUdp ?? "FAIL"}</p>
            <p>TURN TCP: {diag?.turnTcp ?? "FAIL"}</p>
            <p>TURN TLS: {diag?.turnTls ?? "FAIL"}</p>
            <p>CANDIDATES</p>
            <p>HOST: {diag?.hostCandidates ?? 0}</p>
            <p>SRFLX: {diag?.srflxCandidates ?? 0}</p>
            <p>RELAY: {diag?.relayCandidates ?? 0}</p>
            <p>CONNECTION</p>
            <p>ICE STATE: {diag?.iceState ?? "new"}</p>
            <p>PEER STATE: {diag?.peerState ?? "new"}</p>
            <p>SIGNALING STATE: {diag?.signalingState ?? "stable"}</p>
            <p>MEDIA</p>
            <p>LOCAL AUDIO: {diag?.audioTracks ?? "NO"}</p>
            <p>LOCAL VIDEO: {diag?.videoTracks ?? "NO"}</p>
            <p>REMOTE AUDIO: {diag?.remoteAudio ?? "NO"}</p>
            <p>REMOTE VIDEO: {diag?.remoteVideo ?? "NO"}</p>
            <p>TURN RELAY TEST: {diag?.relayTest ?? "WAITING"}</p>
            <p>LAST ICE ERROR: {diag?.lastIceError || "none"}</p>
            <p>Last signaling error: {diag?.lastSignalError || "none"}</p>
            <p>{diag?.note || "Porchbook is waiting for real TURN credentials."}</p>
          </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function hasPicture(stream: MediaStream | null) {
  return !!stream?.getVideoTracks().some((track) => track.readyState !== "ended");
}

function Tile({
  name,
  stream,
  self,
  muted,
  videoRef,
}: {
  name: string;
  stream: MediaStream | null;
  self?: boolean;
  muted?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const picture = hasPicture(stream);
  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl bg-paper">
      <video ref={videoRef} autoPlay playsInline muted={self || muted} controls={false} className={`h-full w-full object-cover${self ? " -scale-x-100" : ""}${picture ? "" : " hidden"}`} />
      <span className="absolute bottom-2 left-2 rounded-full bg-paper/80 px-2 py-1 text-xs font-medium text-ink">{name}</span>
    </div>
  );
}

function RemoteTile({ tile }: { tile: CallTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.stream;
      void ref.current.play().catch(() => undefined);
    }
  }, [tile.stream]);
  const picture = hasPicture(tile.stream);
  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl bg-paper">
      <video ref={ref} autoPlay playsInline muted controls={false} className={`h-full w-full object-cover${picture ? "" : " hidden"}`} />
      <span className="absolute bottom-2 left-2 rounded-full bg-paper/80 px-2 py-1 text-xs font-medium text-ink">
        {tile.name}
        {tile.state === "connected" ? "" : " · connecting"}
      </span>
    </div>
  );
}
