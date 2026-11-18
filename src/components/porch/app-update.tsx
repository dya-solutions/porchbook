import { useBackLayer } from "@/lib/porch/back-stack";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { W } from "@/components/porch/words";

/**
 * Refresh's app check: in the Porchbook app, if a newer app has been built, offer it.
 * Update downloads it inside the app and opens Android's install screen (the person taps Install).
 */

type Host = Window & {
  PorchApp?: { appVersion?: () => number; updateApp?: (address: string) => void; keepState?: () => string; refresh?: () => void };
  __porchUpdate?: (state: string, percent: number) => void;
};
type Offer = { name: string; code: number; onLater: () => void };
const OFFER = "porch-app-update";

/** True when a newer app is ready (and the card is now showing); false to carry on refreshing. */
export async function checkForAppUpdate(onLater: () => void): Promise<boolean> {
  const host = window as Host;
  if (!host.PorchApp) return false; // the website: nothing to install
  try {
    const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const latest = (await response.json()) as { versionCode?: number; versionName?: string };
    const mine = typeof host.PorchApp.appVersion === "function" ? Number(host.PorchApp.appVersion()) || 0 : 0;
    if (!latest.versionCode || latest.versionCode <= mine) return false;
    window.dispatchEvent(new CustomEvent<Offer>(OFFER, { detail: { name: latest.versionName ?? "", code: latest.versionCode, onLater } }));
    return true;
  } catch {
    return false;
  }
}

export function AppUpdateCard() {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [state, setState] = useState("");
  const [percent, setPercent] = useState(0);
  useBackLayer(Boolean(offer), () => setOffer(null), "update");
  useEffect(() => {
    const show = (event: Event) => {
      setOffer((event as CustomEvent<Offer>).detail);
      setState("");
    };
    window.addEventListener(OFFER, show);
    (window as Host).__porchUpdate = (next, pct) => {
      setState(next);
      setPercent(pct);
    };
    return () => window.removeEventListener(OFFER, show);
  }, []);
  if (!offer) return null;
  const host = window as Host;
  const canUpdate = typeof host.PorchApp?.updateApp === "function";

  function update() {
    if (canUpdate) {
      setState("downloading");
      setPercent(0);
      host.PorchApp?.updateApp?.(`${window.location.origin}/porch.apk`);
    } else {
      // An older app without the updater: fetch the new one the usual way, once.
      window.location.assign("/porch.apk");
    }
  }
  function later() {
    const next = offer?.onLater;
    setOffer(null);
    next?.();
  }

  return createPortal(
    <div className="upd-shade">
      <div className="upd-card">
        <p className="upd-title">
          <W k="update.title">A new Porchbook app is ready</W>
          {offer.name ? ` (${offer.name})` : ""}
        </p>
        {state === "downloading" ? (
          <>
            <p className="upd-text">
              <W k="update.downloading">Downloading…</W> {percent}%
            </p>
            <span className="upd-bar">
              <i style={{ width: `${percent}%` }} />
            </span>
          </>
        ) : state === "install" ? (
          <p className="upd-text">
            <W k="update.install">Tap Install on the next screen. Porchbook opens again with everything kept.</W>
          </p>
        ) : state === "allow" ? (
          <p className="upd-text">
            <W k="update.allow">First time only: switch on "Allow from this source" for Porchbook, come back, and tap Update again.</W>
          </p>
        ) : state === "failed" ? (
          <p className="upd-text">
            <W k="update.failed">The update didn't download. Check your connection and try again.</W>
          </p>
        ) : (
          <p className="upd-text">
            {canUpdate ? (
              <W k="update.text">Update now? It downloads inside Porchbook, then you tap Install. Your sign-in, notes and settings stay.</W>
            ) : (
              <W k="update.text-old">Download it once more. From now on, Refresh will update Porchbook for you.</W>
            )}
          </p>
        )}
        <span className="upd-row">
          {state === "downloading" || state === "install" ? null : (
            <button type="button" className="is-go" onClick={update}>
              {state === "allow" || state === "failed" ? <W k="update.again">Update again</W> : canUpdate ? <W k="update.now">Update now</W> : <W k="update.download">Download the new app</W>}
            </button>
          )}
          <button type="button" onClick={later}>
            <W k="update.later">Later</W>
          </button>
        </span>
      </div>
    </div>,
    document.body,
  );
}
