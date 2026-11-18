import { isLite } from "@/lib/porch/lite";

const blobs = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

const WALKS = ["pastor", "hoo", "administrator", "hof", "communications", "missions", "centre"];

export function walkSrc(key: string): string {
  return `/tour-walk-${key}.mp4?v=6`;
}

export function cachedVideo(url: string): string {
  return blobs.get(url) ?? url;
}

export function warmVideo(url: string): Promise<string> {
  const hit = blobs.get(url);
  if (hit) return Promise.resolve(hit);
  const wait = pending.get(url);
  if (wait) return wait;
  const job = fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("miss"))))
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      blobs.set(url, objectUrl);
      pending.delete(url);
      return objectUrl;
    })
    .catch(() => {
      pending.delete(url);
      return url;
    });
  pending.set(url, job);
  return job;
}

function warmImage(src: string) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

export function warmTourMedia() {
  // Lite: nothing downloads ahead of time; each picture or walk loads when it's used.
  if (isLite()) return;
  warmImage("/tour-corridor.jpg");
  warmImage("/tour-office.jpg");
  // (The 24 MB events film is no longer fetched ahead: nothing shows it now.)
  const run = () => {
    for (const key of WALKS) void warmVideo(walkSrc(key));
  };
  const idle = window.requestIdleCallback;
  if (idle) idle(run, { timeout: 1200 });
  else window.setTimeout(run, 200);
}
