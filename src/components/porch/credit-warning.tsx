import { useEffect, useState } from "react";
import { getCreditWarnings, type CreditWarning } from "@/lib/porch/credit-watch";

const HIDE_KEY = "porch-credit-hide";
const today = () => new Date().toISOString().slice(0, 10);

/** Founder only: a strip at the top when the porch guy's AI or the devotional voice is running low. */
export function CreditWarningStrip() {
  const [warnings, setWarnings] = useState<CreditWarning[]>([]);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === today();
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let alive = true;
    const check = () =>
      getCreditWarnings()
        .then((result) => alive && setWarnings(result.warnings))
        .catch(() => undefined);
    const first = window.setTimeout(check, 4000);
    const timer = window.setInterval(check, 30 * 60_000); // every half hour
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  // Something has run out: shown again even if hidden earlier today.
  const empty = warnings.some((w) => w.empty);
  if (!warnings.length || (hidden && !empty)) return null;
  return (
    <div className={`credit-strip${empty ? " is-empty" : ""}`} role="alert">
      <div className="credit-strip-text">
        {warnings.map((w) => (
          <p key={w.key}>⚠ {w.text}</p>
        ))}
      </div>
      <button
        type="button"
        aria-label="Hide until tomorrow"
        onClick={() => {
          try {
            localStorage.setItem(HIDE_KEY, today());
          } catch {
            /* this visit only */
          }
          setHidden(true);
          setWarnings((list) => list.filter((w) => w.empty));
        }}
      >
        ✕
      </button>
    </div>
  );
}
