/* Web-only concerns. The extension build does not load this file, so app.js,
 * backdrop.js, visual.js and ambient-engine.js stay shared between both. */

(() => {
  // Keep in step with VERSION in sw.js. Logged so the deployed build can be
  // identified from a phone without guessing, via remote inspection or a
  // console-viewing browser.
  const VERSION = "0.25.18";
  console.info(`My Morning Door ${VERSION}`);

  // ---------------------------------------------------------------------
  // Offline support
  // ---------------------------------------------------------------------
  // Registered after load so it never competes with first paint. A failure
  // here is not worth surfacing: the page works perfectly well online.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------------------------------------------------------------------
  // Real viewport height on phones
  // ---------------------------------------------------------------------
  // Mobile Safari counts its collapsing address bar as part of 100vh, so a
  // full-height layout gets clipped at the bottom. Browsers with dynamic
  // viewport units handle this natively; older ones get a measured value.
  const supportsDynamicViewport =
    window.CSS?.supports?.("height", "100dvh") ?? false;

  if (!supportsDynamicViewport) {
    const setViewportUnit = () => {
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${window.innerHeight}px`
      );
    };
    setViewportUnit();
    window.addEventListener("resize", setViewportUnit);
    window.addEventListener("orientationchange", setViewportUnit);
  }

  // ---------------------------------------------------------------------
  // Opened straight from disk
  // ---------------------------------------------------------------------
  // Browsers treat a file:// page as having no origin, which blocks the fetch
  // the audio engine needs, along with the service worker. The page still
  // works; sound does not. Worth saying plainly, because the symptom on its
  // own is baffling.
  if (location.protocol === "file:") {
    console.warn(
      "My Morning Door: opened from the file system. Sound and offline support " +
      "need the page served over http. Run `python3 -m http.server` in this " +
      "folder and open http://localhost:8000 instead."
    );
  }

  // ---------------------------------------------------------------------
  // First visit on the open web opens the full arrival
  // ---------------------------------------------------------------------
  // The four-hour gate exists because a new tab opens dozens of times a day.
  // A shared link does not: someone following it once should see the whole
  // thing, not the near-empty resting threshold. Installed to a home screen it
  // behaves like the extension again, so the gate is left alone there.
  const installed =
    matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  if (!installed && !location.hash) {
    // app.js owns this key; it is read here only to tell a first visit from a
    // return, and written for the reason below.
    const LAST_TAB_KEY = "myMorningDoorLastTabAt";
    let seenBefore = true;
    try {
      seenBefore = Boolean(localStorage.getItem(LAST_TAB_KEY));
    } catch {
      // Storage unavailable - treat as a first visit.
      seenBefore = false;
    }
    if (!seenBefore) {
      // app.js returns early on an explicit #arrival and so never stamps the
      // visit. Without stamping it here, every later visit would still look
      // like the first one and the resting threshold would never appear.
      try {
        localStorage.setItem(LAST_TAB_KEY, String(Date.now()));
      } catch {
        // Nothing to do: the gate simply offers the arrival again next time.
      }
      // replaceState rather than assigning location.hash, so the back button
      // still leaves the page instead of stepping through a hash change.
      history.replaceState(null, "", "#arrival");
    }
  }
})();
