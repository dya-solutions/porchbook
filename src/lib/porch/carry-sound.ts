import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";

type Carry = {
  title: string;
  play: () => void;
  pause: () => void;
};

let token = 0;

/** Puts the sound that is already playing on the lock screen. Pause there stops it. */
export function carrySound(next: Carry) {
  const mine = ++token;
  // One sound at a time: Porchbook Radio steps aside while this plays, and
  // comes back by itself when it stops.
  const reason = `carry-${mine}`;
  holdRadio(reason);
  const session = "mediaSession" in navigator ? navigator.mediaSession : null;
  if (session) {
    try {
      session.metadata = new MediaMetadata({ title: next.title, artist: "Porchbook" });
      session.playbackState = "playing";
      session.setActionHandler("play", () => {
        if (mine !== token) return;
        session.playbackState = "playing";
        next.play();
      });
      session.setActionHandler("pause", () => {
        if (mine !== token) return;
        session.playbackState = "paused";
        next.pause();
      });
    } catch {
      /* this browser has no lock-screen controls */
    }
  }
  return () => {
    releaseRadio(reason);
    if (mine !== token || !session) return;
    try {
      session.playbackState = "none";
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
    } catch {
      /* already released */
    }
  };
}
