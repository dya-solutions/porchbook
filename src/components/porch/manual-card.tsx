import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { hideManualCard, manualCard } from "@/lib/porch/manual-card";
import { PorchManual } from "@/components/porch/manual-book";

/**
 * Home's invitation to read the Porchbook Manual. New members: "New here?". Everyone else who has
 * never opened it: "Have you read…?". Later brings it back tomorrow; ✕ in two weeks (once).
 */
type Card = { kind: "new" | "old"; name: string; founder: boolean; live: boolean };

export function ManualCard() {
  const [card, setCard] = useState<Card | null>(null);
  const [open, setOpen] = useState(false);
  // A link with ?manual opens the book straight away (for the porch guy and for sharing).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("manual")) setOpen(true);
  }, []);
  useEffect(() => {
    let alive = true;
    void manualCard()
      .then((result) => alive && result.show && setCard({ kind: result.kind, name: result.name, founder: result.founder, live: result.live }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const hide = (how: "later" | "close") => {
    setCard(null);
    void hideManualCard({ data: { how } }).catch(() => undefined);
  };
  return (
    <>
      {card ? (
        <div className="manual-card">
          <button type="button" className="manual-card-x" aria-label="Don't show this" onClick={() => hide("close")}>
            ✕
          </button>
          <div className="manual-card-row">
            <img src="/icon-512.png" alt="" />
            <div>
              <p className="manual-card-k">{card.kind === "new" ? `Welcome${card.name ? `, ${card.name}` : ""}` : card.name || "Hello"}</p>
              <h3>{card.kind === "new" ? "New here? Read the Porchbook Manual" : "Have you read the Porchbook Manual?"}</h3>
              <p className="manual-card-s">{card.kind === "new" ? "5 short chapters · about 2 minutes" : "See everything Porchbook can do, in 5 short chapters"}</p>
            </div>
          </div>
          <div className="manual-card-b">
            <button
              type="button"
              className="manual-card-go"
              onClick={() => {
                setOpen(true);
                setCard(null);
              }}
            >
              📖 Read the manual
            </button>
            <button type="button" className="manual-card-later" onClick={() => hide("later")}>
              Later
            </button>
          </div>
          {card.founder && !card.live ? <p className="manual-card-founder">Only you see this for now.</p> : null}
        </div>
      ) : null}
      {/* On top of everything (the post box sits inside its own layer). */}
      {open ? createPortal(<PorchManual onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
