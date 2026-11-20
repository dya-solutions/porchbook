import { W, WHint, useWord } from "@/components/porch/words";
import { DoorFace } from "@/components/porch/tour-door";
import { useEffect, useState, type FormEvent } from "react";
import { Wrench } from "lucide-react";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { playButtonSound } from "@/lib/porch/button-sound-play";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { TourSlot, toggleTourMode, useTourMode } from "@/lib/porch/tour-mode";

import { downloadServe, loadServe, saveServe, SERVE_DEPARTMENTS, SERVE_SPAN, type ServeForm } from "@/lib/porch/serve";

const blank: ServeForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  gender: "",
  bornOn: "",
  city: "",
  discipleship: "",
  howLong: "",
  department: "",
  servesElsewhere: "",
  elsewhere: "",
  profession: "",
  skills: "",
  consent: "",
};

export function ServeButton() {
  const { user } = useCurrentUserState();
  const [down, setDown] = useState(false);
  const open = useTourMode() === "serve";
  const [founder, setFounder] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState<ServeForm>(blank);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    loadServe({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setSent(result.sent);
        setForm(result.form);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function set<K extends keyof ServeForm>(key: K, value: ServeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    const result = await saveServe({ data: { ...seed, form } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setSent(true);
    setNote("Sent. The induction date will be shared with you. It is at Global High School Grounds, Mbarara.");
  }

  async function download() {
    setBusy(true);
    setNote("");
    const result = await downloadServe({ data: seed });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    const binary = atob(result.pdf);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className={`tour-key no-sink pb-door${down || open ? " is-down" : ""}`}
        onPointerDown={() => {
          playButtonSound();
          setDown(true);
        }}
        onPointerUp={() => setDown(false)}
        onPointerLeave={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onClick={() => toggleTourMode("serve")}
      >
        <DoorFace icon="serve" name={<W k="tour.serve">Serve</W>} hint="Volunteer in a department" />
      </button>
      {open ? (
        <TourSlot>
        <form className="serve-light tour-sheet glass-edge w-full overflow-hidden rounded-2xl p-4" onSubmit={(event) => void submit(event)}>
          <h2 className="font-display text-xl text-ink"><W k="serve.title">Serve</W></h2>
          <p className="text-sm font-semibold text-ink"><W k="serve.subtitle">Phaneroo Ministries Mbarara</W></p>
          <p className="mt-1 text-sm text-muted">
            <W k="serve.intro">Welcome aboard to serve with us in Phaneroo Mbarara. Kindly fill in the form below.</W>
          </p>
          {sent ? <p className="mt-2 text-sm text-ink"><W k="serve.sent">You have already sent this. Submit again if you need to correct it.</W></p> : null}
          {founder ? (
            <button type="button" className={`${quietButtonClass} mt-3`} disabled={busy} onClick={() => void download()}>
              <W k="serve.volunteers">Volunteers</W>
            </button>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.first-name">First name</W>
              <input className={fieldClass} value={form.firstName} maxLength={40} onChange={(event) => set("firstName", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.last-name">Last name</W>
              <input className={fieldClass} value={form.lastName} maxLength={40} onChange={(event) => set("lastName", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.phone">Phone</W>
              <input className={fieldClass} value={form.phone} inputMode="tel" placeholder="+256" maxLength={20} onChange={(event) => set("phone", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.email">Email</W>
              <input className={fieldClass} value={form.email} inputMode="email" maxLength={120} onChange={(event) => set("email", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.gender">Gender</W>
              <select className={fieldClass} value={form.gender} onChange={(event) => set("gender", event.target.value)}>
                <option value="">Choose</option>
                <option>Female</option>
                <option>Male</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.date-of-birth">Date of birth</W>
              <input className={fieldClass} type="date" value={form.bornOn} onChange={(event) => set("bornOn", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
              <W k="serve.city">City</W>
              <input className={fieldClass} value={form.city} maxLength={80} onChange={(event) => set("city", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.have-you-attended-discipleship">Have you attended discipleship?</W>
              <select className={fieldClass} value={form.discipleship} onChange={(event) => set("discipleship", event.target.value)}>
                <option value="">Choose</option>
                <option>Yes</option>
                <option>Not yet</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.how-long-in-the-ministry">How long in the ministry?</W>
              <select className={fieldClass} value={form.howLong} onChange={(event) => set("howLong", event.target.value)}>
                <option value="">Choose</option>
                {SERVE_SPAN.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
              <W k="serve.i-would-like-to-serve-in">I would like to serve in</W>
              <select className={fieldClass} value={form.department} onChange={(event) => set("department", event.target.value)}>
                <option value="">Choose</option>
                {SERVE_DEPARTMENTS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.do-you-already-serve-in-a-department">Do you already serve in a department?</W>
              <select className={fieldClass} value={form.servesElsewhere} onChange={(event) => set("servesElsewhere", event.target.value)}>
                <option value="">Choose</option>
                <option>No</option>
                <option>Yes</option>
              </select>
            </label>
            {form.servesElsewhere === "Yes" ? (
              <label className="grid gap-1 text-sm font-semibold text-ink">
                <W k="serve.which-one">Which one?</W>
                <input className={fieldClass} value={form.elsewhere} maxLength={80} onChange={(event) => set("elsewhere", event.target.value)} />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.profession">Profession</W>
              <input className={fieldClass} value={form.profession} maxLength={80} onChange={(event) => set("profession", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
              <W k="serve.professional-skills">Professional skills</W>
              <input className={fieldClass} value={form.skills} maxLength={240} onChange={(event) => set("skills", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              <W k="serve.i-consent">I consent</W>
              <select className={fieldClass} value={form.consent} onChange={(event) => set("consent", event.target.value)}>
                <option value="">Choose</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {busy ? "Sending…" : <W k="serve.submit">Submit</W>}
            </button>
            {note ? <p className="text-sm text-muted">{note}</p> : null}
          </div>
        </form>
        </TourSlot>
      ) : null}
    </>
  );
}
