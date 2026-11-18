import { useSyncExternalStore } from "react";

const LINE: string =
  (import.meta.env.VITE_CALL_LINE as string | undefined) || "wss://porchbook-calls.onrender.com";

const EMOJI = [
  "😀", "😎", "🤖", "👻", "🐶", "🐱", "🦊", "🐼", "🐸", "🐵", "🦁", "🐯", "🐨", "🐙", "🦋", "🐢",
  "🌵", "🌲", "🌻", "🍀", "🍎", "🍌", "🍉", "🍇", "🍓", "🍒", "🍍", "🥑", "🌽", "🥕", "🍕", "🍔",
  "🍩", "🍪", "🎂", "☕", "⚽", "🏀", "🎸", "🎧", "🎲", "🚗", "🚀", "✈️", "🚲", "⛵", "🏠", "⏰",
  "💡", "🔑", "🔒", "📷", "📚", "✏️", "🎁", "🎈", "⭐", "🌙", "☀️", "🌈", "❄️", "🔥", "💧", "⚡",
];

const STATUS: Record<string, string> = {
  preparing: "Starting…",
  ringing: "Ringing…",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  connected: "Connected",
};

const ENDED: Record<string, string> = {
  hangup: "Call ended",
  "remote-hangup": "Call ended",
  declined: "Declined",
  busy: "Busy on another call",
  unavailable: "Not online",
  "no-answer": "No answer",
  missed: "Missed call",
  "connection-failed": "Couldn't connect",
  "connection-lost": "Connection lost",
  "security-check-failed": "Security check failed. The call stopped.",
  "signaling-lost": "The line dropped",
  "no-permission": "The microphone or camera was not allowed",
  error: "The call failed",
};

type Person = { id: string; name: string };
type Phase = "idle" | "opening" | "online";

export type LineView = {
  phase: Phase;
  note: string;
  name: string;
  me: string;
  people: Person[];
  direct: boolean;
  call: null | {
    name: string;
    video: boolean;
    incoming: boolean;
    status: string;
    emojis: string;
    route: string;
    muted: boolean;
    cameraOff: boolean;
    /** Sound from the loudspeaker (true) or the earpiece (false). */
    speaker: boolean;
    local: MediaStream | null;
    remote: MediaStream | null;
  };
};

type Cert = RTCCertificate & { getFingerprints: () => { algorithm: string; value: string }[] };
type Slot = {
  id: string;
  peer: string;
  peerName: string;
  video: boolean;
  role: "caller" | "callee";
  pendingIce: RTCIceCandidateInit[];
  cert?: Cert;
  myFp?: string;
  peerFp?: string;
  commit?: string;
  local?: MediaStream;
  remote?: MediaStream;
  pc?: RTCPeerConnection;
  timer?: number;
  dropTimer?: number;
  accepted?: boolean;
  ringCommit?: string;
  peerGone?: boolean;
  startedAt?: number;
};

function readStore(key: string, fallback: unknown) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`pbcalls:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(`pbcalls:${key}`, JSON.stringify(value));
  } catch {
    /* the line still works for this visit */
  }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : hex(crypto.getRandomValues(new Uint8Array(16))));
const hex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

const certFp = (cert: Cert) => cert.getFingerprints().find((item) => item.algorithm === "sha-256")?.value?.toUpperCase() ?? "";
const sdpFp = (sdp: string) => sdp.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/)?.[1]?.toUpperCase() ?? "";


// ---- Backup route -----------------------------------------------------------
// Some mobile networks (seen on MTN data) block the direct, always-open
// connection to the call server. Then the phone talks to Porchbook's own site
// (/api/line-relay), which forwards to the call server. RelaySocket looks like
// a WebSocket to the rest of this file, so calls work the same either way.
const RELAY_REMEMBER_MS = 30 * 60 * 1000;

function relayPreferred() {
  const at = Number(readStore("relay", 0));
  return Number.isFinite(at) && at > 0 && Date.now() - at < RELAY_REMEMBER_MS;
}

function preferRelay() {
  writeStore("relay", Date.now());
}

async function relayPost(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch("/api/line-relay", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { error: "signed-out" };
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const relayWait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

class RelaySocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  private session = "";
  private timer = 0;
  private outbox: Record<string, unknown>[] = [];
  private busyUntil = 0;
  private stopped = false;
  private pumping = false;
  private again = false;
  private failures = 0;

  constructor() {
    this.readyState = 1;
    window.setTimeout(() => this.onopen?.(new Event("open")), 0);
  }

  send(text: string) {
    if (this.readyState !== 1) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "register") {
      void this.register();
      return;
    }
    this.busyUntil = Date.now() + 60000;
    this.outbox.push(message);
    this.schedule(0);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.stopped = true;
    window.clearTimeout(this.timer);
    if (this.session) void relayPost({ op: "leave", session: this.session });
    window.setTimeout(() => this.onclose?.(new Event("close")), 0);
  }

  private async register() {
    // The call server may be asleep (free plan): keep trying for about a minute.
    for (let tries = 0; tries < 25 && !this.stopped; tries += 1) {
      const reply = await relayPost({ op: "register" });
      if (this.stopped) return;
      if (reply && typeof reply.session === "string") {
        this.session = reply.session;
        this.deliver(reply.messages);
        this.schedule(0);
        return;
      }
      if (reply?.error === "signed-out") break;
      await relayWait(3000);
    }
    this.fail();
  }

  private fail() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.onerror?.(new Event("error"));
    this.onclose?.(new Event("close"));
  }

  private deliver(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const data = typeof item === "string" ? item : JSON.stringify(item);
      if (!data.includes('"presence"')) this.busyUntil = Date.now() + 60000;
      this.onmessage?.({ data });
    }
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.pump(), ms);
  }

  private async pump() {
    if (this.stopped || !this.session) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    const out = this.outbox.splice(0);
    const reply = await relayPost(out.length ? { op: "send", session: this.session, message: out } : { op: "poll", session: this.session });
    this.pumping = false;
    if (this.stopped) return;
    if (!reply || reply.waking) {
      this.outbox.unshift(...out);
      this.failures += 1;
      if (this.failures > 15) {
        this.fail();
        return;
      }
      this.schedule(2000);
      return;
    }
    this.failures = 0;
    this.deliver(reply.messages);
    if (reply.gone) {
      this.fail();
      return;
    }
    if (this.again || this.outbox.length) {
      this.again = false;
      this.schedule(0);
      return;
    }
    const busy = Date.now() < this.busyUntil;
    const hidden = document.visibilityState === "hidden";
    this.schedule(busy ? 700 : hidden ? 5000 : 2000);
  }
}

class LineClient {
  allowP2P = readStore("p2p", true) !== false;
  iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  me = "";
  myName = "";
  online: Person[] = [];
  private ws: WebSocket | null = null;
  private closing = false;
  private slot: Slot | null = null;
  private handlers: Record<string, ((data: unknown) => void)[]> = {};

  on(event: string, fn: (data: unknown) => void) {
    (this.handlers[event] ??= []).push(fn);
  }

  private emit(event: string, data?: unknown) {
    for (const fn of this.handlers[event] ?? []) fn(data);
  }

  connect(name: string) {
    return new Promise<void>((resolve, reject) => {
      // Close any earlier connection first. A forgotten socket keeps this
      // account's place on the line, and the server then refuses every new
      // connection as "already online" -- an endless retry loop.
      const previous = this.ws;
      if (previous) {
        this.ws = null;
        previous.onopen = null;
        previous.onmessage = null;
        previous.onerror = null;
        previous.onclose = null;
        try {
          previous.close();
        } catch {
          // already closed
        }
      }
      this.closing = false;
      const viaRelay = relayPreferred();
      const ws = viaRelay ? (new RelaySocket() as unknown as WebSocket) : new WebSocket(LINE);
      this.ws = ws;
      let done = false;
      let registered = false;
      // If the direct line hasn't answered in 8 seconds, switch to the backup route.
      const giveUp = viaRelay
        ? 0
        : window.setTimeout(() => {
            if (done) return;
            done = true;
            preferRelay();
            ws.onclose = null;
            ws.onerror = null;
            try {
              ws.close();
            } catch {
              // already closed
            }
            if (this.ws === ws) this.ws = null;
            reject(new Error("switch"));
          }, 8000);
      const failed = () => {
        if (done) return;
        done = true;
        window.clearTimeout(giveUp);
        if (!viaRelay) {
          preferRelay();
          reject(new Error("switch"));
        } else reject(new Error("Can't reach the call line"));
      };
      ws.onopen = () => this.send({ type: "register", name, label: label || undefined, takeover: true, replace: true, session: seatId });
      ws.onerror = () => failed();
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.cleanup("signaling-lost");
        failed();
        if (registered) this.emit("disconnected", { intentional: this.closing });
      };
      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.type === "registered") {
          window.clearTimeout(giveUp);
          this.me = String(msg.userId ?? "");
          this.myName = String(msg.name ?? name);
          if (Array.isArray(msg.iceServers) && msg.iceServers.length) this.iceServers = msg.iceServers as RTCIceServer[];
          done = true;
          registered = true;
          resolve();
          return;
        }
        if (msg.type === "register-error") {
          done = true;
          this.closing = true;
          ws.close();
          reject(new Error(String(msg.reason ?? "The name was refused")));
          return;
        }
        if (msg.type === "replaced") {
          // This account opened the line on a newer screen; step aside quietly.
          this.closing = true;
          this.emit("replaced");
          return;
        }
        if (msg.type === "presence") {
          const online = Array.isArray(msg.online) ? (msg.online as { id?: string; name?: string }[]) : [];
          this.online = online
            .filter((person) => person.id && person.id !== this.me)
            .map((person) => ({ id: String(person.id), name: String(person.name ?? "") }));
          this.emit("presence", this.online);
          this.reRingIfBack();
          return;
        }
        void this.handle(msg).catch(() => this.end("error", true));
      };
    });
  }

  // If the person we're ringing reconnects (e.g. opened Porchbook from the
  // call notification while an older connection closed), ring them again on
  // the new connection.
  private reRingIfBack() {
    const slot = this.slot;
    if (!slot || slot.role !== "caller" || slot.peerFp || !slot.ringCommit) return;
    const present = this.online.some((person) => person.id === slot.peer);
    if (!present) {
      slot.peerGone = true;
      return;
    }
    if (!slot.peerGone) return;
    slot.peerGone = false;
    this.sendPeer("ring", { video: slot.video, commit: slot.ringCommit });
  }

  disconnect() {
    this.closing = true;
    this.end("hangup", true);
    this.ws?.close();
  }

  private send(message: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendPeer(type: string, extra?: Record<string, unknown>) {
    const slot = this.slot;
    if (!slot) return;
    this.send({ type, to: slot.peer, callId: slot.id, ...extra });
  }

  async call(peer: string, peerName: string, video: boolean) {
    if (this.slot) throw new Error("Already in a call");
    const slot: Slot = { id: uuid(), peer, peerName, video, role: "caller", pendingIce: [] };
    this.slot = slot;
    this.emit("state", "preparing");
    try {
      slot.cert = (await RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" } as Algorithm)) as Cert;
      slot.myFp = certFp(slot.cert);
      slot.local = await this.media(video);
    } catch (error) {
      this.cleanup(error instanceof DOMException && error.name === "NotAllowedError" ? "no-permission" : "error");
      throw error;
    }
    if (this.slot !== slot) return;
    this.emit("local", slot.local);
    slot.ringCommit = hex(await sha256(slot.myFp ?? ""));
    this.sendPeer("ring", { video, commit: slot.ringCommit });
    this.emit("state", "ringing");
    slot.timer = window.setTimeout(() => this.end("no-answer", true), 45000);
  }

  async accept() {
    const slot = this.slot;
    if (!slot || slot.role !== "callee" || slot.accepted) return;
    slot.accepted = true;
    window.clearTimeout(slot.timer);
    this.emit("state", "connecting");
    try {
      slot.cert = (await RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" } as Algorithm)) as Cert;
      slot.myFp = certFp(slot.cert);
      slot.local = await this.media(slot.video);
    } catch (error) {
      this.end(error instanceof DOMException && error.name === "NotAllowedError" ? "no-permission" : "error", true);
      return;
    }
    if (this.slot !== slot) return;
    this.emit("local", slot.local);
    this.peer();
    this.sendPeer("accept", { fp: slot.myFp });
  }

  decline() {
    if (!this.slot) return;
    this.sendPeer("decline");
    this.cleanup("declined");
  }

  hangup() {
    this.end("hangup", true);
  }

  setMuted(muted: boolean) {
    this.slot?.local?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setCameraOff(off: boolean) {
    this.slot?.local?.getVideoTracks().forEach((track) => {
      track.enabled = !off;
    });
    if (!off) this.sendPeer("camera", { on: true });
  }

  /** A voice call turns into a video call: start the camera and send it down the video lane. */
  async startCamera(): Promise<boolean> {
    const slot = this.slot;
    if (!slot?.pc || !slot.local) return false;
    if (slot.local.getVideoTracks().length) {
      this.setCameraOff(false);
      return true;
    }
    let track: MediaStreamTrack | undefined;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })).getVideoTracks()[0];
    } catch {
      return false;
    }
    if (!track || this.slot !== slot || !slot.pc) {
      track?.stop();
      return false;
    }
    const lane = slot.pc.getTransceivers().find((item) => item.receiver.track.kind === "video");
    if (!lane) {
      track.stop();
      return false;
    }
    if (lane.direction === "recvonly" || lane.direction === "inactive") lane.direction = "sendrecv";
    await lane.sender.replaceTrack(track);
    slot.local.addTrack(track);
    slot.video = true;
    this.emit("local", new MediaStream(slot.local.getTracks()));
    this.sendPeer("camera", { on: true });
    return true;
  }

  private async handle(msg: Record<string, unknown>) {
    if (msg.type === "ring") {
      if (this.slot) {
        this.send({ type: "busy", to: msg.from, callId: msg.callId });
        return;
      }
      const slot: Slot = {
        id: String(msg.callId ?? ""),
        peer: String(msg.from ?? ""),
        peerName: String(msg.fromName ?? msg.from ?? "Someone"),
        video: Boolean(msg.video),
        role: "callee",
        commit: String(msg.commit ?? ""),
        pendingIce: [],
      };
      this.slot = slot;
      slot.timer = window.setTimeout(() => this.cleanup("missed"), 45000);
      this.emit("incoming", { name: slot.peerName, video: slot.video });
      return;
    }
    const slot = this.slot;
    if (!slot || msg.callId !== slot.id || msg.from !== slot.peer) return;
    switch (msg.type) {
      case "accept": {
        if (slot.role !== "caller" || slot.peerFp || typeof msg.fp !== "string") return;
        window.clearTimeout(slot.timer);
        slot.peerFp = msg.fp.toUpperCase();
        this.emit("state", "connecting");
        this.peer();
        if (!slot.pc) return;
        await slot.pc.setLocalDescription(await slot.pc.createOffer());
        this.sendPeer("offer", { sdp: slot.pc.localDescription?.sdp });
        return;
      }
      case "offer": {
        if (slot.role !== "callee" || !slot.pc || typeof msg.sdp !== "string") return;
        const fp = sdpFp(msg.sdp);
        if (!fp || hex(await sha256(fp)) !== slot.commit) return this.end("security-check-failed", true);
        slot.peerFp = fp;
        await slot.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        slot.local?.getTracks().forEach((track) => slot.pc?.addTrack(track, slot.local as MediaStream));
        // Keep the video lane open both ways (a voice call can turn the camera on later).
        for (const lane of slot.pc.getTransceivers()) {
          if (lane.receiver.track.kind !== "video" || lane.sender.track) continue;
          lane.direction = "sendrecv";
          if (slot.local) (lane.sender as RTCRtpSender & { setStreams?: (...s: MediaStream[]) => void }).setStreams?.(slot.local);
        }
        await slot.pc.setLocalDescription(await slot.pc.createAnswer());
        this.sendPeer("answer", { sdp: slot.pc.localDescription?.sdp });
        await this.flush();
        return this.emojis();
      }
      case "answer": {
        if (slot.role !== "caller" || !slot.pc || typeof msg.sdp !== "string") return;
        if (sdpFp(msg.sdp) !== slot.peerFp) return this.end("security-check-failed", true);
        await slot.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        await this.flush();
        return this.emojis();
      }
      case "ice":
        if (slot.pc?.remoteDescription) await slot.pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => undefined);
        else if (msg.candidate) slot.pendingIce.push(msg.candidate as RTCIceCandidateInit);
        return;
      case "camera":
        this.emit("peer-camera", Boolean(msg.on));
        return;
      case "decline":
        return this.cleanup("declined");
      case "busy":
        return this.cleanup("busy");
      case "unavailable":
        return this.cleanup("unavailable");
      case "hangup":
        return this.cleanup("remote-hangup");
      default:
        return;
    }
  }

  private media(video: boolean) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: "user" } : false,
    });
  }

  private peer() {
    const slot = this.slot;
    if (!slot?.cert) return;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      certificates: [slot.cert],
      iceTransportPolicy: this.allowP2P ? "all" : "relay",
    });
    slot.pc = pc;
    if (slot.role === "caller" && slot.local) {
      slot.local.getTracks().forEach((track) => pc.addTrack(track, slot.local as MediaStream));
      // A voice call still opens a (quiet) video lane, so either side can turn the camera on mid-call.
      if (!slot.local.getVideoTracks().length) pc.addTransceiver("video", { direction: "sendrecv", streams: [slot.local] });
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendPeer("ice", { candidate: event.candidate });
    };
    // Every track the other side sends joins one stream (sound now, their camera whenever it comes on).
    pc.ontrack = (event) => {
      if (!slot.remote) slot.remote = event.streams[0] ?? new MediaStream();
      if (!slot.remote.getTracks().includes(event.track)) slot.remote.addTrack(event.track);
      this.emit("remote", slot.remote);
    };
    pc.onconnectionstatechange = () => {
      if (this.slot !== slot) return;
      const next = pc.connectionState;
      if (next === "connected") {
        window.clearTimeout(slot.dropTimer);
        this.emit("state", "connected");
        void this.route().then((route) => this.emit("route", route));
      } else if (next === "disconnected") {
        this.emit("state", "reconnecting");
        slot.dropTimer = window.setTimeout(() => this.end("connection-lost", true), 15000);
      } else if (next === "failed") this.end("connection-failed", true);
    };
  }

  private async flush() {
    const slot = this.slot;
    if (!slot?.pc) return;
    for (const candidate of slot.pendingIce.splice(0)) await slot.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  private async emojis() {
    const slot = this.slot;
    if (!slot?.myFp || !slot.peerFp) return;
    const [first, second] = slot.role === "caller" ? [slot.myFp, slot.peerFp] : [slot.peerFp, slot.myFp];
    const hash = await sha256(`${first}|${second}`);
    this.emit("emojis", [0, 1, 2, 3].map((index) => EMOJI[hash[index] % EMOJI.length]).join(" "));
  }

  private async route() {
    const pc = this.slot?.pc;
    if (!pc) return "";
    const stats = await pc.getStats();
    let pair: RTCStats | undefined;
    stats.forEach((report) => {
      const row = report as RTCStats & { selectedCandidatePairId?: string; nominated?: boolean; state?: string };
      if (row.type === "transport" && row.selectedCandidatePairId) pair = stats.get(row.selectedCandidatePairId);
      if (!pair && row.type === "candidate-pair" && row.nominated && row.state === "succeeded") pair = row;
    });
    const localId = (pair as (RTCStats & { localCandidateId?: string }) | undefined)?.localCandidateId;
    const local = localId ? (stats.get(localId) as (RTCStats & { candidateType?: string }) | undefined) : undefined;
    return local?.candidateType === "relay" ? "Through a relay" : "Direct";
  }

  private end(reason: string, notify: boolean) {
    if (notify) this.sendPeer("hangup");
    this.cleanup(reason);
  }

  private cleanup(reason: string) {
    const slot = this.slot;
    if (!slot) return;
    window.clearTimeout(slot.timer);
    window.clearTimeout(slot.dropTimer);
    slot.pc?.close();
    slot.local?.getTracks().forEach((track) => track.stop());
    this.slot = null;
    this.emit("ended", reason);
  }
}

const client = new LineClient();

let view: LineView = {
  phase: "idle",
  note: "",
  name: typeof localStorage === "undefined" ? "" : String(readStore("name", "") ?? ""),
  me: "",
  people: [],
  direct: client.allowP2P,
  call: null,
};
let retryTimer = 0;
let wanted: { key: string; label: string; video: boolean; until?: number } | null = null;
let seatId = "";
let yielded = false;
let label = "";
const listeners = new Set<() => void>();

function publish(next: Partial<LineView>) {
  view = { ...view, ...next };
  listeners.forEach((listener) => listener());
  placeWanted();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function patchCall(next: Partial<NonNullable<LineView["call"]>>) {
  if (!view.call) return;
  publish({ call: { ...view.call, ...next } });
}

client.on("presence", (people) => {
  publish({ people: people as Person[] });
  // Someone rung by notification may have just opened Porchbook.
  placeWanted();
});
client.on("disconnected", (data) => {
  if (yielded) return; // stepped aside for a newer screen; keep that note
  const intentional = Boolean((data as { intentional?: boolean } | undefined)?.intentional);
  publish({ people: [], phase: intentional ? "idle" : "opening", note: intentional ? "" : "The line is still opening.", me: intentional ? "" : view.me });
  if (!intentional && readStore("auto", false)) retry(3000);
});
client.on("replaced", () => {
  yielded = true;
  window.clearTimeout(retryTimer);
  publish({
    phase: "idle",
    note: "Calls moved to your newer screen. Tap Refresh to bring them back here.",
    me: "",
    people: [],
    call: null,
  });
});
client.on("incoming", (data) => {
  const incoming = data as { name?: string; video?: boolean };
  publish({
    call: {
      name: incoming.name || "Someone",
      video: Boolean(incoming.video),
      incoming: true,
      status: "Calling you",
      emojis: "",
      route: "",
      muted: false,
      cameraOff: !incoming.video,
      speaker: Boolean(incoming.video),
      local: null,
      remote: null,
    },
  });
});
client.on("state", (status) => patchCall({ status: STATUS[String(status)] ?? String(status), incoming: false }));
client.on("local", (stream) => patchCall({ local: stream as MediaStream }));
// Call sound plays from one app-wide element, so it keeps going when the
// member leaves the Calls screen (e.g. taps Tour) during a call.
let callSound: HTMLAudioElement | null = null;
function playCallSound(stream: MediaStream | null) {
  if (typeof window === "undefined") return;
  if (!stream) {
    if (callSound) {
      callSound.pause();
      callSound.srcObject = null;
    }
    return;
  }
  if (!callSound) {
    callSound = document.createElement("audio");
    callSound.autoplay = true;
    callSound.setAttribute("playsinline", "");
    callSound.style.display = "none";
    document.body.appendChild(callSound);
  }
  if (callSound.srcObject !== stream) callSound.srcObject = stream;
  void callSound.play().catch(() => undefined);
}
client.on("remote", (stream) => {
  playCallSound(stream as MediaStream);
  patchCall({ remote: stream as MediaStream });
  if (view.call) {
    routeSound(view.call.speaker);
    holdRoute();
  }
});
client.on("emojis", (emojis) => patchCall({ emojis: String(emojis ?? "") }));
// Their camera came on mid-call: show the call as video.
client.on("peer-camera", (on) => {
  if (on) patchCall({ video: true });
});
client.on("route", (route) => patchCall({ route: String(route ?? "") }));
client.on("ended", (reason) => {
  playCallSound(null);
  soundBack();
  publish({ call: null, note: ENDED[String(reason)] ?? "Call ended" });
});

function placeWanted() {
  if (!wanted || view.phase !== "online" || view.call) return;
  if (wanted.until && Date.now() > wanted.until) {
    const who = wanted.label || "They";
    wanted = null;
    window.clearTimeout(ringTimer);
    publish({ note: `${who} didn't open Porchbook in time. Try again a little later.` });
    return;
  }
  const key = lineHandle(wanted.key);
  const lower = key.toLowerCase();
  // Phones join the line under their Porchbook account id. The call server
  // trims handles to 30 characters and lowercases its ids, so compare the same way.
  const person =
    view.people.find((item) => item.id === lower || item.name.trim() === key) ??
    view.people.find((item) => item.name.trim().toLowerCase() === lower);
  if (!person) return;
  const video = wanted.video;
  const shown = wanted.label || person.name;
  wanted = null;
  window.clearTimeout(ringTimer);
  void startCall(person.id, shown, video);
}

function retry(delay: number) {
  window.clearTimeout(retryTimer);
  if (yielded) return;
  const name = String(readStore("name", "") ?? "");
  if (name.length < 2 || !readStore("auto", false)) return;
  retryTimer = window.setTimeout(() => {
    void goOnline(name);
  }, delay);
}

export function savedCallName() {
  return String(readStore("name", "") ?? "");
}

let connecting: Promise<void> | null = null;

export async function goOnline(name: string) {
  const clean = name.trim().slice(0, 128);
  if (yielded || clean.length < 2) return;
  // One join at a time; a second call while one is in flight would open a
  // competing connection under the same account.
  if (connecting) return connecting;
  connecting = joinLine(clean).finally(() => {
    connecting = null;
  });
  return connecting;
}

async function joinLine(clean: string) {
  writeStore("name", clean);
  writeStore("auto", true);
  publish({ phase: "opening", note: "The line is still opening.", name: clean });
  try {
    await client.connect(clean);
    publish({ phase: "online", note: "", me: label || clean, name: clean });
  } catch (error) {
    if (yielded) return;
    const message = error instanceof Error ? error.message : "Can't reach the call line";
    if (message === "switch") {
      // Direct line blocked on this network: try the backup route right away.
      publish({ phase: "opening", note: "The line is still opening." });
      retry(200);
      return;
    }
    const taken = /taken|already|in use/i.test(message);
    publish({ phase: "opening", note: taken ? "This account is open on another screen. This one is taking over." : "The line is still opening." });
    if (taken) retry(1200);
    else if (!/name/i.test(message)) retry(5000);
    else writeStore("auto", false);
  }
}

export function claimLine(userId: string, displayName = "") {
  const id = userId.trim();
  if (id.length < 2) return;
  if ((view.phase === "online" || view.phase === "opening") && view.name === id) return;
  seatId = uuid();
  yielded = false;
  label = displayName.trim();
  writeStore("seat", { userId: id, session: seatId, stamp: Date.now() });
  void goOnline(id);
}

function releaseForNewer() {
  if (!seatId) return;
  yielded = true;
  window.clearTimeout(retryTimer);
  client.disconnect();
  publish({ phase: "idle", note: "This account is now open on a newer screen.", me: "", people: [], call: null });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== "pbcalls:seat" || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue) as { session?: string; userId?: string };
      if (next.session && next.session !== seatId && next.userId && next.userId === view.name) releaseForNewer();
    } catch {
      /* ignore a bad seat */
    }
  });
}

export function goOffline() {
  window.clearTimeout(retryTimer);
  writeStore("auto", false);
  client.disconnect();
  publish({ phase: "idle", note: "", me: "", people: [], call: null });
}

export function setDirect(on: boolean) {
  client.allowP2P = on;
  writeStore("p2p", on);
  publish({ direct: on });
}

export function wakeLine() {
  const name = savedCallName();
  if (view.phase === "online" || view.phase === "opening") return;
  if (name.length < 2 || !readStore("auto", false)) return;
  void goOnline(name);
}

/** The handle the call server keeps for a name or account id (see server.js). */
export function lineHandle(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 30);
}

// How long to wait for someone rung by notification to open Porchbook.
const RING_WAIT_MS = 75000;
let ringTimer = 0;
let declineWatch = 0;

// While ringing someone's phone, check every few seconds whether they tapped Decline.
function watchForDecline(key: string, who: string) {
  window.clearInterval(declineWatch);
  const mine = wanted;
  declineWatch = window.setInterval(() => {
    if (!wanted || wanted !== mine || !wanted.until || Date.now() > wanted.until) {
      window.clearInterval(declineWatch);
      return;
    }
    void import("@/lib/porch/line-ring")
      .then(({ ringStatus }) => ringStatus({ data: { to: key } }))
      .then((status) => {
        if (!status?.declined || !wanted || wanted !== mine) return;
        wanted = null;
        window.clearTimeout(ringTimer);
        window.clearInterval(declineWatch);
        publish({ note: `${who} can't take your call right now.` });
      })
      .catch(() => undefined);
  }, 3000);
}

export function askLine(key: string, video: boolean, label = "") {
  wanted = { key, label, video };
  placeWanted();
  if (!wanted || view.phase !== "online") return;
  const who = label || "They";
  // Not on the line: ring their phone with a notification and wait for them.
  if (!/^[A-Za-z0-9]{16,}$/.test(key)) {
    publish({ note: `${who} doesn't have Porchbook open right now. Try again when they're on.` });
    return;
  }
  wanted.until = Date.now() + RING_WAIT_MS;
  publish({ note: `Ringing ${who}'s phone… waiting for them to open Porchbook.` });
  window.clearTimeout(ringTimer);
  ringTimer = window.setTimeout(() => placeWanted(), RING_WAIT_MS + 500);
  watchForDecline(key, who);
  void import("@/lib/porch/line-ring")
    .then(({ ringOffline }) => ringOffline({ data: { to: key, video } }))
    .then((result) => {
      if (!wanted || !result) return;
      if (result.reached === 0) {
        wanted = null;
        window.clearTimeout(ringTimer);
        publish({ note: `${who} doesn't have Porchbook open and hasn't turned on Porchbook alerts, so their phone can't ring. Try again when they're on.` });
      }
    })
    .catch(() => undefined);
}

export function cancelRinging() {
  wanted = null;
  window.clearTimeout(ringTimer);
  window.clearInterval(declineWatch);
  publish({ note: "" });
}

async function startCall(id: string, name: string, video: boolean) {
  publish({
    note: "",
    call: {
      name,
      video,
      incoming: false,
      status: "Starting…",
      emojis: "",
      route: "",
      muted: false,
      cameraOff: !video,
      speaker: video,
      local: null,
      remote: null,
    },
  });
  try {
    await client.call(id, name, video);
  } catch {
    publish({ call: null, note: "The call could not start." });
  }
}

export function callPerson(id: string, name: string, video: boolean) {
  void startCall(id, name, video);
}

export function acceptCall() {
  void client.accept();
}
export function declineCall() {
  client.decline();
}
export function hangUp() {
  client.hangup();
}
export function muteCall(muted: boolean) {
  client.setMuted(muted);
  patchCall({ muted });
}
/** The Porchbook app can send call sound to the earpiece or the loudspeaker; a web browser can't choose. */
type NativeSound = { speaker?: (on: boolean) => void; soundDone?: () => void };
function nativeSound(): NativeSound | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { PorchMic?: NativeSound }).PorchMic;
  return bridge && typeof bridge.speaker === "function" ? bridge : null;
}
export function canChooseEarpiece() {
  return Boolean(nativeSound());
}
function routeSound(on: boolean) {
  try {
    nativeSound()?.speaker?.(on);
  } catch {
    /* the phone keeps its choice */
  }
}
// Right after a call connects the phone's own call handling can switch the sound back to the
// loudspeaker: apply the choice again a few times so it sticks.
let routeTimers: number[] = [];
function holdRoute() {
  routeTimers.forEach((t) => window.clearTimeout(t));
  routeTimers = [400, 1200, 2500, 5000].map((ms) =>
    window.setTimeout(() => {
      if (view.call) routeSound(view.call.speaker);
    }, ms),
  );
}
function soundBack() {
  routeTimers.forEach((t) => window.clearTimeout(t));
  routeTimers = [];
  try {
    nativeSound()?.soundDone?.();
  } catch {
    /* older app: nothing to give back */
  }
}
export function speakerCall(on: boolean) {
  patchCall({ speaker: on });
  routeSound(on);
}

export function cameraCall(off: boolean) {
  if (!off && view.call && !view.call.local?.getVideoTracks().length) {
    // A voice call: turn the camera on and make it a video call (and the sound comes out loud).
    patchCall({ cameraOff: false, video: true });
    speakerCall(true);
    void client.startCamera().then((ok) => {
      if (!ok) patchCall({ cameraOff: true });
    });
    return;
  }
  client.setCameraOff(off);
  patchCall({ cameraOff: off });
}

const serverView: LineView = { phase: "idle", note: "", name: "", me: "", people: [], direct: true, call: null };

export function useLine() {
  return useSyncExternalStore(subscribe, () => view, () => serverView);
}
