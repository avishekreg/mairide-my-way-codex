const CACHE_NAME = "mairide-shell-v7";
const SHELL_FILES = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isNavigationRequest = event.request.mode === "navigate";
  const pathname = requestUrl.pathname || "";

  // Never cache API responses or HTML shell documents (prevents stale login bundles).
  if (isSameOrigin && (pathname.startsWith("/api/") || isNavigationRequest || pathname === "/" || pathname.endsWith(".html"))) {
    if (isNavigationRequest) {
      event.respondWith(fetch(event.request, { cache: "no-store" }));
    }
    return;
  }

  if (!isSameOrigin) {
    return;
  }

  // Cache only hashed static assets.
  const isStaticAsset = /\.(js|css|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf)$/i.test(pathname);
  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone).catch(() => {});
        });
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || Response.error())
      )
  );
});
