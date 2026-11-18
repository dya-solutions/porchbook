/**
 * Hold a post: cracks spread from the finger, then the card shatters like glass.
 * Everything here is drawn on the phone (SVG cracks, clipped copies of the card, synthesised sounds).
 */

const SVG = "http://www.w3.org/2000/svg";

type Point = { x: number; y: number };

function rand(seed: { n: number }) {
  // Small steady random so one hold's cracks don't jump around.
  seed.n = (seed.n * 16807) % 2147483647;
  return (seed.n - 1) / 2147483646;
}

/** Crack lines from a point, as SVG path strings with their lengths. */
function crackPaths(at: Point, w: number, h: number, seedValue: number) {
  const seed = { n: Math.max(1, Math.floor(seedValue) % 2147483646) };
  const reach = Math.hypot(w, h);
  const rays = 9;
  const paths: { d: string; length: number; delay: number }[] = [];
  for (let i = 0; i < rays; i += 1) {
    let angle = (i / rays) * Math.PI * 2 + rand(seed) * 0.5;
    let x = at.x;
    let y = at.y;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    let length = 0;
    const steps = 6 + Math.floor(rand(seed) * 4);
    const stepLen = reach / steps / 1.4;
    for (let s = 0; s < steps; s += 1) {
      angle += (rand(seed) - 0.5) * 0.7;
      const len = stepLen * (0.6 + rand(seed) * 0.8);
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      length += len;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      // little side splinters
      if (rand(seed) < 0.35) {
        const side = angle + (rand(seed) < 0.5 ? 1 : -1) * (0.6 + rand(seed) * 0.6);
        const sl = len * 0.6;
        d += ` M${x.toFixed(1)} ${y.toFixed(1)} L${(x + Math.cos(side) * sl).toFixed(1)} ${(y + Math.sin(side) * sl).toFixed(1)} M${x.toFixed(1)} ${y.toFixed(1)}`;
        length += sl * 2;
      }
    }
    paths.push({ d, length, delay: rand(seed) * 0.25 });
  }
  // a small ring of breaks around the impact
  const ring = [];
  for (let i = 0; i <= 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    const r = 14 + rand(seed) * 8;
    ring.push(`${(at.x + Math.cos(a) * r).toFixed(1)} ${(at.y + Math.sin(a) * r).toFixed(1)}`);
  }
  paths.push({ d: `M${ring.join(" L")}`, length: 140, delay: 0 });
  return paths;
}

/** Draws cracks over a card; set(progress 0..1) reveals them. */
export function crackOverlay(card: HTMLElement, at: Point) {
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "post-cracks");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  const lines: SVGPathElement[] = [];
  for (const part of crackPaths(at, w, h, at.x * 131 + at.y * 17 + Date.now() % 1000)) {
    for (const cls of ["post-crack-shade", "post-crack"]) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", part.d);
      path.setAttribute("class", cls);
      path.style.strokeDasharray = String(part.length);
      path.style.strokeDashoffset = String(part.length);
      path.dataset.length = String(part.length);
      path.dataset.delay = String(part.delay);
      svg.appendChild(path);
      lines.push(path);
    }
  }
  card.appendChild(svg);
  return {
    set(progress: number) {
      for (const line of lines) {
        const length = Number(line.dataset.length);
        const delay = Number(line.dataset.delay);
        const local = Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
        line.style.strokeDashoffset = String(length * (1 - local));
      }
      svg.style.opacity = String(Math.min(1, progress * 3));
    },
    remove() {
      svg.remove();
    },
  };
}

/** Break the card into falling pieces. Resolves when they're gone; the card itself is hidden meanwhile. */
export function shatterCard(card: HTMLElement, at: Point): Promise<void> {
  const box = card.getBoundingClientRect();
  const w = box.width;
  const h = box.height;
  // Pieces: wedges from the impact point out to points around the edge, each split once more.
  const edge: Point[] = [];
  const per = 4;
  for (let i = 0; i < per; i += 1) edge.push({ x: (w * i) / per, y: 0 });
  for (let i = 0; i < per; i += 1) edge.push({ x: w, y: (h * i) / per });
  for (let i = 0; i < per; i += 1) edge.push({ x: w - (w * i) / per, y: h });
  for (let i = 0; i < per; i += 1) edge.push({ x: 0, y: h - (h * i) / per });
  const holder = document.createElement("div");
  holder.className = "post-shards";
  holder.style.left = `${box.left}px`;
  holder.style.top = `${box.top}px`;
  holder.style.width = `${w}px`;
  holder.style.height = `${h}px`;
  document.body.appendChild(holder);
  const pieces: Promise<unknown>[] = [];
  const pct = (p: Point) => `${((p.x / w) * 100).toFixed(2)}% ${((p.y / h) * 100).toFixed(2)}%`;
  for (let i = 0; i < edge.length; i += 1) {
    const a = edge[i];
    const b = edge[(i + 1) % edge.length];
    const mid = { x: (at.x + (a.x + b.x) / 2) / 2, y: (at.y + (a.y + b.y) / 2) / 2 };
    const polys = [
      [at, mid, a],
      [at, b, mid],
      [mid, b, a],
    ];
    for (const poly of polys) {
      const shard = card.cloneNode(true) as HTMLElement;
      shard.querySelectorAll(".post-cracks").forEach((node) => node.remove());
      shard.removeAttribute("data-bend");
      shard.classList.add("post-shard");
      shard.style.width = `${w}px`;
      shard.style.height = `${h}px`;
      shard.style.clipPath = `polygon(${poly.map(pct).join(",")})`;
      holder.appendChild(shard);
      const cx = (poly[0].x + poly[1].x + poly[2].x) / 3;
      const cy = (poly[0].y + poly[1].y + poly[2].y) / 3;
      const dx = (cx - at.x) * (0.35 + Math.random() * 0.4);
      const dy = (cy - at.y) * 0.25 + 160 + Math.random() * 260;
      const turn = (Math.random() - 0.5) * 70;
      const delay = Math.hypot(cx - at.x, cy - at.y) * 0.4;
      pieces.push(
        shard.animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            { transform: `translate(${dx * 0.3}px, ${dy * 0.12}px) rotate(${turn * 0.2}deg)`, opacity: 1, offset: 0.25 },
            { transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg)`, opacity: 0 },
          ],
          { duration: 850 + Math.random() * 300, delay, easing: "cubic-bezier(.4,0,.8,.6)", fill: "forwards" },
        ).finished,
      );
    }
  }
  card.style.visibility = "hidden";
  return Promise.allSettled(pieces).then(() => {
    holder.remove();
  });
}

// ---- Sounds (made on the phone, no files)
let ctx: AudioContext | null = null;
function audio() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

function noise(c: AudioContext, seconds: number) {
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource();
  source.buffer = buffer;
  return source;
}

/** A short glass creak, a little louder as the cracks grow. */
export function creak(strength: number) {
  const c = audio();
  if (!c) return;
  void c.resume().catch(() => undefined);
  const t = c.currentTime;
  const src = noise(c, 0.08);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2600 + Math.random() * 2400;
  band.Q.value = 9;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05 + strength * 0.12, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(band).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + 0.09);
}

/** The shatter: a crash and a scatter of tinkles. */
export function smash() {
  const c = audio();
  if (!c) return;
  void c.resume().catch(() => undefined);
  const t = c.currentTime;
  const crash = noise(c, 0.5);
  const high = c.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  crash.connect(high).connect(g).connect(c.destination);
  crash.start(t);
  crash.stop(t + 0.5);
  for (let i = 0; i < 9; i += 1) {
    const when = t + 0.06 + Math.random() * 0.7;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 2400 + Math.random() * 3600;
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.0001, when);
    pg.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, when + 0.004);
    pg.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(pg).connect(c.destination);
    osc.start(when);
    osc.stop(when + 0.2);
  }
}
