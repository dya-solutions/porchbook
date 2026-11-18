/**
 * Where a recording's sound actually ends: the last moment it is clearly
 * audible (above ~1/16 of its loudest level), plus a short breath. Used so
 * jingles and station IDs don't run on into a quiet or fading tail.
 */
export async function audibleEndSec(source: ArrayBuffer): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(source.slice(0));
    const rate = buffer.sampleRate;
    const win = Math.max(1, Math.round(rate * 0.02));
    const count = Math.floor(buffer.length / win);
    if (!count) return null;
    const levels = new Float32Array(count);
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let w = 0; w < count; w += 1) {
        let sum = 0;
        for (let i = w * win; i < (w + 1) * win; i += 1) sum += data[i] * data[i];
        levels[w] = Math.max(levels[w], Math.sqrt(sum / win));
      }
    }
    let peak = 0;
    for (const level of levels) if (level > peak) peak = level;
    if (peak <= 0) return null;
    const floor = Math.max(peak * 0.06, 0.004);
    let last = count - 1;
    while (last > 0 && levels[last] < floor) last -= 1;
    const end = ((last + 1) * win) / rate + 0.3;
    return Math.min(buffer.duration, Math.max(0.5, end));
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

export async function audibleEndOfUrl(url: string): Promise<number | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return audibleEndSec(await response.arrayBuffer());
  } catch {
    return null;
  }
}
