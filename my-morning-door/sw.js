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
 * VERSION is the single source of truth for this build. It names the caches,
 * so raising it on deploy both marks the release and retires the old files -
 * without it, anyone who has already visited keeps the previous audio and
 * code until their browser decides otherwise.
 *
 * Keep it in step with web-shell.js.
 */

const VERSION = "0.24.7";
const CACHE_VERSION = `v${VERSION}`;
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
  // Navigations go to the network first, cache second. The shell is a few
  // kilobytes, so fetching it fresh costs nothing worth measuring, and it
  // means a deploy is visible on the next load rather than the one after.
  // The earlier cache-first order made every update appear one reload late,
  // which is confusing enough on a live site and unusable while iterating.
  // Offline still works: the cached copy answers when the network cannot.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put("index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("index.html");
          return cached || Response.error();
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

  // Code and styles: network first, cache as the offline fallback.
  //
  // These are the files that change on every deploy and they total well under
  // 200 KB, so re-fetching them is cheap. Serving them cache-first — as this
  // did originally — meant a new stylesheet only appeared after the service
  // worker itself had been replaced, which depends on the host's own caching
  // and can lag by many minutes. The symptom is a page that looks unchanged
  // no matter how many times it is reloaded.
  //
  // Media is exempt: it is megabytes, rarely changes, and is handled above.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || Response.error();
      })
  );
});
