/**
 * Harvest offline app shell.
 *
 * Keeps the workspace openable on a farm with no signal. It caches only the
 * static build output and the HTML of the routes a farmer reaches offline.
 * Product API answers (/v1/*) are never cached here: the react-query
 * persistence layer owns offline read data, and a stale cached API response
 * could otherwise be mistaken for current operational state.
 */

const CACHE = "harvest-shell-v1";
const SHELL_ROUTES = ["/", "/farmer", "/marketplace"];

function isShellDocument(url) {
  return SHELL_ROUTES.includes(url.pathname) || url.pathname.startsWith("/crops/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL_ROUTES.map((route) => cache.add(route).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("harvest-shell-") && name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/v1/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate" && isShellDocument(url)) {
    event.respondWith(networkFirst(request));
  }
});
