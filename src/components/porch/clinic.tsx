import { useEffect, useRef, useState } from "react";
import { CLINIC_TOPICS, titleSuits, topicOf, type ClinicTopic } from "@/lib/porch/clinic-topics";
import {
  askClinic,
  clinicAnswer,
  clinicCloseVote,
  clinicDesk,
  clinicGroup,
  clinicHide,
  clinicHome,
  clinicPdf,
  clinicSetVideo,
  clinicStartVote,
  clinicTag,
  clinicUngroup,
  voteClinic,
} from "@/lib/porch/clinic";
import { sendFmRequest } from "@/lib/porch/fm";
import { hearAgain, stopAgain } from "@/components/porch/radio-news";
import { toast, useBackLayer } from "@/lib/porch/back-stack";
import { toggleTourMode } from "@/lib/porch/tour-mode";
import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";

/**
 * Porchbook Clinic (on the tour): "What are you believing God for?"
 * Cards of sermons by what they answer, a monthly vote for Apostle Grace, and Ask a Pastor.
 */

type Home = Extract<Awaited<ReturnType<typeof clinicHome>>, { show: true }>;
type Track = Home["tracks"][number];
type Mine = Home["mine"][number];
type Answer = NonNullable<Mine["answer"]>;
type Desk = Extract<Awaited<ReturnType<typeof clinicDesk>>, { ok: true }>;

type View = { at: "cards" } | { at: "topic"; key: string } | { at: "ask" } | { at: "desk" };

function savePdf(pdf: string, filename: string) {
  const host = window as Window & { PorchApp?: { saveFile?: (name: string, data: string) => void } };
  if (typeof host.PorchApp?.saveFile === "function") {
    host.PorchApp.saveFile(filename, pdf);
    return;
  }
  const binary = atob(pdf);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    void navigator.share({ files: [file], title: filename }).catch(() => undefined);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

function daysLeft(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Voting has closed";
  const days = Math.ceil(ms / 86400000);
  return days <= 1 ? "Last day to vote" : `Voting closes in ${days} days`;
}

function shortDay(iso: string) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** One play-once player for the whole Clinic: only one thing plays at a time. */
function usePlayer() {
  const [playing, setPlaying] = useState("");
  useEffect(() => () => stopAgain(), []);
  function play(id: string, url: string, startSec = 0) {
    if (playing === id) {
      stopAgain();
      setPlaying("");
      return;
    }
    setPlaying(id);
    hearAgain(url, () => setPlaying((now) => (now === id ? "" : now)), startSec);
  }
  return { playing, play };
}

/** Open the Clinic straight at a card (coming back from watching its sermon on the porch guy's screen). */
let startAt = "";
export function setClinicStart(key: string) {
  startAt = key;
}

export function ClinicHome() {
  const [home, setHome] = useState<Home | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(() => {
    const key = startAt;
    startAt = "";
    return key && topicOf(key) ? { at: "topic", key } : { at: "cards" };
  });
  const player = usePlayer();

  async function load() {
    try {
      const result = await clinicHome();
      if (!result.show) {
        setFailed(true);
        return;
      }
      setHome(result);
    } catch {
      setFailed(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  useBackLayer(view.at !== "cards", () => setView({ at: "cards" }), "clinic:inner");

  if (failed) return <div className="cx-sheet"><p className="cx-note cx-soon">✚ Clinic coming soon on Porchbook</p></div>;
  if (!home) return <div className="cx-sheet"><p className="cx-note">Opening the Clinic…</p></div>;

  const close = () => toggleTourMode("clinic");

  return (
    <div className="cx-sheet">
      {view.at === "cards" ? (
        <Cards home={home} onOpen={setView} onClose={close} reload={load} />
      ) : view.at === "topic" ? (
        <TopicView home={home} topic={topicOf(view.key)!} back={() => setView({ at: "cards" })} reload={load} player={player} />
      ) : view.at === "ask" ? (
        <AskView home={home} back={() => setView({ at: "cards" })} reload={load} player={player} />
      ) : (
        <DeskView home={home} back={() => setView({ at: "cards" })} reload={load} player={player} />
      )}
    </div>
  );
}

function Head({ onClose }: { onClose: () => void }) {
  return (
    <div className="cx-head">
      <span className="cx-cross" aria-hidden="true">✚</span>
      <div>
        <div className="cx-t">PORCHBOOK CLINIC</div>
        <div className="cx-s">Self Medication with the Word</div>
      </div>
      <button type="button" className="cx-x" aria-label="Close the Clinic" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function Back({ onBack, label = "CLINIC" }: { onBack: () => void; label?: string }) {
  return (
    <button type="button" className="cx-back" onClick={onBack}>
      ‹ {label}
    </button>
  );
}

function Cards({ home, onOpen, onClose, reload }: { home: Home; onOpen: (view: View) => void; onClose: () => void; reload: () => Promise<void> }) {
  const counts = new Map<string, number>();
  for (const t of home.tracks) for (const key of t.topics) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of Object.keys(home.videos)) counts.set(key, (counts.get(key) ?? 0) + 1);
  // Members don't see empty cards; the founder sees them all, to fill.
  const topics = CLINIC_TOPICS.filter((t) => home.founder || (counts.get(t.key) ?? 0) > 0);
  const waiting = home.mine.filter((q) => q.status === "answered").length;
  return (
    <>
      <Head onClose={onClose} />
      {home.founder ? <FounderBar home={home} onDesk={() => onOpen({ at: "desk" })} /> : null}
      {home.vote ? <VoteCard vote={home.vote} reload={reload} /> : null}
      <div className="cx-grid">
        {topics.map((t) => (
          <button key={t.key} type="button" className="cx-card" onClick={() => onOpen({ at: "topic", key: t.key })}>
            <i aria-hidden="true">{t.emoji}</i>
            <b>{t.word}</b>
            <small>{counts.get(t.key) ?? 0}</small>
          </button>
        ))}
        <button type="button" className="cx-card is-ask" onClick={() => onOpen({ at: "ask" })}>
          <i aria-hidden="true">💬</i>
          <b>Ask a Pastor</b>
          {waiting ? <small>{waiting} ✓</small> : null}
        </button>
      </div>
    </>
  );
}

function FounderBar({ home, onDesk }: { home: Home; onDesk: () => void }) {
  return (
    <div className="cx-founder">
      <p>{home.launched ? "🟢 Everyone can see the Clinic." : "🔒 Only you can see the Clinic."}</p>
      <div className="cx-founder-keys">
        <button type="button" className="cx-key is-green" onClick={onDesk}>
          📥 Questions desk
        </button>
      </div>
    </div>
  );
}

function VoteCard({ vote, reload }: { vote: NonNullable<Home["vote"]>; reload: () => Promise<void> }) {
  const [mine, setMine] = useState(vote.myVote);
  const total = vote.options.reduce((sum, o) => sum + o.votes, 0) - (vote.myVote ? 1 : 0) + (mine ? 1 : 0);
  async function pick(id: number) {
    if (id === mine) return;
    const was = mine;
    setMine(id);
    const result = await voteClinic({ data: { groupId: id } });
    if (!result.ok) {
      setMine(was);
      toast(result.error);
      return;
    }
    toast("✅ Voted! Results on the 1st.");
    await reload();
  }
  return (
    <div className="cx-vote">
      <p className="cx-vote-t">🗳 Vote: which question should Apostle Grace answer?</p>
      <p className="cx-vote-left">{daysLeft(vote.closesAt)} · tap to vote</p>
      {vote.options.map((o) => {
        const votes = o.votes - (vote.myVote === o.id ? 1 : 0) + (mine === o.id ? 1 : 0);
        const share = total ? Math.round((votes / total) * 100) : 0;
        return (
          <button key={o.id} type="button" className={`cx-vote-opt${mine === o.id ? " is-mine" : ""}`} onClick={() => void pick(o.id)}>
            <span className="cx-vote-bar" style={{ width: mine ? `${share}%` : "0%" }} />
            <b>{o.wording}</b>
            <span className="cx-vote-meta">
              Asked by {o.asked} {o.asked === 1 ? "member" : "members"}
              {mine ? ` · ${share}%` : ""}
              {mine === o.id ? " · your vote ✓" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SermonRow({ track, topic, founder, player, onRemove }: { track: Track; topic: ClinicTopic; founder: boolean; player: ReturnType<typeof usePlayer>; onRemove?: () => void }) {
  const [asked, setAsked] = useState(false);
  async function request() {
    const result = await sendFmRequest({ data: { kind: "sermon", title: track.title, message: `Clinic · ${topic.word}` } });
    if (!result.ok) {
      toast(result.error);
      return;
    }
    setAsked(true);
    toast("📻 Sent to the radio's requests.");
  }
  const on = player.playing === `t${track.id}`;
  return (
    <div className="cx-row">
      <b>{track.title}</b>
      <span>
        {track.minutes} min{founder && onRemove ? " · " : ""}
        {founder && onRemove ? (
          <button type="button" className="cx-link" onClick={onRemove}>
            Take out of {topic.word}
          </button>
        ) : null}
      </span>
      <div className="cx-acts">
        <button type="button" className="is-g" onClick={() => player.play(`t${track.id}`, track.url)}>
          {on ? "■ STOP" : "▶ LISTEN NOW"}
        </button>
        <button type="button" disabled={asked} onClick={() => void request()}>
          {asked ? "✓ REQUESTED" : "📻 REQUEST ON AIR"}
        </button>
      </div>
    </div>
  );
}

function TopicView({ home, topic, back, reload, player }: { home: Home; topic: ClinicTopic; back: () => void; reload: () => Promise<void>; player: ReturnType<typeof usePlayer> }) {
  const [filing, setFiling] = useState(false);
  const inCard = home.tracks.filter((t) => t.topics.includes(topic.key));
  async function tag(track: Track, on: boolean) {
    const result = await clinicTag({ data: { trackId: track.id, topic: topic.key, on } });
    if (!result.ok) toast(result.error);
    await reload();
  }
  const others = home.tracks.filter((t) => !t.topics.includes(topic.key));
  const suggested = others.filter((t) => titleSuits(t.title, topic));
  const rest = others.filter((t) => !titleSuits(t.title, topic) && t.kind === "preaching");
  return (
    <>
      <div className="cx-head">
        <Back onBack={back} />
      </div>
      <div className="cx-s cx-topic">
        {topic.emoji} {topic.word}
      </div>
      <div className="cx-verse">
        “{topic.verse}”<em>{topic.ref.toUpperCase()}</em>
      </div>
      <VideoSlot home={home} topic={topic} reload={reload} />
      {inCard.length ? (
        inCard.map((t) => <SermonRow key={t.id} track={t} topic={topic} founder={home.founder} player={player} onRemove={home.founder ? () => void tag(t, false) : undefined} />)
      ) : (
        home.videos[topic.key] ? null : <p className="cx-note">{home.founder ? "No sermons here yet. Add a YouTube link above, or file some below." : "Sermons are coming here soon."}</p>
      )}
      {home.founder ? (
        <div className="cx-file">
          <button type="button" className="cx-key" onClick={() => setFiling(!filing)}>
            {filing ? "Done filing" : `＋ File sermons under ${topic.word}`}
          </button>
          {filing ? (
            <div className="cx-file-list">
              {suggested.length ? <p className="cx-mini">Suggested from their titles</p> : null}
              {suggested.map((t) => (
                <button key={t.id} type="button" className="cx-pick is-suggest" onClick={() => void tag(t, true)}>
                  ＋ {t.title} <small>{t.minutes} min</small>
                </button>
              ))}
              <p className="cx-mini">{suggested.length ? "Other preaching" : "Preaching on the radio"}</p>
              {rest.length ? (
                rest.map((t) => (
                  <button key={t.id} type="button" className="cx-pick" onClick={() => void tag(t, true)}>
                    ＋ {t.title} <small>{t.minutes} min</small>
                  </button>
                ))
              ) : (
                <p className="cx-note">Upload sermons on the radio as "Preaching" and they show here.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** One YouTube sermon per card: it plays on the porch guy's screen. The founder pastes, replaces or removes it. */
function VideoSlot({ home, topic, reload }: { home: Home; topic: ClinicTopic; reload: () => Promise<void> }) {
  const video = home.videos[topic.key];
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Playing right here in the Clinic: the radio steps aside until the card closes.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    stopAgain();
    holdRadio("clinic-video");
    return () => releaseRadio("clinic-video");
  }, [playing]);
  useEffect(() => setPlaying(false), [video?.videoId]);
  async function save(next: string) {
    setBusy(true);
    setNote("");
    const result = await clinicSetVideo({ data: { topic: topic.key, link: next } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setLink("");
    setEditing(false);
    await reload();
  }
  return (
    <>
      {video ? (
        <div className="cx-video">
          {playing ? (
            <div className="cx-video-pic">
              <iframe
                src={`https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
                title={video.title || "Sermon"}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          ) : (
            <button type="button" className="cx-video-pic" onClick={() => setPlaying(true)} aria-label={`Play ${video.title || "the sermon"}`}>
              <img src={`/api/yt-thumb?id=${encodeURIComponent(video.videoId)}`} alt="" loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
              <span aria-hidden="true">▶</span>
            </button>
          )}
          {video.title ? <b>{video.title}</b> : null}
        </div>
      ) : null}
      {home.founder ? (
        editing || !video ? (
          <div className="cx-box">
            <p className="cx-sub">{video ? "Replace the YouTube sermon" : "YouTube sermon for this card"}</p>
            <input className="cx-input is-one" placeholder="Paste a YouTube link" value={link} onChange={(event) => setLink(event.target.value)} aria-label="YouTube link" />
            <div className="cx-founder-keys">
              <button type="button" className="cx-key is-green" disabled={busy || !link.trim()} onClick={() => void save(link.trim())}>
                {busy ? "Saving…" : "Save"}
              </button>
              {video ? (
                <button type="button" className="cx-key" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              ) : null}
            </div>
            {note ? <p className="cx-note">{note}</p> : null}
          </div>
        ) : (
          <div className="cx-founder-keys">
            <button type="button" className="cx-key" onClick={() => setEditing(true)}>
              ✎ Change link
            </button>
            <button type="button" className="cx-key is-warn" disabled={busy} onClick={() => void save("")}>
              Remove
            </button>
          </div>
        )
      ) : null}
    </>
  );
}

function AnswerBox({ answer, player, id }: { answer: Answer; player: ReturnType<typeof usePlayer>; id: string }) {
  const on = player.playing === id;
  return (
    <div className="cx-answer">
      <p className="cx-answer-by">✅ {answer.by}</p>
      {answer.text ? <p className="cx-answer-text">{answer.text}</p> : null}
      {answer.url ? (
        <button type="button" className="cx-key is-green" onClick={() => player.play(id, answer.url, answer.fromSec)}>
          {on ? "■ Stop" : "▶ Listen"}
        </button>
      ) : null}
    </div>
  );
}

function AskView({ home, back, reload, player }: { home: Home; back: () => void; reload: () => Promise<void>; player: ReturnType<typeof usePlayer> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function send() {
    if (busy) return;
    setBusy(true);
    setNote("");
    const result = await askClinic({ data: { body: text } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setText("");
    setNote("✅ Sent. A pastor will answer you here.");
    await reload();
  }
  const label: Record<string, string> = {
    waiting: "⏳ Waiting",
    vote: "🗳 In this month's vote",
    apostle: "🏆 Apostle Grace will answer this",
    answered: "✅ Answered",
  };
  return (
    <>
      <div className="cx-head">
        <Back onBack={back} />
      </div>
      <div className="cx-s cx-topic">💬 Ask a Pastor</div>
      <textarea className="cx-input" rows={4} maxLength={600} placeholder="Type your question…" value={text} onChange={(event) => setText(event.target.value)} aria-label="Your question" />
      <button type="button" className="cx-send" disabled={busy || text.trim().length < 2} onClick={() => void send()}>
        {busy ? "SENDING…" : "SEND"}
      </button>
      <p className="cx-mini">A pastor will answer you here.</p>
      {note ? <p className="cx-note">{note}</p> : null}
      {home.mine.length ? <p className="cx-sub">Your questions</p> : null}
      {home.mine.map((q) => (
        <div key={q.id} className="cx-row">
          <b className="cx-q">{q.body}</b>
          <span>{label[q.status] ?? ""}</span>
          {q.answer ? <AnswerBox answer={q.answer} player={player} id={`q${q.id}`} /> : null}
        </div>
      ))}
      {home.hall.length ? <p className="cx-sub">🏆 Questions of the Month</p> : null}
      {home.hall.map((h) => (
        <div key={h.month} className="cx-row is-gold">
          <span>{h.monthName} · {h.votes} {h.votes === 1 ? "vote" : "votes"}</span>
          <b className="cx-q">{h.wording}</b>
          {h.answer ? <AnswerBox answer={h.answer} player={player} id={`h${h.month}`} /> : <span>Apostle Grace will answer this soon.</span>}
        </div>
      ))}
    </>
  );
}

// ---- The founder's Questions desk.

type Target = { target: "question" | "group"; id: number; title: string; by: string };

function DeskView({ home, back, player }: { home: Home; back: () => void; reload: () => Promise<void>; player: ReturnType<typeof usePlayer> }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [note, setNote] = useState("");
  const [again, setAgain] = useState(false);
  const [pick, setPick] = useState<number[]>([]);
  const [answering, setAnswering] = useState<Target | null>(null);
  const [wordings, setWordings] = useState<Record<string, string>>({});

  async function load() {
    const result = await clinicDesk();
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setDesk(result);
  }
  useEffect(() => {
    void load();
  }, []);
  useBackLayer(Boolean(answering), () => setAnswering(null), "clinic:answer");

  if (!desk) return <p className="cx-note">{note || "Opening the desk…"}</p>;
  const byId = new Map(desk.questions.map((q) => [q.id, q]));
  const loose = desk.questions.filter((q) => !q.groupId && !q.answer);
  const openGroups = desk.groups.filter((g) => !g.answer);

  async function pdf(who: "pastors" | "apostle") {
    setNote("");
    const result = await clinicPdf({ data: { who, again } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    savePdf(result.pdf, result.filename);
    setNote(`📄 ${result.count} ${result.count === 1 ? "question" : "questions"} in the PDF. They're marked as sent.`);
    await load();
  }
  async function group(ids: number[], key: string) {
    const fallback = ids.map((id) => byId.get(id)?.body ?? "").sort((a, b) => a.length - b.length)[0] ?? "";
    const result = await clinicGroup({ data: { ids, wording: (wordings[key] ?? fallback).trim() } });
    if (!result.ok) setNote(result.error);
    await load();
  }
  async function into(id: number, groupId: number) {
    const result = await clinicGroup({ data: { ids: [id], groupId } });
    if (!result.ok) setNote(result.error);
    await load();
  }
  async function startVote() {
    const result = await clinicStartVote({ data: { groupIds: pick } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setPick([]);
    setNote("🗳 The vote is open. It closes at the end of the month.");
    await load();
  }

  if (answering) {
    return (
      <AnswerForm
        target={answering}
        tracks={home.tracks}
        back={() => setAnswering(null)}
        done={async (told) => {
          setAnswering(null);
          setNote(told ? `✅ Saved. ${told} ${told === 1 ? "person was" : "people were"} told.` : "✅ Saved.");
          await load();
        }}
      />
    );
  }

  return (
    <>
      <div className="cx-head">
        <Back onBack={back} />
      </div>
      <div className="cx-s cx-topic">📥 Questions desk</div>
      <p className="cx-mini">Only you see this.</p>
      {note ? <p className="cx-note">{note}</p> : null}

      <div className="cx-box">
        <p className="cx-sub">📄 PDFs to send</p>
        <div className="cx-founder-keys">
          <button type="button" className="cx-key" onClick={() => void pdf("pastors")}>
            Pastors' PDF
          </button>
          <button type="button" className="cx-key is-gold" onClick={() => void pdf("apostle")}>
            Apostle Grace PDF
          </button>
        </div>
        <label className="cx-tick">
          <input type="checkbox" checked={again} onChange={(event) => setAgain(event.target.checked)} /> Include ones already sent
        </label>
      </div>

      <div className="cx-box">
        <p className="cx-sub">🗳 Question of the Month</p>
        {desk.round ? (
          <>
            <p className="cx-mini">
              Voting for {desk.round.monthName} · {daysLeft(desk.round.closesAt)}
            </p>
            {desk.groups
              .filter((g) => g.inVote)
              .map((g) => (
                <p key={g.id} className="cx-line">
                  <b>{g.votes}</b> · {g.wording}
                </p>
              ))}
            <button type="button" className="cx-key" onClick={() => void clinicCloseVote().then(load)}>
              Close the vote now
            </button>
          </>
        ) : desk.thisMonthDone ? (
          <p className="cx-mini">This month's vote is done. The next one can start on the 1st.</p>
        ) : (
          <>
            <p className="cx-mini">Tick 2 or 3 of the most-asked, then put them to the vote. Best in the last week of the month.</p>
            {openGroups.filter((g) => !g.winnerMonth).length ? null : <p className="cx-note">Group questions that ask the same thing first (below).</p>}
            {openGroups
              .filter((g) => !g.winnerMonth)
              .map((g) => (
                <label key={g.id} className="cx-tick">
                  <input
                    type="checkbox"
                    checked={pick.includes(g.id)}
                    disabled={!pick.includes(g.id) && pick.length >= 3}
                    onChange={(event) => setPick(event.target.checked ? [...pick, g.id] : pick.filter((x) => x !== g.id))}
                  />
                  <span>
                    {g.wording} <small>· asked {g.asked}×</small>
                  </span>
                </label>
              ))}
            <button type="button" className="cx-key is-green" disabled={pick.length < 2} onClick={() => void startVote()}>
              Put to the vote ({pick.length})
            </button>
          </>
        )}
      </div>

      {desk.suggestions.length ? (
        <div className="cx-box">
          <p className="cx-sub">🔗 These look like the same question</p>
          {desk.suggestions.map((ids) => {
            const key = ids.join("-");
            const fallback = ids.map((id) => byId.get(id)?.body ?? "").sort((a, b) => a.length - b.length)[0] ?? "";
            return (
              <div key={key} className="cx-row">
                {ids.map((id) => (
                  <span key={id} className="cx-line">
                    Q-{id} · {byId.get(id)?.body}
                  </span>
                ))}
                <input
                  className="cx-input is-one"
                  aria-label="How members will read it"
                  value={wordings[key] ?? fallback}
                  onChange={(event) => setWordings({ ...wordings, [key]: event.target.value })}
                />
                <button type="button" className="cx-key is-green" onClick={() => void group(ids, key)}>
                  Group these {ids.length}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="cx-sub">Asked by many</p>
      {desk.groups.length ? null : <p className="cx-mini">None yet.</p>}
      {desk.groups.map((g) => (
        <div key={g.id} className={`cx-row${g.winnerMonth ? " is-gold" : ""}`}>
          <span>
            G-{g.id} · asked {g.asked}×{g.inVote ? ` · 🗳 in the vote (${g.votes})` : ""}
            {g.winnerMonth ? " · 🏆 Question of the Month" : ""}
            {g.sentAt && !g.answer ? " · 📄 sent" : ""}
          </span>
          <b className="cx-q">{g.wording}</b>
          {g.answer ? <AnswerBox answer={g.answer} player={player} id={`g${g.id}`} /> : null}
          <div className="cx-acts">
            <button
              type="button"
              className="is-g"
              onClick={() => setAnswering({ target: "group", id: g.id, title: g.wording, by: g.winnerMonth ? "Apostle Grace Lubega" : "A Phaneroo pastor" })}
            >
              {g.answer ? "✎ EDIT ANSWER" : "✚ ADD ANSWER"}
            </button>
            {!g.inVote && !g.winnerMonth && !g.answer ? (
              <button type="button" onClick={() => void clinicUngroup({ data: { groupId: g.id } }).then(load)}>
                UNGROUP
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <p className="cx-sub">Questions</p>
      {loose.length ? null : <p className="cx-mini">No questions waiting.</p>}
      {loose.map((q) => (
        <div key={q.id} className="cx-row">
          <span>
            Q-{q.id} · {shortDay(q.at)} · {q.who}
            {q.sentAt ? " · 📄 sent" : ""}
          </span>
          <b className="cx-q">{q.body}</b>
          <div className="cx-acts">
            <button type="button" className="is-g" onClick={() => setAnswering({ target: "question", id: q.id, title: q.body, by: "A Phaneroo pastor" })}>
              ✚ ADD ANSWER
            </button>
            <button type="button" onClick={() => void clinicHide({ data: { id: q.id } }).then(load)}>
              HIDE
            </button>
          </div>
          {openGroups.length ? (
            <select className="cx-select" value="" aria-label="Same as a question asked by many" onChange={(event) => void into(q.id, Number(event.target.value))}>
              <option value="">Same as…</option>
              {openGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  G-{g.id} · {g.wording.slice(0, 60)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ))}
      {desk.questions.filter((q) => q.answer).length ? <p className="cx-sub">Answered (last 30 days)</p> : null}
      {desk.questions
        .filter((q) => q.answer && !q.groupId)
        .map((q) => (
          <div key={q.id} className="cx-row">
            <span>Q-{q.id} · {q.who}</span>
            <b className="cx-q">{q.body}</b>
            <AnswerBox answer={q.answer!} player={player} id={`dq${q.id}`} />
          </div>
        ))}
    </>
  );
}

function AnswerForm({ target, tracks, back, done }: { target: Target; tracks: Track[]; back: () => void; done: (told: number) => Promise<void> }) {
  const [by, setBy] = useState(target.by);
  const [text, setText] = useState("");
  const [how, setHow] = useState<"text" | "voice" | "sermon">("text");
  const [trackId, setTrackId] = useState(0);
  const [fromMin, setFromMin] = useState("");
  const [voiceUrl, setVoiceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileBox = useRef<HTMLInputElement>(null);

  async function uploadVoice(file: File) {
    setBusy(true);
    setNote("Uploading the voice note…");
    try {
      const mode = (await fetch("/api/fm-upload").then((r) => r.json())) as { blob?: boolean };
      let url = "";
      if (mode.blob) {
        const { uploadFile } = await import("@/lib/porch/upload-file");
        const safe = file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-60) || "voice-note";
        url = await uploadFile(`fm/clinic-${safe}`, file, { handleUploadUrl: "/api/fm-upload", contentType: file.type || "audio/mpeg" });
      } else {
        const response = await fetch("/api/fm-upload", { method: "POST", headers: { "content-type": file.type || "audio/mpeg" }, body: file });
        const data = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !data.url) throw new Error(data.error || "Upload failed.");
        url = data.url;
      }
      setVoiceUrl(url);
      setNote("✅ Voice note ready.");
    } catch (error) {
      console.warn("Voice note upload failed", error);
      setNote("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const track = tracks.find((t) => t.id === trackId);
    const url = how === "voice" ? voiceUrl : how === "sermon" ? track?.url ?? "" : "";
    setBusy(true);
    const result = await clinicAnswer({
      data: { target: target.target, id: target.id, text, url, fromSec: how === "sermon" ? Math.round((Number(fromMin) || 0) * 60) : 0, by },
    });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    await done(result.told);
  }

  return (
    <>
      <div className="cx-head">
        <Back onBack={back} label="DESK" />
      </div>
      <div className="cx-s cx-topic">Add the answer</div>
      <div className="cx-verse is-q">{target.title}</div>
      <label className="cx-label">
        Answered by
        <input className="cx-input is-one" value={by} onChange={(event) => setBy(event.target.value)} maxLength={60} />
      </label>
      <div className="cx-tabs">
        {(["text", "voice", "sermon"] as const).map((key) => (
          <button key={key} type="button" className={how === key ? "is-on" : ""} onClick={() => setHow(key)}>
            {key === "text" ? "✎ Written" : key === "voice" ? "🎙 Voice note" : "📻 A sermon"}
          </button>
        ))}
      </div>
      {how === "voice" ? (
        <>
          <input ref={fileBox} type="file" accept="audio/*" className="cx-file-in" onChange={(event) => event.target.files?.[0] && void uploadVoice(event.target.files[0])} />
          {voiceUrl ? <p className="cx-mini">✅ Voice note attached.</p> : null}
        </>
      ) : null}
      {how === "sermon" ? (
        <>
          <select className="cx-select" value={trackId || ""} onChange={(event) => setTrackId(Number(event.target.value))} aria-label="Sermon">
            <option value="">Choose a sermon…</option>
            {tracks
              .filter((t) => t.kind === "preaching" || t.kind === "other")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.minutes} min)
                </option>
              ))}
          </select>
          <label className="cx-label">
            Start at minute
            <input className="cx-input is-one" inputMode="numeric" value={fromMin} onChange={(event) => setFromMin(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
          </label>
        </>
      ) : null}
      <textarea
        className="cx-input"
        rows={how === "text" ? 6 : 3}
        placeholder={how === "text" ? "The pastor's answer…" : "A short note with it (optional)"}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="The answer"
      />
      <button type="button" className="cx-send" disabled={busy} onClick={() => void save()}>
        {busy ? "SAVING…" : "SAVE AND TELL THEM"}
      </button>
      {note ? <p className="cx-note">{note}</p> : null}
    </>
  );
}
