/* mimivo service worker */
const CACHE_VERSION = "ll-pwa-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  "/static/pwa/offline.html",
  "/static/pwa/icons/icon-192.png",
  "/static/pwa/icons/icon-512.png",
  "/static/pwa/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ll-pwa-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/static/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".ttf") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".webmanifest")
  );
}

function shouldBypass(url) {
  return (
    url.pathname.startsWith("/admin/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.startsWith("/__debug__/") ||
    url.searchParams.has("no-sw")
  );
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && request.method === "GET") {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offline = await caches.match("/static/pwa/offline.html");
      if (offline) return offline;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;
  if (request.mode === "navigate") {
    const offline = await caches.match("/static/pwa/offline.html");
    if (offline) return offline;
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url) || shouldBypass(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
