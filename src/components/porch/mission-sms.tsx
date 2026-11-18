import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { loadMissionSms, missionReportPdf, missionSmsPdf, prepareMissionSms, smsParts } from "@/lib/porch/mission-sms";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

export function MissionSms() {
  const seed = useSeed();
  const [ready, setReady] = useState(false);
  const [isHead, setIsHead] = useState(false);
  const [count, setCount] = useState(0);
  const [past, setPast] = useState<{ id: number; when: string; parts: number; count: number }[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{ id: number; count: number; parts: number; batches: string[][] } | null>(null);
  const [sentGroups, setSentGroups] = useState(0);
  const [open, setOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [report, setReport] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  const data = { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl };
  const parts = smsParts(body);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    loadMissionSms({ data })
      .then((result) => {
        if (cancel) return;
        setIsHead(result.isHead);
        setCount(result.count);
        setPast(result.sends);
        setReport(result.report);
        setReady(true);
      })
      .catch(() => {
        if (!cancel) setError("Couldn't open the message list.");
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, prepared?.id]);

  if (!ready || !isHead) return null;

  async function prepare() {
    setBusy(true);
    setError("");
    const result = await prepareMissionSms({ data: { ...data, body } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPrepared({ id: result.id, count: result.count, parts: result.parts, batches: result.batches });
    setSentGroups(0);
  }

  function sendGroup(index: number) {
    const group = prepared?.batches[index];
    if (!group?.length || !body.trim()) return;
    window.location.href = `sms:${group.join(",")}?body=${encodeURIComponent(body.trim())}`;
    setSentGroups((value) => Math.max(value, index + 1));
  }

  async function makeReport() {
    setReportBusy(true);
    setError("");
    const result = await missionReportPdf({ data: { ...data, body: report } });
    setReportBusy(false);
    if (!result.ok) {
      setError(result.error);
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

  async function download(sendId: number) {
    setError("");
    const result = await missionSmsPdf({ data: { ...data, sendId } });
    if (!result.ok) {
      setError(result.error);
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
    <section className="mt-5 rounded-2xl glass-edge bg-black p-4">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="font-display text-xl text-ink">Message the My 20s</span>
        <span className="text-sm text-muted">{open ? "Close" : "Open"}</span>
      </button>
      {open ? (
        <>
      <p className="mt-3 text-sm text-muted">
        {count} finished numbers. Repeated contacts are counted once. This uses your airtime, not Porchbook.
      </p>
      <textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setPrepared(null);
          setSentGroups(0);
        }}
        rows={4}
        maxLength={640}
        placeholder="Write the message"
        className={`${fieldClass} mt-3`}
      />
      <p className="mt-2 text-sm text-muted">
        {parts === 0 ? "Write a message to see the charge." : `${parts} SMS part${parts === 1 ? "" : "s"} for each number.`}
      </p>
      <button type="button" className={`${primaryButtonClass} mt-3`} disabled={busy || !body.trim() || count === 0} onClick={() => void prepare()}>
        {busy ? "Preparing…" : "Prepare send"}
      </button>
      {prepared ? (
        <div className="mt-4">
          <p className="text-sm text-ink">
            Prepared for {prepared.count} numbers. Your phone sends it. Delivery is not confirmed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primaryButtonClass} onClick={() => void download(prepared.id)}>
              missions-message.pdf
            </button>
            {prepared.batches.map((_, index) => (
              <button key={index} type="button" className={quietButtonClass} onClick={() => sendGroup(index)}>
                {prepared.batches.length === 1 ? "Send from my phone" : `Send group ${index + 1}`}
              </button>
            ))}
          </div>
          {sentGroups > 0 ? (
            <p className="mt-2 text-sm text-muted">
              Opened {sentGroups} of {prepared.batches.length} on your phone.
            </p>
          ) : null}
        </div>
      ) : null}
      {past.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {past.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-sm text-muted">
              <span>
                {item.when} · {item.count} numbers
              </span>
              <button type="button" className={quietButtonClass} onClick={() => void download(item.id)}>
                PDF
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </>
      ) : null}
    </section>
    <section className="mt-3 rounded-2xl glass-edge bg-black p-4">
      <button
        type="button"
        aria-expanded={reportsOpen}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setReportsOpen((value) => !value)}
      >
        <span className="font-display text-xl text-ink">REPORTS OF M&O</span>
        <span className="text-sm text-muted">{reportsOpen ? "Close" : "Open"}</span>
      </button>
      {reportsOpen ? (
        <>
          <p className="mt-3 text-sm text-muted">
            Paste the reports here. Put each heading on its own line, write under it, then leave a blank line before the next heading. The same heading is gathered together in the PDF.
          </p>
          <textarea
            value={report}
            onChange={(event) => setReport(event.target.value)}
            rows={8}
            maxLength={20000}
            placeholder={"Visits\nWe went to three cells.\n\nNeeds\nTransport for Thursday."}
            className={`${fieldClass} mt-3`}
          />
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={reportBusy} onClick={() => void makeReport()}>
            {reportBusy ? "Making…" : "Make the PDF"}
          </button>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </>
      ) : null}
    </section>
    </>
  );
}
