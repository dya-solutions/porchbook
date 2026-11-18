import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { amIFounder } from "@/lib/porch/password-reset";
import { setBarStyle, useBarStyle } from "@/lib/porch/bar-style";
import { setButtonStyle, useButtonStyle } from "@/lib/porch/button-style";
import { setTopStyle, useTopStyle } from "@/lib/porch/top-style";
import { setPostStyle, usePostStyle } from "@/lib/porch/post-style";
import { setNoteStyle, useBellOn, useNoteStyle } from "@/lib/porch/note-style";

/** One place to change Porchbook's look: each choice shown as a small picture to tap. */
function Choice({ on, label, swatch, onPick }: { on: boolean; label: string; swatch: string; onPick: () => void }) {
  return (
    <button type="button" className={`theme-choice${on ? " is-on" : ""}`} aria-pressed={on} onClick={onPick}>
      <span className={`theme-swatch ${swatch}`} aria-hidden="true">
        <i />
        <i />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function ThemesSheet({ onClose }: { onClose: () => void }) {
  const buttons = useButtonStyle();
  const top = useTopStyle();
  const post = usePostStyle();
  const note = useNoteStyle();
  const bell = useBellOn();
  const bars = useBarStyle();
  // Leather bars: the founder's to try first (everyone once approved).
  const [founder, setFounder] = useState(false);
  useEffect(() => {
    let alive = true;
    amIFounder()
      .then((result) => alive && setFounder(Boolean(result.founder)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return createPortal(
    <div className="theme-wrap" role="dialog" aria-label="Themes" onClick={onClose}>
      <div className="theme-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="theme-head">
          <h2>Themes</h2>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
        <p className="theme-note">Your choices stay on this phone.</p>
        <h3>Buttons</h3>
        <div className="theme-row">
          <Choice on={buttons === "classic"} label="Classic black" swatch="is-btn-classic" onPick={() => setButtonStyle("classic")} />
          <Choice on={buttons === "green"} label="Porchbook green" swatch="is-btn-green" onPick={() => setButtonStyle("green")} />
        </div>
        {founder ? (
          <>
            <h3>Top &amp; bottom bars · only you for now</h3>
            <div className="theme-row">
              <Choice on={bars === "photo"} label="Photo" swatch="is-bars-photo" onPick={() => setBarStyle("photo")} />
              <Choice on={bars === "leather"} label="Leather" swatch="is-bars-leather" onPick={() => setBarStyle("leather")} />
            </div>
          </>
        ) : null}
        <h3>Top bar</h3>
        <div className="theme-row">
          <Choice on={top === "classic"} label="Classic" swatch="is-top-classic" onPick={() => setTopStyle("classic")} />
          <Choice on={top === "glass"} label="Glass" swatch="is-top-glass" onPick={() => setTopStyle("glass")} />
        </div>
        <h3>Post box</h3>
        <div className="theme-row">
          <Choice on={post === "walnut"} label="Walnut" swatch="is-post-walnut" onPick={() => setPostStyle("walnut")} />
          <Choice on={post === "porchbook"} label="Porchbook" swatch="is-post-pb" onPick={() => setPostStyle("porchbook")} />
        </div>
        {bell ? (
          <>
            <h3>Notifications</h3>
            <div className="theme-row">
              <Choice on={note === "porch"} label="Porch" swatch="is-note-porch" onPick={() => setNoteStyle("porch")} />
              <Choice on={note === "light"} label="Light" swatch="is-note-light" onPick={() => setNoteStyle("light")} />
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
