/** Porchbook Radio mixer settings (shared by the server and the Control Room). */

export type MixSettings = { lufs: number; peak: number; warmth: number; clarity: number; comp: number; hiss: number };
export type Loud = { i: number | null; tp: number | null; lra: number | null; noise: number | null };

export const DEFAULT_MIX: MixSettings = { lufs: -16, peak: -1.5, warmth: 0, clarity: 0, comp: 2, hiss: 1 };

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export function cleanMix(raw: unknown, base: MixSettings = DEFAULT_MIX): MixSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    lufs: Math.round(num(s.lufs, -24, -10, base.lufs) * 2) / 2,
    peak: Math.round(num(s.peak, -3, -0.5, base.peak) * 10) / 10,
    warmth: Math.round(num(s.warmth, -3, 3, base.warmth)),
    clarity: Math.round(num(s.clarity, -3, 3, base.clarity)),
    comp: Math.round(num(s.comp, 0, 3, base.comp)),
    hiss: Math.round(num(s.hiss, 0, 3, base.hiss)),
  };
}
export function cleanLoud(raw: unknown): Loud | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const v = (x: unknown) => (Number.isFinite(Number(x)) && x !== null ? Math.round(Number(x) * 10) / 10 : null);
  return { i: v(r.i), tp: v(r.tp), lra: v(r.lra), noise: v(r.noise) };
}

/** What each setting means, in the founder's words. */
export function describeMix(s: MixSettings) {
  const step = (n: number, words: string[]) => words[n] ?? words[0];
  const tilt = (n: number, more: string, less: string) => (n === 0 ? "natural" : n > 0 ? `${more} +${n}` : `${less} ${n}`);
  return [
    `loudness ${s.lufs} LUFS`,
    `peak limit ${s.peak} dB`,
    `warmth ${tilt(s.warmth, "warmer", "thinner")}`,
    `clarity ${tilt(s.clarity, "brighter", "softer")}`,
    `compression ${step(s.comp, ["off", "gentle", "medium", "strong"])}`,
    `hiss clean-up ${step(s.hiss, ["off", "light", "medium", "strong"])}`,
  ].join(", ");
}
