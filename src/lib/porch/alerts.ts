import { pushPublicKey, savePushSubscription } from "@/lib/porch/api";

const PUSH_FLAG = "porchbook-push";

export function keepAlertsCurrent(): void {
  if (!alertsSupported()) return;
  window.setTimeout(() => {
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, 2500);
}

export function alertsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && window.isSecureContext;
}

export function alertPermission(): NotificationPermission | "unsupported" {
  if (!alertsSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function enableAlerts(seed: {
  displayName: string;
  email: string | null;
  imageUrl: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!alertsSupported()) return { ok: false, error: "This browser can't show alerts." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Alerts stay off until you allow them." };
  const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  const ready = await navigator.serviceWorker.ready;
  const active = registration.active ? registration : ready;
  const { publicKey } = await pushPublicKey({ data: seed });
  const existing = await active.pushManager.getSubscription();
  const subscription =
    existing ??
    (await active.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  const json = subscription.toJSON();
  if (!subscription.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return { ok: false, error: "This browser didn't finish turning alerts on." };
  }
  const saved = await savePushSubscription({
    data: {
      ...seed,
      endpoint: subscription.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });
  if (!saved.ok) return saved;
  sessionStorage.setItem(PUSH_FLAG, "1");
  return { ok: true };
}

export function pushIsArmed(): boolean {
  return sessionStorage.getItem(PUSH_FLAG) === "1";
}
