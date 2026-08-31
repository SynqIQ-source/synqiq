// Minimal hand-written service worker -- no offline asset caching or
// precaching strategy (that's a separate, unrequested scope). Its only
// jobs are: be installable (a service worker is what makes the manifest's
// "Add to Home Screen" prompt eligible) and handle Web Push.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Payload shape gets finalized per trigger type in the next phase --
// this is a generic {title, body, url} handler good enough for any of them.
self.addEventListener("push", (event) => {
  console.log("[sw] push event received, hasData:", Boolean(event.data));

  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    console.log("[sw] push payload parsed:", payload);
  } catch (err) {
    console.log("[sw] push payload was not JSON, falling back to text:", err);
    payload = { title: "SynqIQ", body: event.data.text() };
  }

  const title = payload.title || "SynqIQ";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
