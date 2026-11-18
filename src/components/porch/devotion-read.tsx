import { useEffect, useMemo, useRef, useState } from "react";
import { useLite } from "@/lib/porch/lite";
import type { Seed } from "@/lib/porch/model";
import { addOwnDevotion, approveRunyankore, devotionRunyankore } from "@/lib/porch/devotion-runyankore";

type Sheet = { name: string; html: string };

// "…walk in them. Ephesians 2:10 (KJV)" → the verse, and "EPHESIANS 2:10 · KJV"
const REFERENCE = /^([\s\S]*?)[\s—–-]*\(?\s*((?:[1-3]\s?)?[A-Z][A-Za-z]+\.?(?:\s(?:of\s)?[A-Z][a-z]+)?\s\d{1,3}\s?:\s?\d{1,3}(?:\s?[-–,]\s?\d{1,3})*)\s*(?:\(?\s*([A-Z]{2,6})\s*\)?)?\s*\)?\s*\.?$/;

// "Isaiah 55:10–11 (NKJV): “For as the rain…”" → reference first, then the verse
const REFERENCE_FIRST = /^\(?\s*((?:[1-3]\s?)?[A-Z][A-Za-z]+\.?(?:\s(?:of\s)?[A-Z][a-z]+)?\s\d{1,3}\s?:\s?\d{1,3}(?:\s?[-–,]\s?\d{1,3})*)\s*(?:\(?\s*([A-Z]{2,6})\s*\)?)?\s*\)?\s*[:—–-]\s*([\s\S]{12,})$/;

/** The opening scripture (right after the author) shown as a scripture card. */
function withScriptureCard(html: string) {
  const paragraphs = [...html.matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/g)];
  const candidates = paragraphs.filter((m) => !/class="author"/.test(m[1] ?? "")).slice(0, 2);
  for (const match of candidates) {
    const inner = match[2].trim();
    if (inner.length > 700 || /<[a-z]/i.test(inner)) continue;
    const after = REFERENCE.exec(inner);
    const before = REFERENCE_FIRST.exec(inner);
    const found: [string, string, string | undefined] | null =
      before ? [before[3], before[1], before[2]] : after && after[1].trim().length >= 12 ? [after[1], after[2], after[3]] : null;
    if (!found) continue;
    const verse = found[0].trim().replace(/^(?:["“]|&quot;|&#8220;|&ldquo;)+|(?:["”]|&quot;|&#8221;|&rdquo;)+$/g, "");
    const reference = [found[1].replace(/\s+/g, " ").toUpperCase(), found[2]].filter(Boolean).join(" · ");
    const card = `<figure class="devotion-verse"><p>“${verse}”</p><figcaption>${reference}</figcaption></figure>`;
    return html.replace(match[0], card);
  }
  return html;
}

/** Today's devotional, in English, as one page you scroll. */
export function DevotionRead({
  sheets,
  link = "",
  founder = false,
}: {
  sheets: Sheet[];
  link?: string;
  founder?: boolean;
  seed?: Seed;
}) {
  const english = sheets.find((sheet) => /^english$/i.test(sheet.name)) ?? sheets[0] ?? null;
  // English | Runyankore | Luganda: Phaneroo's own copy when published, otherwise machine translated.
  type Local = "nyn" | "lug";
  type Copy = { html: string; source: string; error: string; busy: boolean; review?: boolean };
  const EMPTY: Copy = { html: "", source: "", error: "", busy: false };
  const NAME: Record<Local, string> = { nyn: "Runyankore", lug: "Luganda" };
  const [tongue, setTongue] = useState<"en" | Local>("en");
  const [copies, setCopies] = useState<Record<Local, Copy>>({ nyn: EMPTY, lug: EMPTY });
  const local: Local | null = tongue === "en" ? null : tongue;
  const runya: Copy = local ? copies[local] : EMPTY;
  const setCopy = (lang: Local, change: (c: Copy) => Copy) => setCopies((all) => ({ ...all, [lang]: change(all[lang]) }));
  // The founder's check of a machine translation: the text is editable until approved.
  const checkBox = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<{ busy: boolean; note: string }>({ busy: false, note: "" });
  // The founder's own copy (when Phaneroo hasn't published one, or to replace Sunbird's).
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  async function saveOwn() {
    if (!local) return;
    const lang = local;
    setCheck({ busy: true, note: "" });
    const result = await addOwnDevotion({ data: { link, lang, text: draft } }).catch(() => null);
    if (result?.ok) {
      setCopy(lang, () => ({ html: result.html, source: "founder", error: "", busy: false, review: false }));
      setWriting(false);
      setDraft("");
      setCheck({ busy: false, note: "Saved: everyone can read it now." });
    } else setCheck({ busy: false, note: result && !result.ok ? result.error : "Couldn't save it. Check your data." });
  }
  useEffect(() => {
    setTongue("en");
    setCopies({ nyn: EMPTY, lug: EMPTY });
    setCheck({ busy: false, note: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new day starts fresh
  }, [link]);
  async function approve() {
    if (!local) return;
    const lang = local;
    const html = checkBox.current?.innerHTML ?? "";
    setCheck({ busy: true, note: "" });
    const result = await approveRunyankore({ data: { link, html, lang } }).catch(() => null);
    if (result?.ok) {
      setCopy(lang, (r) => ({ ...r, html: result.html, review: false }));
      setCheck({ busy: false, note: "Approved: everyone can read it now." });
    } else setCheck({ busy: false, note: result && !result.ok ? result.error : "Couldn't approve it. Check your data." });
  }
  async function pick(lang: Local) {
    setTongue(lang);
    setCheck({ busy: false, note: "" });
    setWriting(false);
    if (copies[lang].html || copies[lang].busy) return;
    setCopy(lang, (r) => ({ ...r, busy: true, error: "" }));
    const result = await devotionRunyankore({ data: { link, lang } }).catch(() => null);
    setCopy(lang, () =>
      result?.ok
        ? { html: result.html, source: result.source, error: "", busy: false, review: result.review }
        : { html: "", source: "", error: result && !result.ok ? result.error : `Couldn't get the ${NAME[lang]} copy. Check your data.`, busy: false },
    );
  }
  // The day's picture (when the devotional has one) is taken out of the text and shown at the top,
  // and again blurred behind the whole page.
  const { picture, body } = useMemo(() => {
    const html = english?.html ?? "";
    const tag = /<img class="devotion-picture" src="([^"]+)"[^>]*>/.exec(html);
    return { picture: tag?.[1] ?? "", body: tag ? html.replace(tag[0], "") : html };
  }, [english?.html]);
  const shown = useMemo(() => withScriptureCard(local && runya.html ? runya.html : body), [body, local, runya.html]);
  const lite = useLite();
  const day = useMemo(() => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase(), []);

  const sheet = (
    <article className={`devotion-sheet ${picture && !lite ? "devotion-glass" : ""}`}>
      <p className="devotion-day">{day}</p>
      <div className="devotion-tongues" role="group" aria-label="Language">
        <button type="button" className={tongue === "en" ? "is-on" : ""} aria-pressed={tongue === "en"} onClick={() => setTongue("en")}>
          English
        </button>
        <button type="button" className={tongue === "nyn" ? "is-on" : ""} aria-pressed={tongue === "nyn"} onClick={() => void pick("nyn")}>
          Runyankore
        </button>
        <button type="button" className={tongue === "lug" ? "is-on" : ""} aria-pressed={tongue === "lug"} onClick={() => void pick("lug")}>
          Luganda
        </button>
      </div>
      {local && runya.source === "machine" ? (
        <p className="devotion-tongue-note">Machine translated (Sunbird AI). It may have mistakes; the English is Phaneroo&apos;s original.</p>
      ) : null}
      {local && runya.source === "founder" ? <p className="devotion-tongue-note">Translated by Phaneroo Ministries Mbarara.</p> : null}
      {local && runya.busy ? <p className="devotion-tongue-note">Getting the {NAME[local]} copy…</p> : null}
      {local && founder && !runya.busy && (!runya.html || runya.source === "machine") ? (
        writing ? (
          <div className="devotion-own">
            <p>
              Paste or type today&apos;s {NAME[local]}. Leave a blank line between paragraphs; a short line ending in “:” becomes a heading.
            </p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} placeholder={`Today's devotional in ${NAME[local]}…`} />
            <div className="devotion-own-acts">
              <button type="button" className="devotion-approve" disabled={check.busy || !draft.trim()} onClick={() => void saveOwn()}>
                {check.busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="devotion-own-cancel" onClick={() => setWriting(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="devotion-own-open" onClick={() => setWriting(true)}>
            {runya.html ? "✍ Replace with my own" : `✍ Add today's ${NAME[local]}`}
          </button>
        )
      ) : null}
      {local && runya.error ? <p className="devotion-tongue-note">{runya.error}</p> : null}
      {local && runya.review && founder ? (
        <div className="devotion-check">
          <p>
            <b>Waiting for your check.</b> Only you can see this. Tap any line to correct it, then approve. Others read English until then.
          </p>
          <button type="button" className="devotion-approve" disabled={check.busy} onClick={() => void approve()}>
            {check.busy ? "Approving…" : "✓ Approve"}
          </button>
        </div>
      ) : null}
      {check.note && local ? <p className="devotion-tongue-note">{check.note}</p> : null}
      {local && runya.review && founder ? (
        <div key={local ?? "en"} ref={checkBox} className="devotion-editing" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: runya.html }} />
      ) : local && !runya.html ? null : (
        <div dangerouslySetInnerHTML={{ __html: shown }} />
      )}
    </article>
  );
  // Lite mode, or no picture today: the plain paper page.
  if (!picture || lite) {
    return (
      <div className="devotion-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {sheet}
      </div>
    );
  }
  return (
    <div className="devotion-frame">
      <div aria-hidden="true" className="devotion-backdrop" style={{ backgroundImage: `url("${picture}")` }} />
      <div aria-hidden="true" className="devotion-backdrop-shade" />
      <div className="devotion-scroll devotion-on-picture min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        <img className="devotion-hero" src={picture} alt="" />
        {sheet}
      </div>
    </div>
  );
}
