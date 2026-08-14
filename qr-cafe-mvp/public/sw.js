const CACHE_NAME = "rion-order-static-v2";
const STATIC_ASSETS = [
  "/offline.html",
  "/icons/apple-touch-icon-180.png",
  "/icons/rion-order-192.png",
  "/icons/rion-order-512.png",
  "/icons/rion-order-maskable-192.png",
  "/icons/rion-order-maskable-512.png",
];
let activationRequested = false;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => activationRequested ? self.clients.claim() : undefined),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SKIP_WAITING") return;
  activationRequested = true;
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  }
});
