import { useNavigate } from "@tanstack/react-router";
import { PorchPanel } from "@/components/porch/porch-online";
import { RhemaChip } from "@/components/porch/rhema";
import { tuneIn, useFm } from "@/lib/porch/fm-player";
import { toggleTourMode } from "@/lib/porch/tour-mode";
import { shown } from "@/lib/porch/on-hold";

/** The right-hand column on computers: who's on the porch, the radio, and today's Rhemaclip. */
export function PcSide() {
  return (
    <div className="pc-side">
      <PorchPanel />
      {shown("radio") ? <RadioCard /> : null}
      <section className="pc-card" aria-label="Rhemaclip">
        <p className="pc-lab">Rhemaclip</p>
        <RhemaChip className="pc-rhema" />
      </section>
    </div>
  );
}

function RadioCard() {
  const fm = useFm();
  const navigate = useNavigate();
  const live = fm.status === "on" || fm.status === "tuning";
  const title = fm.onAir?.track.title ?? "";
  return (
    <section className="pc-card" aria-label="Porchbook Radio">
      <p className="pc-lab">Porchbook Radio</p>
      <button
        type="button"
        className="pc-lcd"
        onClick={() => {
          if (!live) void tuneIn();
          void navigate({ to: "/next" }).then(() => window.setTimeout(() => toggleTourMode("worship"), 50));
        }}
      >
        <span>{live ? "● ON AIR" : "▶ Listen"}</span>
        <b>{live && title ? title : "Tap to open the radio"}</b>
        <span className="pc-bars" aria-hidden="true">
          {[40, 80, 55, 95, 60, 30, 70, 50, 85, 45].map((h, i) => (
            <i key={i} style={{ height: `${live ? h : 12}%` }} />
          ))}
        </span>
      </button>
    </section>
  );
}
