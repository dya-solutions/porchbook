export const INBOX_EVENT = "porch-inbox";

export function pingInbox() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INBOX_EVENT));
}
