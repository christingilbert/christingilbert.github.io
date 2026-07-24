/* My Morning Door - service worker.
 *
 * Two caches, deliberately separated:
 *
 *   SHELL - the page itself, styles, scripts, font, icons. Small (~150KB),
 *           precached on install so the door opens instantly and offline.
 *
 *   MEDIA - backgrounds, ambient beds, voice clips. Several megabytes, so
 *           these are cached only after someone actually uses them. Nobody
 *           should pay for four ambient beds on a phone just for arriving.
 *
 * Bump CACHE_VERSION on every deploy. Old caches are removed on activate.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `mmd-shell-${CACHE_VERSION}`;
const MEDIA_CACHE = `mmd-media-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "backdrop.js",
  "ambient-engine.js",
  "visual.js",
  "app.js",
  "web-shell.js",
  "site.webmanifest",
  "assets/fonts/atkinson-hyperlegible-next-latin-variable.woff2",
  "assets/brand/door-simple.svg",
  "assets/brand/door-hero.svg",
  "assets/brand/resting-logo.svg",
  "assets/icons/icon192.png",
  "assets/icons/icon512.png",
];

const MEDIA_PATTERN = /\.(m4a|mp3|webp|jpg|jpeg|png)$/i;
const NEVER_CACHE = /share-card\./i;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll fails as a unit; add individually so one missing optional file
      // cannot stop the whole install.
      .then(cache => Promise.all(
        SHELL_ASSETS.map(asset => cache.add(asset).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("mmd-") && key !== SHELL_CACHE && key !== MEDIA_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch anything on another origin - the feedback form in particular
  // must always go to the network and must never be stored here.
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell immediately, refresh it in the
  // background. The page opens at once and picks up changes next visit.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        const cached = await cache.match("index.html");
        const network = fetch(request)
          .then(response => {
            if (response.ok) cache.put("index.html", response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Media: cache on first successful use, then serve from cache.
  if (NEVER_CACHE.test(url.pathname)) return;

  if (MEDIA_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          // Range requests answer 206 and must not be cached.
          if (response.ok && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Everything else: cache first, network as fallback.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
