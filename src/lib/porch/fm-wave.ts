/** The radio's sound-wave display: thin dotted columns mirrored about a centre line, coloured across the screen. */

export const WAVE_COLUMNS = 48;

export type WaveColors = [number, number, number][];

/** Porchbook colours: green on the left melting into orange on the right. */
export const PORCH_WAVE: WaveColors = [
  [125, 255, 42],
  [144, 200, 64],
  [214, 196, 40],
  [248, 160, 24],
  [255, 122, 24],
];

function colorAt(colors: WaveColors, t: number) {
  const spot = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(spot));
  const f = spot - i;
  const a = colors[i];
  const b = colors[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

/** A lively stand-in wave (when the real sound can't be read): rolling lumps that drift across. */
export function fakeWave(time: number, playing: boolean, into: number[]) {
  const t = time / 1000;
  for (let k = 0; k < into.length; k += 1) {
    const x = k / into.length;
    const lumps = 0.45 + 0.4 * Math.sin(x * 11 - t * 1.7) + 0.25 * Math.sin(x * 27 + t * 2.3);
    const jitter = 0.6 + 0.4 * Math.abs(Math.sin(k * 12.9898 + Math.floor(t * 9) * 78.233));
    const target = playing ? Math.min(1, Math.max(0.12, lumps * jitter)) : 0.02;
    into[k] += (target - into[k]) * (playing ? 0.5 : 0.15);
  }
  return into;
}

/** Spread a few frequency bands over all the columns, so neighbours rise and fall together. */
export function spreadLevels(bands: number[], columns = WAVE_COLUMNS) {
  const out: number[] = [];
  for (let k = 0; k < columns; k += 1) {
    const at = (k / (columns - 1)) * (bands.length - 1);
    const i = Math.floor(at);
    const f = at - i;
    const v = (bands[i] ?? 0) * (1 - f) + (bands[i + 1] ?? bands[i] ?? 0) * f;
    out.push(v * (0.8 + 0.2 * Math.sin(k * 2.3)));
  }
  return out;
}

export function drawWave(pen: CanvasRenderingContext2D, w: number, h: number, levels: number[], colors: WaveColors = PORCH_WAVE) {
  pen.clearRect(0, 0, w, h);
  const n = levels.length;
  const pitch = w / n;
  const dot = Math.max(2, pitch * 0.5);
  const step = dot * 1.55;
  const mid = h / 2;
  const maxDots = Math.floor((h / 2 - dot) / step);
  for (let k = 0; k < n; k += 1) {
    const [r, g, b] = colorAt(colors, k / (n - 1));
    const x = k * pitch + (pitch - dot) / 2;
    const count = Math.max(1, Math.round(Math.min(1, levels[k]) * maxDots));
    pen.shadowBlur = 6;
    pen.shadowColor = `rgba(${r},${g},${b},.75)`;
    for (let d = 0; d < count; d += 1) {
      // Dots fade a little toward the tips.
      const alpha = 1 - (d / Math.max(1, maxDots)) * 0.45;
      pen.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      const off = d * step;
      pen.fillRect(x, mid - off - dot / 2, dot, dot);
      if (d > 0) pen.fillRect(x, mid + off - dot / 2, dot, dot);
    }
  }
  pen.shadowBlur = 0;
}
