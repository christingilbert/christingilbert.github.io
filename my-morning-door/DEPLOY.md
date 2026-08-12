# My Morning Door — web build

The same product as the Chrome extension, served as an ordinary web page.
Anyone can open the link and use it. Nothing to install, no store, no review.

**2.9 MB total. First load is about 210 KB** — the rest is sound and
backgrounds, fetched only when someone actually chooses them.

---

## Putting it online

Everything uses relative paths, so it works from any folder on any host.

**GitHub Pages** (simplest, since your site is already there)

1. Copy this folder into your `christingilbert.github.io` repo as
   `my-morning-door/`
2. Commit and push
3. It's live at `christingilbert.github.io/my-morning-door/`

**Netlify or Cloudflare Pages** — drag the folder onto the dashboard. Both
give you a custom domain free if you'd rather have `morningdoor.xyz`.

One requirement: **HTTPS**. The service worker and Add to Home Screen won't
work over plain HTTP. GitHub Pages, Netlify and Cloudflare all do this
automatically.

Opening `index.html` straight from your hard drive shows the page, but
browsers restrict local files: offline support won't register and the
personal photo upload may be blocked. To try it properly before deploying,
run a local server from this folder — `python3 -m http.server` — and open
`http://localhost:8000`.

---

## What's different from the extension

| | Extension | Web |
|---|---|---|
| Where it appears | Every new tab | A link you open |
| Sound across tabs | Yes, via offscreen document | Plays in this page only |
| Sound in background | Keeps playing | Pauses when the tab is hidden |
| Arrival gate | Four hours | Same |
| Preferences, photos | Stay on device | Same |
| Install needed | Yes | No |

The audio difference is real but barely matters on a phone, where there's
only one page in front of you anyway.

## What's the same

Every practice, every sound, every background, the preferences, the photo
upload, the arrival gate, the reduced-motion handling. `app.js`,
`backdrop.js`, `visual.js` and `ambient-engine.js` are your files, unchanged
apart from two things noted below.

---

## Files added for the web

- **`index.html`** — your `newtab.html`, plus icons, sharing metadata and a
  link to the manifest
- **`site.webmanifest`** — lets phones add it to a home screen
- **`sw.js`** — offline support. Caches the page and its code on first visit;
  caches sound and backgrounds only after they're used
- **`web-shell.js`** — registers the service worker, fixes the mobile address
  bar height problem, and sends a first-time visitor to the full arrival
- **`assets/icons/`** — home screen icons, generated from `door-store.svg`
- **`assets/share-card.jpg`** — 1200×630 image used when the link is posted

## Before you publish: two lines to edit

`index.html` contains three absolute URLs — `og:url`, `og:image`, and the
canonical link — currently pointing at:

```
https://christingilbert.github.io/my-morning-door/
```

Social crawlers don't run JavaScript and reject relative paths, so these can't
be worked out automatically. **If you deploy anywhere else, change them.** They
are the only location-dependent thing in the folder; everything else is
relative.

After deploying, paste the URL into any Open Graph preview tool to check the
card renders. Platforms cache aggressively, so it's worth getting right before
the link is shared widely.

---

## Changes to shared files

Two, both worth carrying back into the extension later:

1. **Sound files are now AAC (`.m4a`) instead of WAV.** 7.9 MB → 692 KB, with
   no audible difference. Your crossfade already hides the few milliseconds
   of padding that compressed audio adds at file edges. One line changed in
   `app.js` (the four filenames).

2. **`ambient-engine.js` recovers from interruptions.** Safari and iOS stop
   the audio context on a phone call or when the browser is backgrounded, and
   don't restart it. It now resumes automatically — unless you deliberately
   paused, which is still respected. Harmless in the extension, necessary here.

3. **`visual.js` line 23 was crashing.** It called
   `chrome.runtime.getURL(...)` with no guard. Inside the extension that's
   fine. Anywhere else, Chrome defines `window.chrome` but *not*
   `chrome.runtime`, so the call threw a TypeError at the very top of the
   file — and everything below it never ran. That's the canvas sizing, the
   draw loop and the resting logo, so all the animation silently disappeared.
   It now falls back to a plain relative URL, matching what `app.js` already
   did in `resolveAssetUrl`.

   **This bug is in your extension source too.** It doesn't affect the shipped
   extension, but it does break opening `newtab.html` directly to preview —
   which your own comment in `app.js` ("Direct HTML previews do not expose the
   extension runtime") shows you'd already accounted for elsewhere. Worth
   copying this fix back for v0.24.

4. **The header mark is now inlined in `styles.css`.** It was a CSS mask
   pointing at `assets/brand/resting-logo.svg`. An SVG used as a mask is
   subject to CORS, and a page opened straight from disk (`file://`) counts as
   an opaque origin — so the browser blocked the request and the mark
   disappeared while everything around it still rendered. It's now embedded
   directly in the stylesheet, which makes it independent of how the page is
   opened and removes a request.

   If the mark ever changes, regenerate the data URI from
   `assets/brand/resting-logo.svg`. The file is still in the folder for that
   reason, and is still used by the canvas.

5. **The large resting mark now follows the theme.** It was a white SVG drawn
   straight onto the canvas, so on the two light backgrounds — desert and
   snow — it washed out against the photograph. It's now recoloured to
   `--paper`, the same token the greeting and the button use: `#304043` on
   light backgrounds, unchanged cream on dark ones. A personal photo keeps the
   cream mark, since an unknown image's brightness can't be assumed.

   The recolour is cached and only rebuilt when the theme or the size changes,
   so the breathing animation costs the same as before.

   **This affects your extension too** — anyone using the desert or snow
   background sees the washed-out mark today. Worth carrying into v0.24.

Also: the privacy note says "this page" rather than "the extension", and the
sound-failure message no longer points at Chrome's Extensions page.

---

## Version

This build is **0.25.8**, brought in step with the Chrome extension of the same
version. What changed from the earlier 0.24 web build: the display-name greeting,
the "About" and feedback (Tally) sections in Preferences, the refined practice
copy and the "Leave this practice" control, the settings dialog as a real
submit/cancel form, `role="switch"` on the sound control, and the two darker
background photographs (misty forest, rocky shoreline) that replaced the earlier
bright desert and snow scenes — with the glass returning to a single dark
treatment to match them. The web adaptations are unchanged: AAC audio, the iOS
audio unlock and interruption recovery, the untimed local-play path, the service
worker, the viewport-height fix, and the first-visit-opens-arrival rule.

One fix carried in here that the extension still needs: `index.html` now includes
`<link rel="manifest" href="site.webmanifest">`, without which Android/Chrome
"Add to Home Screen" has no manifest to read.

The number lives in three places, all of which must match:

- `sw.js` — `VERSION`, which names the caches
- `web-shell.js` — `VERSION`, which logs it
- `index.html` — `<meta name="version">`

To check what's actually deployed: view source and look at the meta tag, or
open the console and read the line it logs on load.

## Updating it

Change files, raise the version in all three places, re-upload.

**Raising it is not optional.** The service worker caches audio by version.
Deploy without bumping and returning visitors keep the old sound files.

Code and styles are network-first as of 0.24.7, so those appear on the next
load without waiting for anything. Audio and backgrounds stay cache-first —
they are megabytes and rarely change — which is why the version still matters.

### If an update doesn't appear

Once, after upgrading from a build older than 0.24.7, the old service worker
is still in charge and still serving styles from its cache. Clear it:

- **iPhone** — Settings → Safari → Clear History and Website Data
- **Desktop** — devtools → Application → Service Workers → Unregister, then reload

After that, one reload is enough.

---

## Worth testing on a real phone

Simulators miss most of these.

- [ ] The speaker button in the header toggles sound and shows the right glyph
- [ ] Sound starts on first tap (iOS blocks audio without one)
- [ ] Sound survives locking and unlocking the screen
- [ ] Nothing sits under the notch or the home indicator
- [ ] Add to Home Screen shows the door icon, not a screenshot
- [ ] Airplane mode: the page still opens
- [ ] Rotate to landscape mid-practice
- [ ] At largest system text size, nothing overlaps
- [ ] VoiceOver reads the practice steps in order
- [ ] VoiceOver announces the speaker button as "Turn on Ocean" / "Turn off Ocean"
- [ ] Opening the link in a private window lands on the full arrival screen

---

## Not included, on purpose

No analytics, no error reporting, no cookies, no fonts or scripts from anyone
else's server. The privacy note in Preferences stays true as written, which
is the whole reason to keep it that way.
