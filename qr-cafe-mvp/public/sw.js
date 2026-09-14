const CACHE_NAME = "rion-order-static-v3";
const CACHE_PREFIX = "rion-order-static-";
const STATIC_ASSETS = [
  "/offline.html",
  "/icons/apple-touch-icon-180.png",
  "/icons/rion-order-192.png",
  "/icons/rion-order-512.png",
  "/icons/rion-order-maskable-192.png",
  "/icons/rion-order-maskable-512.png",
  "/icons/rion-order-notification-badge-96.png",
];
let activationRequested = false;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => activationRequested ? self.clients.claim() : undefined),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SKIP_WAITING") return;
  activationRequested = true;
  self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === "string" && payload.title ? payload.title : "RION Order";
  const body = typeof payload.body === "string" && payload.body ? payload.body : "메뉴가 준비되었습니다.";
  const orderUrl = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icons/rion-order-192.png",
    badge: "/icons/rion-order-notification-badge-96.png",
    tag: typeof payload.tag === "string" && payload.tag ? payload.tag : `rion-order-${Date.now()}`,
    renotify: false,
    data: { url: orderUrl },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = typeof event.notification.data?.url === "string" ? event.notification.data.url : "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const expectedUrl = new URL(targetUrl, self.location.origin).href;
    const existing = windows.find((client) => client.url === expectedUrl);
    if (existing) return existing.focus();
    return clients.openWindow(targetUrl);
  }));
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
    event.respondWith(fetch(new Request(request, { cache: "no-store" })).catch(() => caches.match("/offline.html")));
  }
});
