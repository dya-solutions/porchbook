import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/porch/frame";
import { primaryButtonClass } from "@/components/porch/bits";

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

  useEffect(() => {
    setLink(window.location.origin);
  }, []);

  const message = link ? `${INVITE}\n\n${link}` : "";
  const text = encodeURIComponent(message);
  const page = encodeURIComponent(link);

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Invite</h1>
      <p className="mt-1 text-muted">Send Porchbook as a message.</p>
      <p className="mt-4 break-all rounded-lg glass-edge bg-card px-3 py-3 text-sm text-post">
        {link || "Preparing the link…"}
      </p>
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
