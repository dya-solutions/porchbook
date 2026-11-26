// N6: the church's invite QR code (decision 31). It simply holds the invite link
// (porchbook.app/join/CODE), so any phone camera opens it: someone new creates an account and
// lands on the join form; someone signed in goes straight to it. The code is made here in the
// browser (the free "qrcode" library): no outside service.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

const INK = "#1f2a14";

/** The QR code as a picture (a data URL). */
function useQr(link: string, size: number) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!link) return;
    let cancel = false;
    QRCode.toDataURL(link, { width: size, margin: 2, errorCorrectionLevel: "M", color: { dark: INK, light: "#ffffff" } })
      .then((url) => !cancel && setSrc(url))
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [link, size]);
  return src;
}

/** A printable picture: the church's name, the QR code, and the code in words under it. */
async function printablePng(link: string, churchName: string, code: string) {
  const W = 1200;
  const H = 1600;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  const fit = (text: string, size: number, weight: string, y: number) => {
    let px = size;
    ctx.font = `${weight} ${px}px "Source Sans 3", "Segoe UI", sans-serif`;
    while (ctx.measureText(text).width > W - 120 && px > 28) {
      px -= 4;
      ctx.font = `${weight} ${px}px "Source Sans 3", "Segoe UI", sans-serif`;
    }
    ctx.fillText(text, W / 2, y);
  };
  fit(churchName, 76, "700", 150);
  fit("Scan to ask to join our porch on Porchbook", 44, "400", 230);
  const qr = await QRCode.toDataURL(link, { width: 1000, margin: 2, errorCorrectionLevel: "M", color: { dark: INK, light: "#ffffff" } });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("QR image"));
    img.src = qr;
  });
  ctx.drawImage(img, 100, 300, 1000, 1000);
  fit(`Invite code: ${code}`, 56, "700", 1400);
  fit(link.replace(/^https?:\/\//, ""), 36, "400", 1470);
  fit("Your church's admins let you in.", 32, "400", 1530);
  return canvas.toDataURL("image/png");
}

export function InviteQr({ link, churchName, code }: { link: string; churchName: string; code: string }) {
  const small = useQr(link, 480);
  const big = useQr(link, 1400);
  const [showing, setShowing] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!showing) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setShowing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing]);

  async function download() {
    setNote("");
    try {
      const url = await printablePng(link, churchName, code);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${churchName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "porch"}-invite-QR.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setNote("Saved as a picture. Print it, or share it.");
    } catch {
      setNote("Couldn't make the picture. Try again.");
    }
  }

  return (
    <div className="pb-card" style={{ marginTop: 16, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <p className="ofc-lbl" style={{ margin: 0, alignSelf: "flex-start" }}>QR code</p>
      {small ? <img src={small} alt={`QR code to join ${churchName}`} width={240} height={240} style={{ width: 240, height: 240 }} /> : <div style={{ width: 240, height: 240 }} />}
      <p className="pb-quiet" style={{ margin: 0, fontSize: 14, textAlign: "center", lineHeight: 1.45 }}>
        People scan it with their phone camera. New people make an account first; then they go straight to the join form.
      </p>
      <div className="ofc-admin" style={{ width: "100%" }}>
        <button type="button" className="pb-btn" onClick={() => setShowing(true)} disabled={!big}>
          Show it big
        </button>
        <button type="button" className="pb-btn2" onClick={() => void download()}>
          Download
        </button>
      </div>
      {note ? <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      {showing ? createPortal(
        <div className="qr-big" role="dialog" aria-modal="true" aria-label={`QR code to join ${churchName}`} onClick={() => setShowing(false)}>
          <p className="qr-big-name">{churchName}</p>
          <img src={big} alt={`QR code to join ${churchName}`} />
          <p className="qr-big-code">Scan to ask to join · Code {code}</p>
          <button type="button" className="qr-big-close" onClick={() => setShowing(false)}>
            Close
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
