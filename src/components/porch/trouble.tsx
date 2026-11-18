import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { askPorch, handleTrouble, loadTrouble, myThanks, seenThanks, sendTrouble, type TroubleReport } from "@/lib/porch/trouble";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { ShelfFace, useShelfPhoto } from "@/components/porch/shelf";
import { BookHide } from "@/components/porch/hide";
import { getTourMode, subscribeTourMode, toggleTourMode } from "@/lib/porch/tour-mode";
import { EditWordsButton, W, useWord } from "@/components/porch/words";

const OPEN = "porch-trouble";
const CLOSE = "porch-trouble-close";

function pageName(path: string) {
  if (path === "/") return "Home";
  if (path.startsWith("/next")) return "Tour";
  if (path.startsWith("/messages")) return "Messages";
  if (path.startsWith("/groups")) return "Groups";
  if (path.startsWith("/offices")) return "Offices";
  if (path.startsWith("/people")) return "People";
  if (path.startsWith("/roll")) return "The roll";
  if (path.startsWith("/call")) return "Call";
  return path;
}

function privatePage(path: string) {
  return path.startsWith("/messages") || path.startsWith("/groups");
}

async function snapPage(): Promise<string> {
  const node = document.querySelector("main");
  if (!node) return "";
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(node, {
      scale: 0.45,
      useCORS: true,
      logging: false,
      backgroundColor: "#07140c",
    });
    const picture = canvas.toDataURL("image/jpeg", 0.62);
    if (picture.length <= 500_000) return picture;
    const smaller = canvas.toDataURL("image/jpeg", 0.35);
    return smaller.length <= 500_000 ? smaller : "";
  } catch {
    return "";
  }
}

function hintFor(shown: string): string {
  const text = shown.toLowerCase();
  if (!text) return "";
  if (text.includes("nine") || text.includes("red number") || text.includes("not finished")) {
    return "A red number needs 9 digits. Finish it, then send again.";
  }
  if (text.includes("manifest centre") || text.includes("manifest center")) {
    return "Type the Manifest centre you are in, at the top of My 20, then save.";
  }
  if (text.includes("one name and number")) {
    return "Put one name and one number on each line, then tap Fill.";
  }
  if (text.includes("name or a number")) {
    return "Type at least one name, or one number, before you save.";
  }
  if (text.includes("microphone") || text.includes("permission denied") || text.includes("not allowed")) {
    return "Open the phone settings, allow the microphone for Porchbook, and try the call again.";
  }
  if (text.includes("notification") || text.includes("alerts")) {
    return "Allow notifications for Porchbook, then turn alerts on again.";
  }
  if (text.includes("make the list") || text.includes("everyone's list")) {
    return "Tap Everyone's lists again. If the phone asks where to keep the file, choose a place. If nothing opens, install the latest Porchbook from Tour.";
  }
  if (text.includes("48 mb") || text.includes("too large") || text.includes("didn't upload")) {
    return "Use a shorter video, or paste a link instead.";
  }
  if (text.includes("mp4")) return "Use an mp4, mov, or webm video.";
  if (text.includes("real email")) return "Type the full email address, including the @.";
  if (text.includes("8 character")) return "Use a password of at least 8 characters.";
  if (text.includes("why not yet")) return "Write the reason, then tap Not yet again.";
  return "";
}

const ENGLISH =
  /\b(the|this|that|i|it|my|is|was|on|to|for|and|but|please|button|page|number|list|video|call|app|not|did|can|open|save|when|with|from|have|has|post|mine|pray|serve|transport|location|microphone|alert|pdf|office|chat|message|home|tour)\b/i;

function clearEnglish(words: string): boolean {
  return ENGLISH.test(words);
}

const KNOWN = new Set(
  "the this that you your me my we our it is was are were be been am on to for and but please button page number list video call app not did can open save when with from have has post mine pray serve transport location microphone alert pdf office chat message home tour didnt doesnt dont cant couldnt wont nothing never fail failed error stuck blank missing broken wrong glitch bug issue problem crash crashed slow empty blocked denied red what how why where who which about after again also back before could first get go had just know like make more now one other out over said see she some than then there these time two use very want way well will would work working try again phone name centre center people file upload link sound office holder".split(
    /\s+/,
  ),
);

function oneAway(word: string, known: string): boolean {
  if (Math.abs(word.length - known.length) > 1) return false;
  let skips = 0;
  let i = 0;
  let j = 0;
  while (i < word.length && j < known.length) {
    if (word[i] === known[j]) {
      i += 1;
      j += 1;
      continue;
    }
    skips += 1;
    if (skips > 1) return false;
    if (word.length === known.length) {
      i += 1;
      j += 1;
    } else if (word.length > known.length) i += 1;
    else j += 1;
  }
  return skips + (word.length - i) + (known.length - j) === 1;
}

function needsAsk(text: string): boolean {
  const tokens = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  if (tokens.length === 0) return true;
  const unknown = tokens.filter((token) => !KNOWN.has(token));
  if (unknown.length === 0) return false;
  if (unknown.some((token) => [...KNOWN].some((known) => oneAway(token, known)))) return true;
  const knownCount = tokens.length - unknown.length;
  return knownCount === 0;
}

const FILES = [
  { key: "urgent", label: "URGENT" },
  { key: "unclear", label: "UNCLEAR" },
  { key: "local", label: "LOCAL" },
  { key: "praise", label: "PRAISE" },
] as const;

function when(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function Fault({ text, className = "mt-2" }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <div className={className}>
      <p data-fault="" className="text-sm text-danger">{text}</p>
      <button type="button" className="mt-1 text-xs font-semibold text-muted" onClick={() => window.dispatchEvent(new CustomEvent(OPEN, { detail: text }))}>
        This didn't work
      </button>
    </div>
  );
}

function Speaker() {
  return <img src="/speaker.png" alt="" className="size-16 shrink-0 rounded-full object-cover object-[72%_18%]" draggable={false} />;
}

export function TroubleBar() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState("");
  const [help, setHelp] = useState("");
  const [words, setWords] = useState("");
  const [picture, setPicture] = useState("");
  const [sendPicture, setSendPicture] = useState(true);
  const [sent, setSent] = useState(false);
  const [step, setStep] = useState<"choose" | "praise" | "praised" | "write" | "check" | "answer" | "passed">("write");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reports, setReports] = useState<TroubleReport[] | null>(null);
  const [file, setFile] = useState<(typeof FILES)[number] | null>(null);
  const [founder, setFounder] = useState(false);
  const [ticking, setTicking] = useState(0);
  const [line, setLine] = useState("");
  const [tickNote, setTickNote] = useState("");
  const [thanks, setThanks] = useState<{ id: number; words: string; text: string }[]>([]);
  const privateChat = privatePage(path);
  const hWhat = useWord("feedback.what-hint", "What happened?");
  useShelfPhoto();
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const faults = Array.from(document.querySelectorAll("[data-fault]"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      // From the menu or the porch guy: "__choose" asks what kind of feedback, "__praise" / "__problem" go straight there.
      const wish = detail === "__choose" || detail === "__praise" || detail === "__problem" ? detail : "";
      const text = typeof detail === "string" && detail && !wish ? detail : faults.join(" · ");
      setShown(text);
      setHelp(wish === "__praise" ? "" : hintFor(text));
      setWords("");
      setSent(false);
      setStep(wish === "__praise" ? "praise" : wish === "__choose" && !text ? "choose" : "write");
      setNote("");
      setSendPicture(!privatePage(window.location.pathname));
      setOpen(true);
      void snapPage().then(setPicture);
    };
    window.addEventListener(OPEN, onOpen);
    return () => window.removeEventListener(OPEN, onOpen);
  }, []);

  useEffect(() => {
    const onClose = () => setOpen(false);
    window.addEventListener(CLOSE, onClose);
    return () => window.removeEventListener(CLOSE, onClose);
  }, []);

  useEffect(
    () =>
      subscribeTourMode(() => {
        if (getTourMode() !== "feedback") setOpen(false);
      }),
    [],
  );

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && getTourMode() === "feedback") toggleTourMode("feedback");
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    loadTrouble({ data: { ...seed, reports: false } })
      .then((result) => {
        if (!cancel) setFounder(result.founder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // The signed-in person is what decides who may read reports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    myThanks()
      .then((result) => {
        if (!cancel) setThanks(result.notes);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id]);

  function closeThanks() {
    const ids = thanks.map((note) => note.id);
    setThanks([]);
    void seenThanks({ data: { ids } }).catch(() => undefined);
  }

  async function markHandled(report: TroubleReport) {
    setTickNote("");
    const result = await handleTrouble({ data: { id: report.id, line } }).catch(() => null);
    if (!result?.ok) {
      setTickNote(result?.error ?? "Couldn't mark it. Try again.");
      return;
    }
    setReports((current) =>
      current ? [...current.filter((item) => item.id !== report.id), { ...report, handled: true, reply: line.trim() }] : current,
    );
    setTicking(0);
    setLine("");
  }

  async function sendPraise() {
    if (!words.trim()) {
      setNote("Write what you enjoy most.");
      return;
    }
    setBusy(true);
    setNote("");
    const result = await sendTrouble({
      data: { ...seed, page: `${pageName(path)} ${path}`, words, shown: "", picture: "", kind: "praise" },
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't send. Try again.");
      return;
    }
    setStep("praised");
  }

  async function fileNote(kind: "urgent" | "unclear" | "local") {
    setBusy(true);
    setNote("");
    const result = await sendTrouble({
      data: {
        ...seed,
        page: `${pageName(path)} ${path}`,
        words,
        shown,
        picture: sendPicture ? picture : "",
        kind,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      setStep("write");
      return;
    }
    setStep("passed");
  }

  function ask() {
    if (!words.trim()) {
      setNote("Write what happened.");
      return;
    }
    setNote("");
    if (needsAsk(words)) {
      setStep("check");
      return;
    }
    confirmTyped();
  }

  async function confirmTyped() {
    if (!clearEnglish(words)) {
      void fileNote("local");
      return;
    }
    const known = hintFor(shown) || hintFor(words);
    if (known) {
      setHelp(known);
      setStep("answer");
      return;
    }
    setBusy(true);
    setStep("answer");
    setHelp("");
    const result = await askPorch({
      data: { ...seed, page: `${pageName(path)} ${path}`, words, shown },
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setHelp("");
      setNote("I could not answer just now. Please try again.");
      setStep("write");
      return;
    }
    if (result.action === "needs") {
      void fileNote("urgent");
      return;
    }
    if (result.action === "answer") {
      setHelp(result.reply);
      setStep("answer");
      return;
    }
    void fileNote("unclear");
  }

  async function openFile(next: (typeof FILES)[number]) {
    const result = await loadTrouble({ data: { ...seed, reports: true, kind: next.key } }).catch(() => null);
    if (!result?.founder) return;
    setFounder(true);
    setFile(next);
    setReports(result.reports);
  }

  return (
    <>
      {founder ? (
      <div className={`mt-8 flex flex-wrap items-center gap-4${path === "/next" ? " trouble-foot" : ""}`}>
        <button type="button" className="text-xs font-semibold text-ink" onClick={() => setReports(reports ? null : [])}>
          User's complaints
        </button>
        <EditWordsButton className="text-xs font-semibold text-[#f8a018]" />
      </div>
      ) : null}
      {reports ? (
        <section className="mt-3">
          <h2 className="font-display text-xl text-ink">User's complaints</h2>
          {file ? (
            <ul className="mt-3 space-y-3">
              <li className="font-display text-lg text-ink">{file.label}</li>
              {reports.length === 0 ? <li className="text-sm text-muted">Nothing in this file yet.</li> : null}
              {reports.map((report, index) => (
                <li key={report.id} className="rounded-2xl glass-edge bg-card p-3">
                  {report.handled && !reports[index - 1]?.handled ? <p className="-mt-1 mb-2 font-display text-lg text-ink">Done</p> : null}
                  <p className="text-sm font-semibold text-ink">{report.name}</p>
                  <p className="text-xs text-muted">{when(report.createdAt)}</p>
                  <p className="mt-2 text-sm text-ink">
                    <span className="font-semibold">Page. </span>
                    {report.page}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                    <span className="font-semibold">What they wrote. </span>
                    {report.words}
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold">What Porchbook was saying. </span>
                    <span className={report.shown ? "text-danger" : "text-muted"}>{report.shown || "Nothing"}</span>
                  </p>
                  {report.picture ? <img src={report.picture} alt="" className="mt-2 max-h-64 w-full rounded-lg object-contain object-left-top" /> : null}
                  {report.handled ? (
                    <p className="mt-2 text-sm font-semibold text-[#f8a018]">
                      ✓ Handled{report.reply ? <span className="font-normal text-ink">{" — "}{report.reply}</span> : null}
                    </p>
                  ) : ticking === report.id ? (
                    <div className="mt-3">
                      <input
                        value={line}
                        onChange={(event) => setLine(event.target.value)}
                        maxLength={300}
                        placeholder="Add a line (optional)"
                        className={fieldClass}
                      />
                      <p className="mt-1 text-xs text-muted">
                        They'll read: "Thank you for your feedback. It's been handled.{line.trim() ? ` ${line.trim()}` : ""}"
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className={primaryButtonClass} onClick={() => void markHandled(report)}>
                          Send thank-you
                        </button>
                        <button type="button" className={quietButtonClass} onClick={() => setTicking(0)}>
                          Cancel
                        </button>
                      </div>
                      {tickNote ? <p className="mt-2 text-sm text-danger">{tickNote}</p> : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-3 text-sm font-bold text-[#f8a018]"
                      onClick={() => {
                        setTicking(report.id);
                        setLine("");
                        setTickNote("");
                      }}
                    >
                      ☐ Handled
                    </button>
                  )}
                </li>
              ))}
              <li>
                <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setFile(null)}>
                  Close the file
                </button>
              </li>
            </ul>
          ) : (
            <>
            <div className="shelf-bay mt-3">
              <ShelfFace />
              <div className="shelf-row">
                <div className="flex h-full items-end gap-3 px-2">
                {FILES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => void openFile(item)}
                    className="no-sink relative flex h-[90%] w-[7.6rem] shrink-0 overflow-hidden rounded-sm shadow-[4px_6px_8px_rgba(0,0,0,0.4)]"
                  >
                    <span className="w-2 shrink-0 bg-black" aria-hidden="true" />
                    <BookHide className="relative flex min-w-0 flex-1 flex-col items-center justify-center px-2">
                      <span className="butterfly butterfly-still absolute right-1.5 bottom-1.5 size-5 shrink-0" aria-hidden="true">
                        <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
                        <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
                      </span>
                      <span className="book-title absolute top-1.5 right-1 left-1 text-center text-xs leading-tight break-words">{item.label}</span>
                    </BookHide>
                  </button>
                ))}
                </div>
              </div>
            </div>
            <button type="button" className={`${quietButtonClass} mt-2 px-0`} onClick={() => setReports(null)}>
              Close
            </button>
            </>
          )}
        </section>
      ) : null}
      {thanks.length && !open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl glass-edge bg-card p-4">
            <div className="flex items-start gap-3">
              <Speaker />
              <div className="min-w-0">
                {thanks.map((note) => (
                  <div key={note.id} className="mb-3">
                    <p className="text-sm text-ink">{note.text}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">You wrote: {note.words}</p>
                  </div>
                ))}
                <button type="button" className={`${quietButtonClass} px-0`} onClick={closeThanks}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl glass-edge bg-card p-4">
            {sent ? (
              <div className="flex items-start gap-3">
                <Speaker />
                <div>
                  <p className="text-sm text-ink"><W k="feedback.helped">Glad I was of help.</W></p>
                  <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : step === "choose" ? (
              <>
                <h2 className="font-display text-xl text-ink"><W k="feedback.title">Feedback</W></h2>
                <div className="mt-3 grid gap-2">
                  <button type="button" className="fb-choice" onClick={() => setStep("write")}>
                    <span aria-hidden="true">🛠️</span> Report a problem
                  </button>
                  <button type="button" className="fb-choice is-praise" onClick={() => setStep("praise")}>
                    <span aria-hidden="true">💛</span> Tell us what you enjoy most
                  </button>
                </div>
                <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </>
            ) : step === "praise" ? (
              <>
                <h2 className="font-display text-xl text-ink">💛 What do you enjoy most?</h2>
                <textarea
                  value={words}
                  onChange={(event) => setWords(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder="Tell us what you enjoy most on Porchbook…"
                  className={`${fieldClass} mt-3`}
                />
                {note ? <p className="mt-2 text-sm text-danger">{note}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void sendPraise()}>
                    Send
                  </button>
                  <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : step === "praised" ? (
              <div className="flex items-start gap-3">
                <Speaker />
                <div>
                  <p className="text-sm text-ink">Thank you! That made our day. I'll pass it to the team.</p>
                  <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : step === "passed" ? (
              <div className="flex items-start gap-3">
                <Speaker />
                <div>
                  <p className="text-sm text-ink"><W k="feedback.passed">I will pass this to the team.</W></p>
                  <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : step === "check" ? (
              <div className="flex items-start gap-3">
                <Speaker />
                <div>
                  <p className="whitespace-pre-wrap text-sm text-ink">You wrote: {words}</p>
                  <p className="mt-2 text-sm text-ink">Did you type that right?</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className={primaryButtonClass} disabled={busy} onClick={confirmTyped}>
                      Yes
                    </button>
                    <button
                      type="button"
                      className={quietButtonClass}
                      onClick={() => {
                        setWords("");
                        setStep("write");
                      }}
                    >
                      No
                    </button>
                  </div>
                </div>
              </div>
            ) : step === "answer" ? (
              <div className="flex items-start gap-3">
                <Speaker />
                <div>
                  <p className="text-sm text-ink">{help || "Looking…"}</p>
                  {help ? (
                    <div className="mt-3 flex gap-2">
                      <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => setSent(true)}>
                        That helped
                      </button>
                      <button type="button" className={quietButtonClass} disabled={busy} onClick={() => void fileNote("urgent")}>
                        Still stuck
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : help ? (
              <>
                <h2 className="font-display text-xl text-ink"><W k="feedback.try-first">Try this first</W></h2>
                <p className="mt-2 text-sm text-ink">{help}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={primaryButtonClass} onClick={() => setHelp("")}>
                    That didn't help
                  </button>
                  <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-xl text-ink"><W k="feedback.title">Feedback</W></h2>
                <p className="mt-1 text-sm text-muted">{pageName(path)}</p>
                {shown ? <p className="mt-2 text-sm text-danger">{shown}</p> : null}
                {picture && sendPicture ? <img src={picture} alt="" className="mt-3 max-h-40 w-full rounded-lg object-contain object-left-top" /> : null}
                {privateChat ? (
                  <label className="mt-3 flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={sendPicture} onChange={(event) => setSendPicture(event.target.checked)} />
                    <W k="feedback.picture">Send a picture of this page</W>
                  </label>
                ) : null}
                <textarea
                  value={words}
                  onChange={(event) => setWords(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={hWhat}
                  className={`${fieldClass} mt-3`}
                />
                {note ? <p className="mt-2 text-sm text-danger">{note}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button type="button" className={primaryButtonClass} disabled={busy} onClick={ask}>
                    Send
                  </button>
                  <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
