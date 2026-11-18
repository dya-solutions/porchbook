import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * The sign-up page: a matte black Porchbook phone lying on a dark block. Its screen shows the
 * time, the date and "Welcome to Porchbook". Tapping it stands the phone up, and the sign-up
 * (or sign-in) form appears on its screen.
 */
function useClock() {
  // Filled in on the phone itself (the server's clock is in another time zone).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function WelcomePhone({ form }: { form: (mode: "join" | "enter") => ReactNode }) {
  const now = useClock();
  const [up, setUp] = useState(false);
  const [mode, setMode] = useState<"join" | "enter">("join");
  const time = now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[AP]M$/i, "") : "";
  const date = now ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
  const stand = (next: "join" | "enter") => {
    setMode(next);
    setUp(true);
  };
  return (
    <main className={`wp-scene${up ? " is-up" : ""}`}>
      <div className="wp-block" aria-hidden="true" />
      <div
        className="wp-phone"
        role={up ? undefined : "button"}
        tabIndex={up ? -1 : 0}
        aria-label={up ? undefined : "Tap the phone to sign up"}
        onClick={() => !up && stand("join")}
        onKeyDown={(event) => {
          if (!up && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            stand("join");
          }
        }}
      >
        <span className="wp-side" aria-hidden="true" />
        <div className="wp-screen">
          {up ? (
            <div className="wp-form">
              <button type="button" className="wp-down" onClick={() => setUp(false)}>
                ‹ Back
              </button>
              {form(mode)}
            </div>
          ) : (
            <div className="wp-lock">
              <p className="wp-time">{time}</p>
              <div className="wp-info">
                <p className="wp-date">{date}</p>
                <p className="wp-hello">Welcome to Porchbook</p>
              </div>
              <img className="wp-fly" src="/icon-192.png" alt="" />
            </div>
          )}
        </div>
      </div>
      {up ? null : (
        <div className="wp-actions">
          <button type="button" className="wp-cta" onClick={() => stand("join")}>
            Tap the phone to sign up
          </button>
          <button type="button" className="wp-in" onClick={() => stand("enter")}>
            Already on the porch? Sign in
          </button>
          <p className="wp-foot">
            <Link to="/privacy">Privacy</Link> · Property of Phaneroo Ministries Mbarara
          </p>
        </div>
      )}
    </main>
  );
}
