/**
 * Where the radio's sound work runs: its own server, Porchbook Audio (Render),
 * kept apart from the calls server so heavy jobs never slow a call down.
 */
export function audioWorkerBase() {
  return (process.env.AUDIO_WORKER_URL || "https://porchbook-audio.onrender.com").replace(/\/+$/, "");
}

/** The calls server's older copy of the worker (used for video sound until Porchbook Audio is up). */
export function callsWorkerBase() {
  const relay = process.env.CALL_RELAY_URL || "https://porchbook-calls.onrender.com/relay";
  return relay.replace(/\/relay\/?$/, "");
}

let known: { base: string; at: number } | null = null;
/** Porchbook Audio if it answers, otherwise the calls server (remembered for 10 minutes). */
export async function videoWorkerBase() {
  if (known && Date.now() - known.at < 10 * 60 * 1000) return known.base;
  let base = callsWorkerBase();
  try {
    const res = await fetch(`${audioWorkerBase()}/fm/status`, { signal: AbortSignal.timeout(6000) });
    const s = (await res.json()) as { mixer?: number };
    if (s.mixer) base = audioWorkerBase();
  } catch {
    /* not up (or asleep): the calls server still does video sound */
  }
  known = { base, at: Date.now() };
  return base;
}
