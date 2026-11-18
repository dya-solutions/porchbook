import { useEffect, useState } from "react";
import { getGuyMeter, setGuyCredit } from "@/lib/porch/porch-guy";

type Meter = Extract<Awaited<ReturnType<typeof getGuyMeter>>, { ok: true }>;

const usd = (n: number) => (Math.abs(n) < 0.01 && n !== 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Founder only: a small credit chip in the corner (never over the conversation). */
export function GuyMeter({ refreshKey }: { refreshKey: number }) {
  const [meter, setMeter] = useState<Meter | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const load = () =>
    getGuyMeter()
      .then((result) => setMeter(result.ok ? result : null))
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, [refreshKey]);
  if (!meter) return null;

  const level = !meter.hasCredit ? "unset" : meter.left < 0.25 ? "red" : meter.left < 1 ? "amber" : "ok";
  const most = Math.max(1, ...meter.week.map((d) => d.n));

  return (
    <div className="guy-meter">
      <button type="button" className={`guy-meter-chip is-${level}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {meter.hasCredit ? `≈ ${usd(Math.max(0, meter.left))} left` : "Set credit"}
      </button>
      {open ? (
        <div className="guy-meter-card">
          <p className="guy-meter-title">Porch guy's credit (only you see this)</p>
          <p>
            Today: <b>{meter.today.n}</b> chats · {usd(meter.today.cost)}
          </p>
          <p>
            This month: <b>{meter.month.n}</b> chats · {usd(meter.month.cost)}
          </p>
          <p>About {usd(meter.perChat)} per chat, tax included</p>
          {meter.week.length ? (
            <div className="guy-meter-week">
              {meter.week.map((d) => (
                <span key={d.day} title={`${d.n} chats`}>
                  <i style={{ height: `${(d.n / most) * 100}%` }} />
                  <small>{d.day}</small>
                </span>
              ))}
            </div>
          ) : null}
          <form
            className="guy-meter-set"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(amount);
              if (!(value >= 0)) return;
              void setGuyCredit({ data: { amount: value } }).then(() => {
                setAmount("");
                void load();
              });
            }}
          >
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="Credit now, e.g. 5" aria-label="Credit in US dollars" />
            <button type="submit" disabled={!amount}>
              Save
            </button>
          </form>
          <p className="guy-meter-note">An estimate: the Anthropic console shows the official balance.</p>
        </div>
      ) : null}
    </div>
  );
}
