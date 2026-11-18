/**
 * The phone's own voice (free, never runs out): reads the devotional aloud when there's
 * no recording. Works in Chrome; the Porchbook app's window may not have a voice.
 */
export const canPhoneSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** Lines split into pieces short enough for every phone (some stop after ~200 letters). */
function piecesOf(lines: string[]) {
  const out: string[] = [];
  for (const line of lines) {
    const sentences = line.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [line];
    let piece = "";
    for (const sentence of sentences) {
      if ((piece + sentence).length > 180 && piece) {
        out.push(piece.trim());
        piece = "";
      }
      piece += sentence;
    }
    if (piece.trim()) out.push(piece.trim());
  }
  return out;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  return english.find((v) => /en-gb/i.test(v.lang)) ?? english.find((v) => /en-us/i.test(v.lang)) ?? english[0] ?? null;
}

/** Read the lines aloud; returns a stop function. onEnd runs once, when it finishes or is stopped. */
export function speakLines(lines: string[], onEnd: () => void): () => void {
  const synth = window.speechSynthesis;
  synth.cancel();
  const pieces = piecesOf(lines);
  let index = 0;
  let stopped = false;
  let ended = false;
  const done = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  const next = () => {
    if (stopped) return;
    if (index >= pieces.length) return done();
    const say = new SpeechSynthesisUtterance(pieces[index++]);
    const voice = pickVoice();
    if (voice) say.voice = voice;
    say.lang = voice?.lang ?? "en-GB";
    say.rate = 0.95;
    say.onend = next;
    say.onerror = next;
    synth.speak(say);
  };
  // Voices can arrive a moment late on Android.
  if (!synth.getVoices().length) {
    synth.onvoiceschanged = () => {
      synth.onvoiceschanged = null;
      next();
    };
    window.setTimeout(() => index === 0 && next(), 800);
  } else next();
  // Chrome on Android can pause a long reading by itself: nudge it along.
  const keepAlive = window.setInterval(() => {
    if (synth.speaking && synth.paused) synth.resume();
  }, 5000);
  return () => {
    stopped = true;
    window.clearInterval(keepAlive);
    synth.cancel();
    done();
  };
}
