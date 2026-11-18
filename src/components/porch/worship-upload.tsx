import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { addWorship, dropWorship, getWorship } from "@/lib/porch/worship";

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] ?? "";
      if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
    }
  } catch {
    return "";
  }
  return "";
}

export function WorshipUpload({
  desk,
  onSongs,
  onFounder,
}: {
  desk: HTMLElement | null;
  onSongs: (ids: string[]) => void;
  onFounder: (founder: boolean) => void;
}) {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [links, setLinks] = useState("");
  const [songs, setSongs] = useState<{ id: string; url: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  function keep(next: { id: string; url: string }[]) {
    setSongs(next);
    const ids: string[] = [];
    for (const song of next) {
      const id = youtubeId(song.url);
      if (id && !ids.includes(id)) ids.push(id);
    }
    onSongs(ids);
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getWorship({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        onFounder(result.founder);
        if (result.founder) keep(result.songs);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!founder || !desk) return null;

  async function add() {
    setPending(true);
    setError("");
    const result = await addWorship({ data: { links, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLinks("");
    keep(result.songs);
  }

  async function remove(id: string) {
    setPending(true);
    setError("");
    const result = await dropWorship({ data: { id, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    keep(result.songs);
  }

  return createPortal(
    <div
      style={{
        boxSizing: "border-box",
        width: "960px",
        height: "540px",
        padding: "36px 48px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        background: "#070b12",
        color: "#f6edd8",
        pointerEvents: "auto",
      }}
    >
      <p style={{ margin: 0, fontSize: "40px", fontWeight: 800 }}>Worship</p>
      <textarea
        value={links}
        onChange={(event) => setLinks(event.target.value)}
        placeholder="Paste a YouTube link, or several, one on each line"
        rows={3}
        style={{
          width: "100%",
          resize: "none",
          borderRadius: "16px",
          border: "1px solid #ffecd273",
          background: "#10141c",
          color: "#f6edd8",
          fontSize: "28px",
          padding: "16px",
        }}
      />
      <button
        type="button"
        disabled={pending || !links.trim()}
        onClick={() => void add()}
        style={{
          alignSelf: "flex-start",
          border: 0,
          borderRadius: "999px",
          background: "#f5a018",
          color: "#14110c",
          fontSize: "28px",
          fontWeight: 800,
          padding: "12px 28px",
        }}
      >
        {pending ? "Saving…" : "Add"}
      </button>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", overflow: "auto", display: "grid", gap: "10px" }}>
        {songs.map((song) => (
          <li key={song.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "26px" }}>
              {youtubeId(song.url) || song.url}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => void remove(song.id)}
              style={{
                border: 0,
                borderRadius: "999px",
                background: "#1c2430",
                color: "#f6edd8",
                fontSize: "22px",
                padding: "8px 18px",
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error ? <p style={{ margin: 0, fontSize: "24px" }}>{error}</p> : null}
    </div>,
    desk,
  );
}
