/**
 * The strings under the devotional: played quietly alongside the voice, fading in at the start
 * and out at the end, looping if the reading is longer. Phones that don't let a page set volume
 * (iPhones) skip it rather than play it loud.
 */
export type Bed = { url: string; level: number } | null;

export function attachBed(voice: HTMLAudioElement, bed: Bed, gain: () => number = () => 1): () => void {
  if (!bed?.url) return () => {};
  const node = new Audio(bed.url);
  node.loop = true;
  node.preload = "auto";
  try {
    node.volume = 0.5;
  } catch {
    /* read-only */
  }
  if (Math.abs(node.volume - 0.5) > 0.01) return () => {}; // volume can't be set here: no strings
  let timer = 0;
  const apply = () => {
    const t = voice.currentTime;
    const d = voice.duration;
    const fadeIn = Math.min(1, t / 2.5);
    const fadeOut = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(1, (d - t) / 3)) : 1;
    try {
      node.volume = Math.max(0, Math.min(1, bed.level * gain() * Math.min(fadeIn, fadeOut)));
    } catch {
      /* fine */
    }
  };
  const start = () => {
    apply();
    void node.play().catch(() => undefined);
    window.clearInterval(timer);
    timer = window.setInterval(apply, 150);
  };
  const stop = () => {
    window.clearInterval(timer);
    node.pause();
  };
  voice.addEventListener("play", start);
  voice.addEventListener("pause", stop);
  voice.addEventListener("ended", stop);
  if (!voice.paused) start();
  return () => {
    stop();
    voice.removeEventListener("play", start);
    voice.removeEventListener("pause", stop);
    voice.removeEventListener("ended", stop);
    node.removeAttribute("src");
  };
}
