import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/porch/frame";
import { primaryButtonClass } from "@/components/porch/bits";
import { myInvite, resetInvite } from "@/lib/porch/porch-join";
import { InviteQr } from "@/components/porch/invite-qr";

export const Route = createFileRoute("/invite")({
  component: InvitePage,
});

const INVITE = "Join me on Porchbook.";

function InvitePage() {
  return (
    <AppFrame>
      <InviteView />
    </AppFrame>
  );
}

function InviteView() {
  const [link, setLink] = useState("");
  // Stage 5a: each church porch has its own invite code and link. New people join with it.
  const [invite, setInvite] = useState<{ name: string; code: string; admin: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    myInvite()
      .then((result) => {
        if (!result.ok || !result.code) {
          setLink(window.location.origin);
          return;
        }
        setInvite({ name: result.name, code: result.code, admin: result.admin });
        setLink(`${window.location.origin}/join/${result.code}`);
      })
      .catch(() => setLink(window.location.origin));
  }, []);

  async function reset() {
    setConfirm(false);
    const result = await resetInvite().catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    setInvite((current) => (current ? { ...current, code: result.code } : current));
    setLink(`${window.location.origin}/join/${result.code}`);
    setNote("New code made. The old code and link no longer work.");
  }

  const message = link
    ? invite
      ? `Join ${invite.name} on Porchbook. Our invite code is ${invite.code}.\n\n${link}`
      : `${INVITE}\n\n${link}`
    : "";
  const text = encodeURIComponent(message);
  const page = encodeURIComponent(link);

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Invite</h1>
      <p className="mt-1 text-muted">{invite ? `New people join ${invite.name} with this code or link.` : "Send Porchbook as a message."}</p>
      {invite ? (
        <div className="pb-card" style={{ marginTop: 16, padding: 16 }}>
          <p className="ofc-lbl" style={{ margin: 0 }}>Invite code</p>
          <p className="start-code">{invite.code}</p>
          <p className="ofc-lbl" style={{ margin: "8px 0 4px" }}>Invite link</p>
          <p className="break-all" style={{ margin: 0, fontSize: 14 }}>{link}</p>
          {invite.admin ? (
            confirm ? (
              <p style={{ margin: "12px 0 0", fontSize: 14 }}>
                Make a new code? The old code and link stop working.{" "}
                <button type="button" className="welcome-link" onClick={() => void reset()}>Yes, new code</button>{" "}
                <button type="button" className="welcome-link" style={{ color: "var(--pb-quiet)" }} onClick={() => setConfirm(false)}>Cancel</button>
              </p>
            ) : (
              <button type="button" className="pb-link" style={{ paddingLeft: 0, color: "var(--pb-main)" }} onClick={() => setConfirm(true)}>
                Reset the code
              </button>
            )
          ) : null}
          {note ? <p className="pb-quiet" style={{ margin: "6px 0 0", fontSize: 14 }}>{note}</p> : null}
        </div>
      ) : (
        <p className="mt-4 break-all rounded-lg glass-edge bg-card px-3 py-3 text-sm text-post">
          {link || "Preparing the link…"}
        </p>
      )}
      {invite?.admin && link ? <InviteQr link={link} churchName={invite.name} code={invite.code} /> : null}
      <div className="mt-6 grid gap-2">
        <a
          className={`${primaryButtonClass} w-full ${link ? "" : "pointer-events-none opacity-50"}`}
          href={link ? `https://wa.me/?text=${text}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        <a
          className={`${primaryButtonClass} w-full ${link ? "" : "pointer-events-none opacity-50"}`}
          href={link ? `https://www.instagram.com/direct/new/?text=${text}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          Instagram
        </a>
        <a
          className={`${primaryButtonClass} w-full ${link ? "" : "pointer-events-none opacity-50"}`}
          href={link ? `https://www.facebook.com/sharer/sharer.php?u=${page}&quote=${text}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          Facebook
        </a>
        <a className={`${primaryButtonClass} w-full ${link ? "" : "pointer-events-none opacity-50"}`} href={link ? `sms:?body=${text}` : undefined}>
          SMS
        </a>
      </div>
    </div>
  );
}
