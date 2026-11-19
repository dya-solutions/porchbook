import { Link, useNavigate } from "@tanstack/react-router";
import { PbAvatar, PbIcon, usePorchLook } from "@/components/porch/pb-shell";
import { choosePresence, usePorch } from "@/lib/porch/presence-store";
import { playButtonSound } from "@/lib/porch/button-sound-play";

/**
 * Who is on the porch (design-reference/Presence.dc.html).
 * The fair rule stays: while you're hidden, you don't see who else is here either.
 */
export function PresenceView() {
  const porch = usePorch();
  const look = usePorchLook();
  const navigate = useNavigate();
  const visible = porch.status !== "hidden";
  const church = look?.shortName ?? "your porch";

  return (
    <div className="pb">
      <header className="pb-back">
        <Link to="/" search={{ room: "all" } as never} className="pb-iconbtn" aria-label="Back to My porch">
          <PbIcon name="back" size={20} />
        </Link>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 15, flex: 1 }}>
          My porch
        </p>
      </header>
      <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h1 className="pb-ttl" style={{ fontSize: 28 }}>
            On the porch now
          </h1>
          <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
            {!porch.loaded
              ? "Looking who's here…"
              : visible
                ? `${porch.count} ${porch.count === 1 ? "member" : "members"} of ${church} ${porch.count === 1 ? "is" : "are"} here.`
                : "You're hidden, so you can't see who else is here."}
          </p>
        </div>
        <div className="pb-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="pb-row">
            <span style={{ color: "var(--pb-second)", display: "flex" }}>
              <PbIcon name={visible ? "eye" : "eyeOff"} size={22} />
            </span>
            <p style={{ margin: 0, flex: 1, fontWeight: 700, fontSize: 16 }}>Show me on the porch</p>
            <button
              type="button"
              role="switch"
              aria-checked={visible}
              aria-label="Show me on the porch"
              className="pb-switch"
              onClick={() => {
                playButtonSound();
                void choosePresence(visible ? "hidden" : "online");
              }}
            />
          </div>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 13, lineHeight: 1.4 }}>
            Turn this off to be hidden. While you&apos;re hidden, you won&apos;t see who else is here either.
          </p>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {visible && porch.people.length === 0 && porch.loaded ? (
          <p className="pb-quiet" style={{ padding: "8px 16px", fontSize: 15 }}>
            Nobody else is on the porch right now.
          </p>
        ) : null}
        {visible
          ? porch.people.map((person) => (
              <div key={person.userId} className="pb-person">
                <Link to="/people/$userId" params={{ userId: person.userId }} style={{ position: "relative", flex: "none" }} aria-label={`${person.name}'s page`}>
                  <PbAvatar id={person.userId} name={person.name} imageUrl={person.imageUrl} />
                  <span className={`pb-online-dot${person.idle ? " is-idle" : ""}`} />
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.name}</p>
                  <p className="pb-quiet" style={{ margin: "1px 0 0", fontSize: 13 }}>
                    {person.dnd ? "Do not disturb" : person.idle ? "Away for a while" : "Here now"}
                  </p>
                </div>
                <Link to="/messages/$userId" params={{ userId: person.userId }} className="pb-iconbtn" aria-label={`Message ${person.name}`}>
                  <PbIcon name="chat" size={18} />
                </Link>
                <button
                  type="button"
                  className="pb-iconbtn is-green"
                  aria-label={`Call ${person.name}`}
                  onClick={() => {
                    playButtonSound();
                    void navigate({ to: "/calls", search: { to: person.userId, name: person.name, video: "" } });
                  }}
                >
                  <PbIcon name="phone" size={18} />
                </button>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
