const CACHE = "porch-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("porch-shell-") && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/sw.js") return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

function isAsset(url) {
  return url.pathname.startsWith("/assets/") || /\.(?:js|css|woff2?|png|jpe?g|webp|gif|svg|ico|mp3|m4a|wav|webm)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const saved = await cache.match(request);
    if (saved) return saved;
    throw new Error("offline");
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const saved = (await cache.match(request)) || (await cache.match("/"));
    if (saved) return saved;
    return new Response("Porchbook is offline. Open it once while you have a signal.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  if (!cacheable(event.request)) return;
  const url = new URL(event.request.url);
  if (isAsset(url) || url.pathname.startsWith("/bible/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (event.request.mode === "navigate") event.respondWith(networkFirst(event.request));
});

const ICON = new URL("/icon-192.png", self.location.origin).href;
const BADGE = new URL("/badge-icon.png", self.location.origin).href;

self.addEventListener("push", (event) => {
  let payload = { title: "Porchbook", body: "New private message", url: "/messages", call: false, tag: "", renotify: false };
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === "string") payload.title = data.title.slice(0, 80);
    if (data && typeof data.body === "string") payload.body = data.body.slice(0, 140);
    if (data && typeof data.url === "string" && data.url.startsWith("/")) payload.url = data.url;
    if (data && data.call === true) payload.call = true;
    if (data && typeof data.tag === "string") payload.tag = data.tag.slice(0, 80);
    if (data && data.renotify === true) payload.renotify = true;
  } catch {
    // Keep the default alert.
  }
  const options = {
    body: payload.body,
    icon: ICON,
    badge: BADGE,
    data: { url: payload.url },
    tag: payload.tag || (payload.call ? "porch-call" : "porch"),
    renotify: payload.call || payload.renotify,
    requireInteraction: payload.call,
    vibrate: payload.call ? [200, 120, 200, 120, 200] : undefined,
  };
  if (payload.call) {
    options.actions = [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ];
  }
  // Porchbook is open on screen: no pop-up (the page shows it), so phones and Chrome don't see a stream of alerts.
  // Calls always show.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const watching = list.some((client) => client.visibilityState === "visible" && client.focused);
        if (watching && !payload.call) return undefined;
        return self.registration.showNotification(payload.title, options);
      })
      .catch(() => self.registration.showNotification(payload.title, options)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "decline" || event.action === "later") {
    const target = event.notification.data && event.notification.data.url ? String(event.notification.data.url) : "";
    const caller = target.match(/[?&]answer=([A-Za-z0-9]+)/);
    const tell = caller
      ? fetch("/api/line-decline?caller=" + encodeURIComponent(caller[1]), { method: "POST", credentials: "include" })
      : Promise.resolve();
    event.waitUntil(
      Promise.all([tell.catch(() => undefined), fetch("/api/ring?dismiss=1", { credentials: "include" }).catch(() => undefined)]),
    );
    return;
  }
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const windowClient of windows) {
      if ("navigate" in windowClient && "focus" in windowClient) {
        return windowClient.navigate(url).then(() => windowClient.focus());
      }
      if ("focus" in windowClient) return windowClient.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
