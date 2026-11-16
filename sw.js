const BASE = self.registration.scope;
const PREFIX = `nupcial-shell-${new URL(BASE).pathname}-`;
const VERSION = "0.6.0";
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  "/",
  "/index.html",
  "/src/app.js",
  "/src/domain.js",
  "/src/storage.js",
  "/src/icons.js",
  "/src/map-model.js",
  "/src/garden-view.js",
  "/src/feedback.js",
  "/src/ink.js",

  "/src/styles.css",
  "/manifest.webmanifest",
  "/public/icon.svg",
  "/public/icon-192.png",
  "/public/icon-512.png",
].map((path) => new URL(path.slice(1), BASE).href);
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          ASSETS.map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
              .map((k) => caches.delete(k)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(BASE))
    return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(event.request))
      .then(
        (cached) =>
          cached ||
          fetch(event.request).catch(() =>
            event.request.mode === "navigate"
              ? caches
                  .open(CACHE)
                  .then((cache) =>
                    cache.match(new URL("index.html", BASE).href),
                  )
              : Response.error(),
          ),
      ),
  );
});

// Activate only after the visible app has saved its work, without disturbing other windows.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "NUPCIAL_APPLY_UPDATE") return;
  const reply = event.ports[0];
  event.waitUntil(
    (async () => {
      if (!reply || !event.source?.id || !event.source.url.startsWith(BASE))
        return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (
        windows.some(
          (client) =>
            client.url.startsWith(BASE) && client.id !== event.source.id,
        )
      ) {
        reply.postMessage({ ok: false, reason: "other-tabs" });
        return;
      }
      reply.postMessage({ ok: true });
      await self.skipWaiting();
    })().catch(() =>
      reply?.postMessage({ ok: false, reason: "activation-failed" }),
    ),
  );
});
