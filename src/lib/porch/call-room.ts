import { callPoll, callSignal, callVoicePull, callVoicePush, type CallSignalKind } from "@/lib/porch/groups";
import { hearRemote, playRemoteAudio } from "@/lib/porch/call-audio";

export type CallDiag = {
  signaling: "CONNECTED" | "FAILED" | "WAITING";
  stun: "PASS" | "FAIL" | "UNKNOWN";
  turn: "PASS" | "FAIL";
  turnUdp: "PASS" | "FAIL" | "UNKNOWN";
  turnTcp: "PASS" | "FAIL" | "UNKNOWN";
  turnTls: "PASS" | "FAIL" | "UNKNOWN";
  localCandidates: number;
  remoteCandidates: number;
  relayCandidates: number;
  hostCandidates: number;
  srflxCandidates: number;
  relayTest: "WAITING" | "TESTING" | "PASS" | "FAIL";
  iceState: string;
  peerState: string;
  signalingState: string;
  audioTracks: "YES" | "NO";
  videoTracks: "YES" | "NO";
  remoteAudio: "YES" | "NO";
  remoteVideo: "YES" | "NO";
  lastIceError: string;
  lastSignalError: string;
  note: string;
};

export type CallTile = {
  id: string;
  name: string;
  stream: MediaStream | null;
  state: string;
};

type Slot = {
  pc: RTCPeerConnection;
  name: string;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteReady: boolean;
  pending: RTCIceCandidateInit[];
  stream: MediaStream | null;
  state: string;
  tries: number;
};

const ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
];

function iceJSON(candidate: RTCIceCandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment ?? undefined,
  };
}

function mark(slot: Slot) {
  const ice = slot.pc.iceConnectionState;
  const box = slot.pc.connectionState;
  if (ice === "connected" || ice === "completed" || box === "connected") slot.state = "connected";
  else if (ice === "failed" || box === "failed") slot.state = "failed";
  else if (ice === "disconnected" || box === "disconnected") slot.state = "disconnected";
  else slot.state = ice === "checking" || box === "connecting" ? "connecting" : "new";
}

export function startCall(opts: {
  groupId: number;
  selfId: string;
  callId?: number;
  name: string;
  stream: MediaStream;
  onTiles: (tiles: CallTile[]) => void;
  onError?: (message: string) => void;
  onLink?: (level: "excellent" | "good" | "weak" | "lost") => void;
  onVoice?: (hearing: boolean) => void;
  onDiag?: (diag: CallDiag) => void;
}): { stop: () => void; replaceStream: (stream: MediaStream) => void } {
  const slots = new Map<string, Slot>();
  const callId = opts.callId || 0;
  const missed = new Map<number, number>();
  const opening = new Set<string>();
  let ice: RTCIceServer[] = ICE;
  let turnConfigured = false;
  let icePolicy: RTCIceTransportPolicy = "all";
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "1") icePolicy = "relay";
  let local = opts.stream;
  const diag: CallDiag = {
    signaling: "WAITING",
    stun: "UNKNOWN",
    turn: "FAIL",
    turnUdp: "FAIL",
    turnTcp: "FAIL",
    turnTls: "FAIL",
    localCandidates: 0,
    remoteCandidates: 0,
    relayCandidates: 0,
    hostCandidates: 0,
    srflxCandidates: 0,
    relayTest: icePolicy === "relay" ? "TESTING" : "WAITING",
    iceState: "new",
    peerState: "new",
    signalingState: "stable",
    audioTracks: local.getAudioTracks().length ? "YES" : "NO",
    videoTracks: local.getVideoTracks().length ? "YES" : "NO",
    remoteAudio: "NO",
    remoteVideo: "NO",
    lastIceError: "",
    lastSignalError: callId ? "" : "No call id yet.",
    note: "Porchbook is waiting for real TURN credentials.",
  };
  const iceReady = fetch("/api/calling/ice-config", { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { iceServers?: RTCIceServer[]; turn?: boolean; reason?: string } | null) => {
      if (data?.iceServers?.length) ice = data.iceServers;
      turnConfigured = Boolean(data?.turn);
      if (!turnConfigured) {
        diag.turn = "FAIL";
        diag.turnUdp = "FAIL";
        diag.turnTcp = "FAIL";
        diag.turnTls = "FAIL";
        diag.note = data?.reason || "Porchbook is waiting for real TURN credentials.";
        if (icePolicy === "relay") {
          diag.relayTest = "FAIL";
          diag.lastIceError = "Relay-only test cannot run. No TURN credentials.";
          console.error("TURN RELAY TEST FAIL", { reason: diag.lastIceError });
        }
      }
      publish();
    })
    .catch((err: unknown) => {
      diag.lastIceError = err instanceof Error ? err.message : "ICE config request failed";
      diag.turn = "FAIL";
      if (icePolicy === "relay") diag.relayTest = "FAIL";
      console.error("ICE CONFIG FAILED", diag.lastIceError);
      publish();
    });
  let since = 0;
  let voiceSince = 0;
  let stopped = false;
  let relay = true;
  let heardDirect = false;
  let timer = 0;
  let statsTimer = 0;
  let weak = false;
  let seenLost = 0;
  const playCtx = new AudioContext();
  const capCtx = new AudioContext();
  let nextAt = 0;
  const playing: AudioBufferSourceNode[] = [];
  void playCtx.resume().catch(() => undefined);
  void capCtx.resume().catch(() => undefined);

  function hush() {
    for (const node of playing) {
      try {
        node.stop();
      } catch {
        /* already finished */
      }
    }
    playing.length = 0;
    nextAt = 0;
  }

  function playPcm(payload: string) {
    if (!relay || stopped) return;
    let binary = "";
    try {
      binary = atob(payload);
    } catch {
      return;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    if (!pcm.length) return;
    const buffer = playCtx.createBuffer(1, pcm.length, 8000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;
    const node = playCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(playCtx.destination);
    const start = Math.max(playCtx.currentTime + 0.02, nextAt);
    node.start(start);
    nextAt = start + buffer.duration;
    playing.push(node);
    opts.onVoice?.(true);
  }

  function down(input: Float32Array, fromRate: number) {
    const ratio = fromRate / 8000;
    const length = Math.max(1, Math.floor(input.length / ratio));
    const out = new Int16Array(length);
    for (let i = 0; i < length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] || 0));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  const source = capCtx.createMediaStreamSource(local);
  const proc = capCtx.createScriptProcessor(2048, 1, 1);
  const sink = capCtx.createGain();
  sink.gain.value = 0;
  source.connect(proc);
  proc.connect(sink);
  sink.connect(capCtx.destination);
  let bucket: number[] = [];
  proc.onaudioprocess = (event) => {
    if (!relay || stopped) return;
    if (capCtx.state === "suspended") void capCtx.resume().catch(() => undefined);
    const track = local.getAudioTracks()[0];
    if (track && !track.enabled) return;
    const pcm = down(event.inputBuffer.getChannelData(0), capCtx.sampleRate || 48000);
    for (let i = 0; i < pcm.length; i += 1) bucket.push(pcm[i]);
    if (bucket.length < 1600) return;
    const slice = Int16Array.from(bucket.splice(0, 1600));
    const bytes = new Uint8Array(slice.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    void callVoicePush({ data: { groupId: opts.groupId, payload: btoa(binary) } }).catch(() => undefined);
  };

  function lineOpen() {
    return heardDirect;
  }

  function quietRelay() {
    if (!relay) return;
    relay = false;
    hush();
    hearRemote(true);
    try {
      proc.disconnect();
      source.disconnect();
    } catch {
      /* already closed */
    }
  }

  async function noteAudio(slot: Slot) {
    if (heardDirect || !relay) return;
    const stats = await slot.pc.getStats();
    let packets = 0;
    stats.forEach((report) => {
      if (report.type !== "inbound-rtp") return;
      const row = report as { kind?: string; packetsReceived?: number };
      if (row.kind === "audio") packets += row.packetsReceived ?? 0;
    });
    if (packets > 8) {
      heardDirect = true;
      quietRelay();
    }
  }

  function emit() {
    opts.onTiles(
      [...slots.entries()].map(([id, slot]) => ({
        id,
        name: slot.name,
        stream: slot.stream,
        state: slot.state,
      })),
    );
  }

  function candidateType(line: string) {
    return / typ (host|srflx|prflx|relay)/.exec(line)?.[1] ?? "unknown";
  }

  function publish() {
    const slot = [...slots.values()][0];
    const pc = slot?.pc;
    diag.iceState = pc?.iceConnectionState ?? diag.iceState;
    diag.peerState = pc?.connectionState ?? diag.peerState;
    diag.signalingState = pc?.signalingState ?? diag.signalingState;
    diag.audioTracks = local.getAudioTracks().length ? "YES" : "NO";
    diag.videoTracks = local.getVideoTracks().length ? "YES" : "NO";
    diag.remoteAudio = [...slots.values()].some((item) => item.stream?.getAudioTracks().length) ? "YES" : "NO";
    diag.remoteVideo = [...slots.values()].some((item) => item.stream?.getVideoTracks().length) ? "YES" : "NO";
    if (!turnConfigured) {
      diag.turn = "FAIL";
      diag.turnUdp = "FAIL";
      diag.turnTcp = "FAIL";
      diag.turnTls = "FAIL";
      diag.note = "Porchbook is waiting for real TURN credentials.";
    } else if (diag.relayCandidates > 0) {
      diag.turn = "PASS";
      diag.note = "";
    }
    opts.onDiag?.({ ...diag });
  }

  function send(toId: string, kind: CallSignalKind, payload: unknown) {
    const messageType = kind === "offer" ? "SDP_OFFER" : kind === "answer" ? "SDP_ANSWER" : "ICE_CANDIDATE";
    if (!callId) {
      diag.lastSignalError = "No call id. Signaling was not sent.";
      diag.signaling = "FAILED";
      console.error("SIGNAL NOT SENT", { messageType, recipientId: toId, reason: "missing callId" });
      publish();
      return;
    }
    const envelope = {
      callId,
      senderId: opts.selfId,
      recipientId: toId,
      timestamp: Date.now(),
      messageType,
      body: payload,
    };
    const body = JSON.stringify(envelope);
    if (body.length > 24000) {
      diag.lastSignalError = "Signaling message was too large and was not sent.";
      diag.signaling = "FAILED";
      console.error("SIGNAL TOO LARGE", { callId, messageType, bytes: body.length });
      publish();
      return;
    }
    console.log("SIGNAL SENT", { callId, senderId: opts.selfId, recipientId: toId, timestamp: envelope.timestamp, messageType });
    void callSignal({ data: { groupId: opts.groupId, toId, kind, payload: body } }).catch((err: unknown) => {
      diag.lastSignalError = err instanceof Error ? err.message : "Signal send failed";
      diag.signaling = "FAILED";
      console.error("SIGNAL FAILED", { callId, messageType, error: diag.lastSignalError });
      publish();
    });
  }

  function attachSenders(pc: RTCPeerConnection) {
    let added = false;
    for (const track of local.getTracks()) {
      const sender = pc.getSenders().find((item) => item.track?.kind === track.kind);
      if (sender) {
        if (sender.track !== track) void sender.replaceTrack(track);
      } else {
        pc.addTrack(track, local);
        added = true;
      }
    }
    return added;
  }

  async function openPeer(id: string, name: string) {
    const existing = slots.get(id);
    if (existing) {
      existing.name = name;
      return existing;
    }
    if (opening.has(id)) return;
    opening.add(id);
    try {
      await iceReady;
      if (stopped || slots.has(id)) return slots.get(id);
    const pc = new RTCPeerConnection({ iceServers: ice, iceCandidatePoolSize: 4, bundlePolicy: "max-bundle", iceTransportPolicy: icePolicy });
    const slot: Slot = {
      pc,
      name,
      makingOffer: false,
      ignoreOffer: false,
      remoteReady: false,
      pending: [],
      stream: null,
      state: "new",
      tries: 0,
    };
    slots.set(id, slot);
    const offerer = opts.selfId < id;
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log("ICE GATHERING COMPLETE", { callId, recipientId: id, signalingState: pc.signalingState, iceGatheringState: pc.iceGatheringState });
        if (diag.relayCandidates === 0) {
          diag.note = "TURN RELAY CANDIDATE NOT AVAILABLE";
          console.error("TURN RELAY CANDIDATE NOT AVAILABLE", { callId, recipientId: id });
        }
        if (diag.stun === "UNKNOWN") diag.stun = "FAIL";
        if (diag.relayCandidates === 0) diag.note = turnConfigured ? "TURN RELAY CANDIDATE NOT AVAILABLE" : "Porchbook is waiting for real TURN credentials.";
        if (icePolicy === "relay") {
          diag.relayTest = diag.relayCandidates > 0 && !diag.lastIceError ? "PASS" : "FAIL";
          if (diag.relayTest === "FAIL" && !diag.lastIceError) diag.lastIceError = "No relay candidate. TURN authentication or reachability failed.";
          console.error("TURN RELAY TEST", { callId, status: diag.relayTest, relayCandidates: diag.relayCandidates, error: diag.lastIceError });
        }
        publish();
        return;
      }
      const typ = candidateType(event.candidate.candidate);
      const protocol = event.candidate.candidate.split(" ")[2] || "";
      diag.localCandidates += 1;
      if (typ === "host") diag.hostCandidates += 1;
      if (typ === "srflx") {
        diag.srflxCandidates += 1;
        diag.stun = "PASS";
      }
      if (typ === "relay") {
        diag.relayCandidates += 1;
        diag.turn = "PASS";
        if (protocol === "udp") diag.turnUdp = "PASS";
        if (protocol === "tcp") diag.turnTcp = "PASS";
      }
      console.log("ICE CANDIDATE GENERATED", {
        callId,
        callerId: opts.selfId,
        recipientId: id,
        type: typ,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        candidate: event.candidate.candidate,
      });
      send(id, "ice", iceJSON(event.candidate));
      publish();
    };
    pc.onicecandidateerror = (event) => {
      const text = event.errorCode === 701 ? "The ICE server could not be reached (701)." : event.errorText || "ICE error";
      diag.lastIceError = `${event.errorCode || ""} ${text} ${event.url || ""}`.trim();
      console.error("ICE ERROR", {
        callId,
        code: event.errorCode,
        text: event.errorText,
        url: event.url,
        address: event.address,
        port: event.port,
      });
      if (event.errorCode === 701) console.error("ICE SERVER UNREACHABLE", { callId, url: event.url });
      if ((event.url || "").startsWith("turns:")) diag.turnTls = "FAIL";
      if ((event.url || "").includes("transport=udp")) diag.turnUdp = "FAIL";
      if ((event.url || "").includes("transport=tcp") && !(event.url || "").startsWith("turns:")) diag.turnTcp = "FAIL";
      publish();
    };
    pc.ontrack = (event) => {
      console.log("REMOTE TRACK RECEIVED", { callId, kind: event.track.kind, fromId: id });
      if (!slot.stream) slot.stream = new MediaStream();
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!slot.stream.getTracks().includes(track)) slot.stream.addTrack(track);
      }
      playRemoteAudio(slot.stream);
      emit();
    };
    const note = () => {
      mark(slot);
      console.log("ICE STATE", {
        callId,
        callerId: opts.selfId,
        recipientId: id,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      });
      if (slot.state === "connected") void noteAudio(slot);
      if (slot.state === "failed") {
        if (slot.tries < 3) {
          slot.tries += 1;
          try {
            pc.restartIce();
          } catch {
            /* the next offer starts a fresh path */
          }
          if (offerer) void offer(slot, id);
        } else {
          diag.lastIceError = "ICE failed after three restarts.";
          console.error("ICE FAILED", { callId, recipientId: id, iceConnectionState: pc.iceConnectionState });
          opts.onError?.("Unable to connect. Try the call again.");
        }
      }
      publish();
      emit();
    };
    pc.oniceconnectionstatechange = note;
    pc.onconnectionstatechange = note;
    pc.onnegotiationneeded = () => {
      const up = !!pc.currentRemoteDescription || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
      if (offerer || up) void offer(slot, id);
    };
    attachSenders(pc);
    if (offerer) void offer(slot, id);
    return slot;
    } finally {
      opening.delete(id);
    }
  }

  async function offer(slot: Slot, toId: string) {
    const pc = slot.pc;
    if (slot.makingOffer || pc.signalingState !== "stable") return;
    slot.makingOffer = true;
    try {
      console.log("SDP OFFER CREATION", { callId, recipientId: toId, signalingState: pc.signalingState });
      const desc = await pc.createOffer();
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(desc);
      console.log("SDP OFFER SENT", { callId, recipientId: toId });
      if (pc.localDescription) send(toId, "offer", pc.localDescription);
    } catch (err) {
      diag.lastSignalError = err instanceof Error ? err.message : "Offer failed";
      console.error("SDP OFFER FAILED", { callId, recipientId: toId, error: diag.lastSignalError });
      publish();
    } finally {
      slot.makingOffer = false;
    }
  }

  async function take(fromId: string, kind: CallSignalKind, payload: string) {
    const slot = slots.get(fromId);
    if (!slot) return false;
    let parsed: { callId?: number; senderId?: string; recipientId?: string; messageType?: string; body?: RTCSessionDescriptionInit | RTCIceCandidateInit } | RTCSessionDescriptionInit;
    try {
      parsed = JSON.parse(payload) as RTCSessionDescriptionInit;
    } catch {
      diag.lastSignalError = "A signaling message was not valid JSON.";
      console.error("SIGNAL PARSE FAILED", { callId, fromId, kind });
      publish();
      return true;
    }
    const envelope = parsed as { callId?: number; senderId?: string; messageType?: string; body?: RTCSessionDescriptionInit | RTCIceCandidateInit };
    const tagged = typeof envelope.callId === "number" && envelope.body;
    if (!tagged) {
      diag.lastSignalError = "Rejected a signaling message with no call id.";
      console.error("SIGNAL REJECTED", { callId, fromId, kind, reason: "missing call id" });
      publish();
      return true;
    }
    if (envelope.callId !== callId || envelope.senderId !== fromId) {
      console.error("SIGNAL REJECTED", { callId, fromId, messageCallId: envelope.callId, messageSender: envelope.senderId, reason: "another call" });
      return true;
    }
    console.log("SIGNAL RECEIVED", { callId, senderId: fromId, recipientId: opts.selfId, messageType: envelope.messageType });
    const message = envelope.body as RTCSessionDescriptionInit | RTCIceCandidateInit;
    const pc = slot.pc;
    try {
      if (kind === "ice") {
        const candidate = message as RTCIceCandidateInit;
        const typ = candidateType(candidate.candidate || "");
        diag.remoteCandidates += 1;
        if (typ === "relay") diag.relayCandidates += 1;
        console.log("ICE CANDIDATE RECEIVED", { callId, fromId, type: typ, candidate: candidate.candidate });
        if (!slot.remoteReady) {
          slot.pending.push(candidate);
          console.log("ICE CANDIDATE QUEUED", { callId, fromId, type: typ });
          return true;
        }
        await pc.addIceCandidate(candidate);
        console.log("ICE CANDIDATE ADDED", { callId, fromId, type: typ });
        publish();
        return true;
      }
      const description = message as RTCSessionDescriptionInit;
      if (description.type === "answer") console.log("SDP ANSWER RECEIVED", { callId, fromId });
      if (description.type === "offer") console.log("SDP OFFER RECEIVED", { callId, fromId });
      if (description.type === "offer" && (slot.makingOffer || pc.signalingState !== "stable")) {
        const polite = opts.selfId < fromId;
        if (!polite) {
          console.log("SDP OFFER IGNORED", { callId, fromId, reason: "impolite glare" });
          return true;
        }
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch (err) {
          diag.lastSignalError = err instanceof Error ? err.message : "Rollback failed";
          console.error("SDP ROLLBACK FAILED", { callId, fromId, error: diag.lastSignalError });
          return false;
        }
      }
      await pc.setRemoteDescription(description);
      if (description.type === "answer") console.log("SDP ANSWER APPLIED", { callId, fromId, signalingState: pc.signalingState });
      slot.remoteReady = true;
      for (const candidate of slot.pending) {
        try {
          await pc.addIceCandidate(candidate);
          console.log("ICE CANDIDATE ADDED", { callId, fromId, type: candidateType(candidate.candidate || ""), queued: true });
        } catch (err) {
          console.error("ICE CANDIDATE ADD FAILED", { callId, fromId, error: err instanceof Error ? err.message : "add failed" });
        }
      }
      slot.pending = [];
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("SDP ANSWER SENT", { callId, recipientId: fromId });
        if (pc.localDescription) send(fromId, "answer", pc.localDescription);
      }
      mark(slot);
      diag.signaling = "CONNECTED";
      publish();
      return true;
    } catch (err) {
      diag.lastSignalError = err instanceof Error ? err.message : "Signaling apply failed";
      diag.signaling = "FAILED";
      console.error("SIGNAL APPLY FAILED", { callId, fromId, kind, error: diag.lastSignalError, signalingState: pc.signalingState });
      publish();
      return false;
    }
  }

  async function tick() {
    if (stopped) return;
    if (relay) {
      void capCtx.resume().catch(() => undefined);
      void playCtx.resume().catch(() => undefined);
    }
    const page = await callPoll({ data: { groupId: opts.groupId, since, name: opts.name } });
    if (!page.ok) {
      opts.onError?.(page.error || "The call didn't connect.");
      return;
    }
    if (page.ice?.length) {
      ice = page.ice;
      turnConfigured = page.ice.some((server) => Boolean(server.username && server.credential));
      if (!turnConfigured) diag.note = "TURN RELAY CANDIDATE NOT AVAILABLE";
    }
    const live = new Set(page.peers.map((peer) => peer.id));
    for (const [id, slot] of slots) {
      if (!live.has(id)) {
        slot.pc.close();
        slots.delete(id);
      }
    }
    for (const peer of page.peers) openPeer(peer.id, peer.name);
    for (const signal of page.signals) {
      if (!slots.has(signal.fromId)) {
        const peer = page.peers.find((item) => item.id === signal.fromId);
        openPeer(signal.fromId, peer?.name ?? "Teammate");
      }
      const applied = await take(signal.fromId, signal.kind, signal.payload);
      if (applied) since = Math.max(since, signal.id);
      else {
        const tries = (missed.get(signal.id) ?? 0) + 1;
        missed.set(signal.id, tries);
        if (tries >= 5) since = Math.max(since, signal.id);
      }
    }
    for (const [id, slot] of slots) {
      if (opts.selfId < id && slot.pc.signalingState === "stable" && !slot.pc.currentRemoteDescription && !slot.makingOffer) {
        void offer(slot, id);
      }
    }
    if (lineOpen()) quietRelay();
    else if (relay) {
      const voice = await callVoicePull({ data: { groupId: opts.groupId, since: voiceSince } }).catch(() => null);
      if (voice?.ok) {
        for (const chunk of voice.chunks) {
          voiceSince = Math.max(voiceSince, chunk.id);
          playPcm(chunk.payload);
        }
      }
    }
    emit();
  }

  timer = window.setInterval(() => {
    void tick().catch(() => undefined);
  }, 400);
  void tick().catch(() => undefined);
  statsTimer = window.setInterval(() => {
    void measure().catch(() => undefined);
  }, 2000);

  async function measure() {
    if (stopped) return;
    let lost = 0;
    let received = 0;
    let jitter = 0;
    for (const slot of slots.values()) {
      const stats = await slot.pc.getStats();
      stats.forEach((report) => {
        if (report.type !== "inbound-rtp") return;
        const row = report as { packetsLost?: number; packetsReceived?: number; jitter?: number; kind?: string };
        if (row.kind && row.kind !== "audio" && row.kind !== "video") return;
        lost += row.packetsLost ?? 0;
        received += row.packetsReceived ?? 0;
        if (row.jitter) jitter = Math.max(jitter, row.jitter);
      });
    }
    if (!slots.size) {
      opts.onLink?.("lost");
      return;
    }
    const fresh = Math.max(0, lost - seenLost);
    seenLost = lost;
    const ratio = received > 0 ? fresh / Math.max(received, 1) : 0;
    const level = ratio > 0.08 || jitter > 0.09 ? "weak" : ratio > 0.03 || jitter > 0.04 ? "good" : "excellent";
    opts.onLink?.(level);
    const nextWeak = level === "weak";
    if (nextWeak === weak) return;
    weak = nextWeak;
    for (const slot of slots.values()) {
      const sender = slot.pc.getSenders().find((item) => item.track?.kind === "video");
      if (!sender) continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = weak ? 140000 : 700000;
      params.encodings[0].scaleResolutionDownBy = weak ? 2 : 1;
      try {
        await sender.setParameters(params);
      } catch {
        /* this browser keeps the current picture */
      }
    }
  }

  return {
    replaceStream(stream: MediaStream) {
      local = stream;
      for (const [id, slot] of slots) {
        const added = attachSenders(slot.pc);
        if (added && slot.pc.currentRemoteDescription) void offer(slot, id);
      }
    },
    stop() {
      stopped = true;
      relay = false;
      hush();
      try {
        proc.disconnect();
        source.disconnect();
      } catch {
        /* already closed */
      }
      void capCtx.close().catch(() => undefined);
      void playCtx.close().catch(() => undefined);
      window.clearInterval(timer);
      window.clearInterval(statsTimer);
      for (const slot of slots.values()) slot.pc.close();
      slots.clear();
      for (const track of local.getTracks()) track.stop();
    },
  };
}
