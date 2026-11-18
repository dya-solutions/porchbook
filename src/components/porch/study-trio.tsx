/** Bible · Devotional · Notes — one tap between the three, the current one lit. */
export type StudyPlace = "bible" | "devotion" | "notes";

const keys: { id: StudyPlace; label: string; mark: string }[] = [
  { id: "bible", label: "Bible", mark: "📖" },
  { id: "devotion", label: "Devotional", mark: "☀" },
  { id: "notes", label: "Notes", mark: "✎" },
];

export function StudyTrio({ current, onPick }: { current: StudyPlace; onPick: (to: StudyPlace) => void }) {
  return (
    <nav className="study-trio" aria-label="Bible, Devotional and Notes">
      {keys.map((key) => (
        <button
          key={key.id}
          type="button"
          className={key.id === current ? "is-on" : ""}
          aria-current={key.id === current ? "page" : undefined}
          onClick={() => {
            if (key.id !== current) onPick(key.id);
          }}
        >
          <span aria-hidden="true">{key.mark}</span> {key.label}
        </button>
      ))}
    </nav>
  );
}
