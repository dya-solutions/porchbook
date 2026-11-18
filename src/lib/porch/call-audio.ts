let hear: HTMLAudioElement | null = null;

export function primeCallAudio() {
  if (typeof document === "undefined") return;
  if (!hear) {
    hear = document.createElement("audio");
    hear.autoplay = true;
    hear.setAttribute("playsinline", "true");
    hear.setAttribute("webkit-playsinline", "true");
    document.body.appendChild(hear);
  }
  void hear.play().catch(() => undefined);
}

export function playRemoteAudio(stream: MediaStream) {
  primeCallAudio();
  if (!hear) return;
  if (hear.srcObject !== stream) hear.srcObject = stream;
  hear.muted = true;
  void hear.play().catch(() => undefined);
}

export function hearRemote(on: boolean) {
  if (!hear) return;
  hear.muted = !on;
  if (on) void hear.play().catch(() => undefined);
}