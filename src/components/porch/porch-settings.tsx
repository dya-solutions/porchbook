// Stage 4c: Porch settings, for the porch's admins. The porch's theme (one of the six; only
// colours change) and which Tour doors the porch shows. Members never see this screen.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { setPorchTheme, setTourDoors, TOUR_DOORS } from "@/lib/porch/porch-look";
import { THEMES, type Theme, type ThemeId } from "@/lib/porch/themes";
import { applyTheme, reloadPorchLook, usePorchLook } from "@/components/porch/pb-shell";

function Swatch({ theme }: { theme: Theme }) {
  return (
    <span className="ps-swatch" style={{ background: theme.bg }} aria-hidden="true">
      <span style={{ background: theme.card, color: theme.text }}>Aa</span>
      <span className="ps-dots">
        <i style={{ background: theme.main }} />
        <i style={{ background: theme.second }} />
      </span>
    </span>
  );
}

export function PorchSettings() {
  const look = usePorchLook();
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [off, setOff] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!look) return;
    setTheme((current) => current ?? look.theme);
    setOff((current) => current ?? look.tourOff ?? []);
  }, [look]);

  if (!look) return null;
  if (!look.admin) {
    return (
      <div className="pb pb-card" style={{ padding: 20 }}>
        <h1 className="pb-ttl" style={{ fontSize: 24 }}>Porch settings</h1>
        <p className="pb-quiet" style={{ margin: "6px 0 0" }}>Only your porch's admins can change its settings.</p>
      </div>
    );
  }

  async function chooseTheme(id: ThemeId) {
    if (busy) return;
    const before = theme;
    setTheme(id);
    applyTheme(id); // show it straight away
    setBusy(true);
    setNote("");
    const result = await setPorchTheme({ data: { theme: id } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setTheme(before);
      if (before) applyTheme(before);
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    reloadPorchLook();
    setNote(`Everyone in ${look?.shortName ?? "your porch"} now sees ${THEMES.find((item) => item.id === id)?.name}.`);
  }

  async function toggleDoor(key: string) {
    if (!off || busy) return;
    const next = off.includes(key) ? off.filter((item) => item !== key) : [...off, key];
    setBusy(true);
    setNote("");
    const result = await setTourDoors({ data: { off: next } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setOff(next);
    reloadPorchLook();
  }

  return (
    <div className="pb ps">
      <div>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>Porch settings</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
          For {look.name}. Changes here are for everyone in your porch.
        </p>
      </div>

      <section>
        <p className="ofc-sec">Theme</p>
        <p className="pb-quiet" style={{ margin: "0 4px 10px", fontSize: 14 }}>
          Only the colours change. Each member can still dim the screen with Dawn, Dusk and Night.
        </p>
        <div className="ps-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={theme === item.id}
              className={`ps-theme${theme === item.id ? " is-on" : ""}`}
              onClick={() => void chooseTheme(item.id)}
            >
              <Swatch theme={item} />
              <span className="ps-theme-name">{item.name}</span>
              <span className="ps-theme-hint">{item.light ? "Light" : "Dark"}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="ofc-sec">Tour doors</p>
        <p className="pb-quiet" style={{ margin: "0 4px 10px", fontSize: 14 }}>
          Switch off the doors your porch doesn't use. Nothing is deleted; switch a door back on any time.
        </p>
        <div className="pb-card ofc-list" style={{ marginTop: 0 }}>
          {TOUR_DOORS.map((door) => {
            const on = !(off ?? []).includes(door.key);
            return (
              <label key={door.key} className="ofc-row ps-door">
                <span className="ofc-words">
                  <span className="ofc-name">{door.name}</span>
                  <span className="ofc-hint">{on ? "On the Tour" : "Switched off"}</span>
                </span>
                <span className={`pb-switch${on ? " is-on" : ""}`}>
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => void toggleDoor(door.key)} aria-label={`${door.name} on the Tour`} />
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <p className="ofc-sec">Also for admins</p>
        <div className="pb-card ofc-list" style={{ marginTop: 0 }}>
          <Link to="/offices" className="ofc-row">
            <span className="ofc-words">
              <span className="ofc-name">Offices</span>
              <span className="ofc-hint">Create offices, choose heads and what each office offers</span>
            </span>
          </Link>
        </div>
      </section>

      {note ? (
        <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
