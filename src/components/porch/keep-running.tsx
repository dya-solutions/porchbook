import { useBackLayer } from "@/lib/porch/back-stack";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { W } from "@/components/porch/words";

/**
 * In the Porchbook app: a one-time guide so the phone lets Porchbook keep running when minimised
 * (radio, calls, alerts). The app can only open the right settings; the person switches them on.
 */

type KeepState = { battery: boolean; notify: boolean; maker: string; autostart: boolean };
type Host = Window & {
  PorchApp?: { keepState?: () => string; openBattery?: () => void; openAutoStart?: () => void; openNotifications?: () => void };
};

const SEEN = "porch-keep-seen";
const TICKS = "porch-keep-ticks";
export const OPEN_KEEP = "porch-keep-open";

function readState(): KeepState | null {
  const host = window as Host;
  if (typeof host.PorchApp?.keepState !== "function") return null;
  try {
    return JSON.parse(host.PorchApp.keepState()) as KeepState;
  } catch {
    return null;
  }
}

function lockHow(maker: string) {
  if (maker.includes("samsung")) return "Open recent apps, tap the Porchbook icon above its card, and choose Keep open.";
  if (maker.includes("xiaomi") || maker.includes("redmi") || maker.includes("poco")) return "Open recent apps, press and hold the Porchbook card, and tap the lock.";
  if (maker.includes("tecno") || maker.includes("infinix") || maker.includes("itel")) return "Open recent apps, swipe the Porchbook card down (or press and hold it), and tap the lock.";
  return "Open recent apps, press and hold the Porchbook card (or swipe it down), and tap the lock if your phone shows one.";
}

/** True inside the Porchbook app (where this guide applies). */
export function inPorchApp() {
  return typeof window !== "undefined" && typeof (window as Host).PorchApp?.keepState === "function";
}

export function KeepRunning() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<KeepState | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  useBackLayer(open && Boolean(state), () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      /* asks again next time */
    }
  }, "keep");

  useEffect(() => {
    const first = readState();
    if (!first) return;
    setState(first);
    try {
      setTicks(JSON.parse(localStorage.getItem(TICKS) ?? "{}") as Record<string, boolean>);
      if (!localStorage.getItem(SEEN)) setOpen(true);
    } catch {
      setOpen(true);
    }
    const again = () => setState(readState());
    const show = () => {
      setState(readState());
      setOpen(true);
    };
    // Coming back from the phone's settings: see what changed.
    document.addEventListener("visibilitychange", again);
    window.addEventListener(OPEN_KEEP, show);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener(OPEN_KEEP, show);
    };
  }, []);

  if (!open || !state) return null;
  const host = window as Host;
  function tick(key: string) {
    const next = { ...ticks, [key]: !ticks[key] };
    setTicks(next);
    try {
      localStorage.setItem(TICKS, JSON.stringify(next));
    } catch {
      /* for this visit */
    }
  }
  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      /* asks again next time */
    }
  }
  const transsion = /tecno|infinix|itel/.test(state.maker);
  const showAuto = state.autostart || transsion || /xiaomi|redmi|poco|oppo|realme|vivo|huawei|honor/.test(state.maker);

  return createPortal(
    <div className="keep-shade">
      <div className="keep-card">
        <p className="keep-title">
          <W k="keep.title">Keep Porchbook running</W>
        </p>
        <p className="keep-intro">
          <W k="keep.intro">So the radio keeps playing, and calls and messages reach you, when Porchbook is minimised. Your phone needs these switched on. Tap each one; Porchbook opens the right page.</W>
        </p>

        <div className={`keep-step${state.notify ? " is-done" : ""}`}>
          <span className="keep-num">{state.notify ? "✓" : "1"}</span>
          <div>
            <b>
              <W k="keep.notify">Notifications on</W>
            </b>
            <p>
              <W k="keep.notify-help">Lets the radio show "Now playing" with Stop, and lets calls ring.</W>
            </p>
            {state.notify ? null : (
              <button type="button" onClick={() => host.PorchApp?.openNotifications?.()}>
                <W k="keep.notify-open">Turn on</W>
              </button>
            )}
          </div>
        </div>

        <div className={`keep-step${state.battery ? " is-done" : ""}`}>
          <span className="keep-num">{state.battery ? "✓" : "2"}</span>
          <div>
            <b>
              <W k="keep.battery">Battery: Unrestricted</W>
            </b>
            <p>
              <W k="keep.battery-help">Choose Allow, or Unrestricted / Don't optimise, so the phone doesn't put Porchbook to sleep.</W>
            </p>
            {state.battery ? null : (
              <button type="button" onClick={() => host.PorchApp?.openBattery?.()}>
                <W k="keep.battery-open">Open battery settings</W>
              </button>
            )}
          </div>
        </div>

        {showAuto ? (
          <div className={`keep-step${ticks.auto ? " is-done" : ""}`}>
            <span className="keep-num">{ticks.auto ? "✓" : "3"}</span>
            <div>
              <b>
                <W k="keep.auto">Auto-start on</W>
              </b>
              <p>
                <W k="keep.auto-help">Find Porchbook in the list and switch it on. On Tecno, Infinix and itel this is in Phone Master.</W>
              </p>
              <span className="keep-row">
                <button type="button" onClick={() => host.PorchApp?.openAutoStart?.()}>
                  <W k="keep.auto-open">Open auto-start</W>
                </button>
                <label>
                  <input type="checkbox" checked={Boolean(ticks.auto)} onChange={() => tick("auto")} /> <W k="keep.did-it">I've done it</W>
                </label>
              </span>
            </div>
          </div>
        ) : null}

        <div className={`keep-step${ticks.lock ? " is-done" : ""}`}>
          <span className="keep-num">{ticks.lock ? "✓" : showAuto ? "4" : "3"}</span>
          <div>
            <b>
              <W k="keep.lock">Lock Porchbook in recent apps</W>
            </b>
            <p>{lockHow(state.maker)}</p>
            <RecentsPicture />
            <label className="keep-row">
              <input type="checkbox" checked={Boolean(ticks.lock)} onChange={() => tick("lock")} /> <W k="keep.did-it">I've done it</W>
            </label>
          </div>
        </div>

        <button type="button" className="keep-done" onClick={close}>
          <W k="keep.done">Done</W>
        </button>
        <p className="keep-later">
          <W k="keep.later">You can find this again: tap your picture at the top, then Keep Porchbook running.</W>
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** A small drawing: the recent-apps view with Porchbook's card and a lock on it. */
function RecentsPicture() {
  return (
    <svg viewBox="0 0 220 120" className="keep-pic" aria-hidden="true">
      <rect x="1" y="1" width="218" height="118" rx="12" fill="#111" stroke="#333" />
      <rect x="18" y="22" width="58" height="80" rx="8" fill="#1d1d1d" stroke="#2a2a2a" />
      <rect x="144" y="22" width="58" height="80" rx="8" fill="#1d1d1d" stroke="#2a2a2a" />
      <rect x="81" y="14" width="58" height="92" rx="8" fill="#07140c" stroke="#f8a018" strokeWidth="2" />
      <text x="110" y="34" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#7fd23a" fontFamily="system-ui">Porchbook</text>
      <rect x="90" y="42" width="40" height="5" rx="2" fill="#2c4d12" />
      <rect x="90" y="52" width="32" height="5" rx="2" fill="#2c4d12" />
      <rect x="90" y="62" width="36" height="5" rx="2" fill="#2c4d12" />
      <circle cx="110" cy="88" r="10" fill="#f8a018" />
      <rect x="105.5" y="86" width="9" height="7" rx="1.5" fill="#000" />
      <path d="M107 86 v-2.5 a3 3 0 0 1 6 0 V86" fill="none" stroke="#000" strokeWidth="1.6" />
      <path d="M150 70 q8 -2 10 8 l-4 16" fill="none" stroke="#f6edd4" strokeWidth="1.6" opacity=".7" />
      <text x="168" y="112" textAnchor="middle" fontSize="7" fill="#999" fontFamily="system-ui">hold or swipe down</text>
    </svg>
  );
}
