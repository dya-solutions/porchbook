// Stage 4f: the Porchbook FAQ (decision 23). Sections, a search box, short answers that open in
// place. Works signed in or out. The platform owner gets "Edit the FAQ" on the same page.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { editFaq, loadFaq, loadFaqForOwner, type FaqItem } from "@/lib/porch/faq";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandLogo } from "@/components/porch/brand-logo";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function sectionsOf(items: FaqItem[]) {
  const order: string[] = [];
  const by = new Map<string, FaqItem[]>();
  for (const item of items) {
    if (!by.has(item.section)) {
      by.set(item.section, []);
      order.push(item.section);
    }
    by.get(item.section)?.push(item);
  }
  return order.map((section) => ({ section, items: by.get(section) ?? [] }));
}

export function FaqView() {
  const { user, isPending } = useCurrentUserState();
  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [owner, setOwner] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isPending) return;
    let cancel = false;
    const load = user
      ? loadFaqForOwner().then((result) => {
          if (cancel) return;
          setOwner(result.owner);
          setItems(result.items);
        })
      : loadFaq().then((list) => !cancel && setItems(list));
    load.catch(() => !cancel && setError("Couldn't open the FAQ. Check your connection and try again."));
    return () => {
      cancel = true;
    };
  }, [user, isPending, tick]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (items ?? []).filter((item) => !needle || `${item.section} ${item.question} ${item.answer}`.toLowerCase().includes(needle)),
    [items, needle],
  );
  const reload = () => setTick((value) => value + 1);

  return (
    <main className="pb faq">
      <header className="faq-top">
        <button type="button" className="pb-iconbtn" aria-label="Back" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/"))}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <BrandLogo kind="mark" height={30} />
        <p className="pb-ttl" style={{ fontSize: 19, flex: 1 }}>Help and FAQ</p>
      </header>
      <div className="faq-in">
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>Questions?</h1>
        <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>Short answers about Porchbook. Tap a question to open it.</p>
        <label className="pb-search" style={{ marginTop: 14 }}>
          <span className="sr-only">Search the questions</span>
          <span className="pb-search-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          </span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the questions" />
        </label>

        {owner ? (
          <div className="ofc-admin" style={{ marginTop: 12 }}>
            <button type="button" className={editing ? "pb-btn" : "pb-btn2"} onClick={() => setEditing((value) => !value)}>
              {editing ? "Done editing" : "Edit the FAQ"}
            </button>
          </div>
        ) : null}
        {owner && editing ? <FaqForm sections={sectionsOf(items ?? []).map((s) => s.section)} onDone={reload} /> : null}

        {error ? <p className="text-danger">{error}</p> : null}
        {items && !shown.length ? <p className="pb-quiet" style={{ marginTop: 16 }}>No question matches that. Try another word.</p> : null}

        {sectionsOf(shown).map((block) => (
          <section key={block.section} style={{ marginTop: 18 }}>
            <p className="ofc-sec" style={{ margin: "0 4px 8px" }}>{block.section}</p>
            <div className="pb-card faq-list">
              {block.items.map((item) =>
                editing ? (
                  <FaqEditRow key={item.id} item={item} sections={sectionsOf(items ?? []).map((s) => s.section)} onDone={reload} />
                ) : (
                  <details key={item.id} className="faq-q" open={Boolean(needle)}>
                    <summary>
                      <span>{item.question}</span>
                      <svg className="faq-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </summary>
                    <p className="faq-a">{item.answer}</p>
                    {item.check ? <p className="faq-check">Marked for you to check</p> : null}
                  </details>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function FaqForm({ sections, onDone }: { sections: string[]; onDone: () => void }) {
  const [section, setSection] = useState(sections[0] ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    const result = await editFaq({ data: { action: "add", section, question, answer } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save.");
      return;
    }
    setQuestion("");
    setAnswer("");
    setNote("Added.");
    onDone();
  }
  return (
    <form className="pb-card ofc-form" style={{ marginTop: 12 }} onSubmit={add}>
      <p className="ofc-name">Add a question</p>
      <label className="ofc-lbl">
        Section (choose one, or type a new one)
        <input className="ofc-input" list="faq-sections" value={section} onChange={(event) => setSection(event.target.value)} />
        <datalist id="faq-sections">
          {sections.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label className="ofc-lbl">
        Question
        <input className="ofc-input" value={question} maxLength={200} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <label className="ofc-lbl">
        Short answer
        <textarea className="ofc-input" style={{ minHeight: 100, padding: 12 }} value={answer} maxLength={1200} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      {note ? <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      <button type="submit" className="pb-btn" disabled={!section.trim() || !question.trim() || !answer.trim()}>Add question</button>
    </form>
  );
}

function FaqEditRow({ item, sections, onDone }: { item: FaqItem; sections: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(item.section);
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  async function act(action: "save" | "remove" | "up" | "down", checked = false) {
    const result = await editFaq({ data: { action, id: item.id, section, question, answer, checked } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save.");
      return;
    }
    setOpen(false);
    onDone();
  }
  if (!open) {
    return (
      <div className="faq-edit-row">
        <span className="faq-edit-q">
          {item.question}
          {item.check ? <span className="faq-check" style={{ display: "block" }}>Marked for you to check</span> : null}
        </span>
        <button type="button" className="pb-link" aria-label="Move up" onClick={() => void act("up")}>↑</button>
        <button type="button" className="pb-link" aria-label="Move down" onClick={() => void act("down")}>↓</button>
        <button type="button" className="pb-link" style={{ color: "var(--pb-main)" }} onClick={() => setOpen(true)}>Edit</button>
      </div>
    );
  }
  return (
    <div className="ofc-form">
      <label className="ofc-lbl">
        Section
        <input className="ofc-input" list={`faq-sections-${item.id}`} value={section} onChange={(event) => setSection(event.target.value)} />
        <datalist id={`faq-sections-${item.id}`}>
          {sections.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label className="ofc-lbl">
        Question
        <input className="ofc-input" value={question} maxLength={200} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <label className="ofc-lbl">
        Short answer
        <textarea className="ofc-input" style={{ minHeight: 100, padding: 12 }} value={answer} maxLength={1200} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      {note ? <p className="text-danger" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      <div className="ofc-admin">
        <button type="button" className="pb-btn" onClick={() => void act("save", true)}>{item.check ? "Save (checked)" : "Save"}</button>
        <button type="button" className="pb-btn2" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {confirm ? (
        <p style={{ margin: 0, fontSize: 14 }}>
          Remove this question for everyone?{" "}
          <button type="button" className="welcome-link" onClick={() => void act("remove")}>Yes, remove</button>{" "}
          <button type="button" className="welcome-link" style={{ color: "var(--pb-quiet)" }} onClick={() => setConfirm(false)}>Cancel</button>
        </p>
      ) : (
        <button type="button" className="pb-link text-danger" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setConfirm(true)}>
          Remove this question
        </button>
      )}
    </div>
  );
}
