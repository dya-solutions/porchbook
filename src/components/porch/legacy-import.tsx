import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getHeaderPhoto } from "@/lib/porch/header-photo";
import { importLegacy } from "@/lib/porch/legacy";

/** Founder: bring in the members backup from the old Grok Porchbook (posts and notes go to each member by email). */
export function LegacyImportSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const seed = { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: user?.profileImageUrl ?? null };

  useEffect(() => {
    if (!user?.id) return;
    getHeaderPhoto({ data: seed })
      .then((result) => setFounder(result.founder))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  if (!founder) return null;

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNote("Bringing in the old Porchbook…");
    try {
      const text = await file.text();
      const result = await importLegacy({ data: { ...seed, text } });
      setNote(
        result.ok
          ? `Done. ${result.members} members read. ${result.claimed} already have their old posts and notes; ${result.waiting} will get theirs when they sign up with the same email.`
          : result.error,
      );
    } catch {
      setNote("That file could not be read.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <label className={`${quietButtonClass} cursor-pointer px-0`}>
        {busy ? "Importing…" : "⇪ Import old Porchbook (members backup)"}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void choose(file);
          }}
        />
      </label>
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
    </div>
  );
}
