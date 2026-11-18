import { useEffect, useState, type ReactNode } from "react";
import { markLiteAsked, setLite, shouldOfferLite, useLite } from "@/lib/porch/lite";

/** The card that offers Lite when the phone is saving data or the line is slow. */
export function LiteOffer() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShow(shouldOfferLite()), 2500);
    return () => window.clearTimeout(timer);
  }, []);
  if (!show) return null;
  return (
    <div className="lite-offer" role="dialog" aria-label="Porchbook Lite">
      <span className="lite-offer-mark" aria-hidden="true">
        🐢
      </span>
      <b>Your connection is slow</b>
      <p>Porchbook Lite loads faster and uses much less data. You can switch back any time.</p>
      <button
        type="button"
        className="lite-offer-yes"
        onClick={() => {
          markLiteAsked();
          setLite(true);
          setShow(false);
        }}
      >
        Use Porchbook Lite
      </button>
      <button
        type="button"
        className="lite-offer-no"
        onClick={() => {
          markLiteAsked();
          setShow(false);
        }}
      >
        Not now
      </button>
    </div>
  );
}

/** Lite on/off key (also the orange LITE tag while it's on). */
export function LiteKey({ className = "" }: { className?: string }) {
  const lite = useLite();
  return (
    <button type="button" className={`lite-key ${lite ? "is-on" : ""} ${className}`} aria-pressed={lite} onClick={() => setLite(!lite)} title={lite ? "Lite is on: tap for full Porchbook" : "Use Porchbook Lite (less data)"}>
      LITE
    </button>
  );
}

/** A photo that waits for a tap in Lite. */
export function LitePhoto({ children }: { children: ReactNode }) {
  const lite = useLite();
  const [open, setOpen] = useState(false);
  if (!lite || open) return <>{children}</>;
  return (
    <button type="button" className="lite-photo" onClick={() => setOpen(true)}>
      📷 Photo · <b>tap to load</b>
    </button>
  );
}

/** Before a heavy place opens in Lite: "this downloads about N MB". */
export function LiteGate({ megabytes, what, children }: { megabytes: number; what: string; children: ReactNode }) {
  const lite = useLite();
  const [go, setGo] = useState(false);
  if (!lite || go) return <>{children}</>;
  return (
    <div className="lite-gate">
      <b>{what}</b>
      <p>This downloads about {megabytes} MB the first time. You're on Porchbook Lite.</p>
      <button type="button" className="lite-offer-yes" onClick={() => setGo(true)}>
        Open anyway
      </button>
      <button type="button" className="lite-offer-no" onClick={() => window.history.back()}>
        Go back
      </button>
    </div>
  );
}
