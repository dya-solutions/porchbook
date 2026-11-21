// Stage 5c: sending a verification code by email through Brevo (free plan: 300 emails a day).
// The Brevo key lives ONLY in porch-local.json on this computer (never in the code or in git):
//   { "brevo": { "apiKey": "xkeysib-…", "senderEmail": "you@example.com", "senderName": "Porchbook" } }
// With no key, Porchbook is in "test mode": nothing is sent and the code is shown on screen
// instead (on this computer only, never in a deployed app).

type BrevoSetup = { apiKey: string; senderEmail: string; senderName: string };

async function readBrevo(): Promise<BrevoSetup | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile("porch-local.json", "utf8")) as { brevo?: Partial<BrevoSetup> };
    const brevo = raw.brevo;
    if (!brevo?.apiKey || !brevo.senderEmail) return null;
    return { apiKey: brevo.apiKey, senderEmail: brevo.senderEmail, senderName: brevo.senderName || "Porchbook" };
  } catch {
    return null;
  }
}

/** True when codes may be shown on screen: no Brevo key, and not a deployed app. */
export async function emailTestMode() {
  if (process.env.PORCH_TEST_MODE === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return !(await readBrevo());
}

/** Send a 6-digit verification code. Returns "sent", "test" (shown on screen) or an error. */
export async function sendCodeEmail(to: string, name: string, code: string): Promise<{ ok: true; how: "sent" | "test" } | { ok: false; error: string }> {
  if (process.env.PORCH_TEST_MODE === "1") return { ok: true, how: "test" };
  const brevo = await readBrevo();
  if (!brevo) {
    if (process.env.NODE_ENV === "production") return { ok: false, error: "Email isn't set up yet. Try again later." };
    return { ok: true, how: "test" };
  }
  const text = `Hello ${name || "there"},\n\nYour Porchbook code is ${code}\n\nIt works for 15 minutes. If you didn't ask for it, you can ignore this email.\n\nPorchbook`;
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: brevo.senderEmail, name: brevo.senderName },
        to: [{ email: to, name: name || to }],
        subject: `Your Porchbook code: ${code}`,
        textContent: text,
        htmlContent: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1f2416"><p>Hello ${escapeHtml(name || "there")},</p><p>Your Porchbook code is</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#576c31">${code}</p><p>It works for 15 minutes. If you didn't ask for it, you can ignore this email.</p><p>Porchbook</p></div>`,
      }),
    });
    if (!response.ok) return { ok: false, error: "The email didn't go. Try again in a minute." };
    return { ok: true, how: "sent" };
  } catch {
    return { ok: false, error: "The email didn't go. Check the connection and try again." };
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
