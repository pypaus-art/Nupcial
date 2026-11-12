const BASE = self.registration.scope;
const PREFIX = `nupcial-shell-${new URL(BASE).pathname}-`;
const CACHE = `${PREFIX}v2026-11-12-2`;
const ASSETS = [
  "/",
  "/index.html",
  "/src/app.js",
  "/src/domain.js",
  "/src/storage.js",
  "/src/icons.js",
  "/src/styles.css",
  "/manifest.webmanifest",
  "/public/icon.svg",
  "/public/icon-192.png",
  "/public/icon-512.png",
].map(path => new URL(path.slice(1), BASE).href);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
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
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith(BASE)
  )
    return;
  event.respondWith(
    caches
      .match(event.request)
      .then(
        (cached) =>
          cached ||
          fetch(event.request).catch(() =>
            event.request.mode === "navigate"
              ? caches.match(new URL("index.html", BASE).href)
              : Response.error(),
          ),
      ),
  );
});
