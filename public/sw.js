const VERSION = "v2";
const PAGES = `courtside-pages-${VERSION}`;
const ASSETS = `courtside-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const SKIP_PREFIXES = ["/api/", "/auth/", "/r/", "/m/", "/login", "/setup", "/reset-password"];
const DROP_PARAMS = ["notice", "error", "send", "_rsc"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ASSETS)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("courtside-") && key !== PAGES && key !== ASSETS).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function pageKey(input) {
  const url = new URL(input, self.location.origin);
  DROP_PARAMS.forEach((name) => url.searchParams.delete(name));
  url.hash = "";
  return url.toString();
}

function skippable(url) {
  return url.origin !== self.location.origin || SKIP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function savePage(url, response) {
  if (!response || !response.ok || response.redirected || response.type !== "basic") return;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return;
  const cache = await caches.open(PAGES);
  await cache.put(pageKey(url), response);
}

async function clearPages() {
  await caches.delete(PAGES);
}

function isAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(?:png|svg|ico|woff2?)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    if (url.pathname === "/auth/signout") event.waitUntil(clearPages());
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isAsset(url)) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  const isRsc = request.headers.get("rsc") === "1" || url.searchParams.has("_rsc");
  const wantsHtml = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
  if (isRsc || !wantsHtml || skippable(url)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        event.waitUntil(savePage(url, response.clone()));
        return response;
      } catch (error) {
        const cache = await caches.open(PAGES);
        const saved = await cache.match(pageKey(url), { ignoreVary: true, ignoreSearch: false });
        if (saved) return saved;
        const offline = await caches.match(OFFLINE_URL);
        return offline || Response.error();
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "clear") {
    event.waitUntil(clearPages());
    return;
  }
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(
      Promise.all(
        data.urls.slice(0, 12).map(async (path) => {
          try {
            const url = new URL(path, self.location.origin);
            if (skippable(url)) return;
            const response = await fetch(url, { credentials: "include", headers: { accept: "text/html" } });
            await savePage(url, response);
          } catch (error) {
            return;
          }
        })
      )
    );
  }
});
