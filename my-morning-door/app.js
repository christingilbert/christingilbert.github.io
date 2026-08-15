const PREFS_KEY = "myMorningDoorPreferencesV3";
// One rolling timestamp, only to tell "first tab in a while" from "another tab".
// Deliberately NOT a history: nothing accumulates, nothing is dated, nothing is shown back.
const LAST_TAB_KEY = "myMorningDoorLastTabAt";
const VOICE_DEFAULTS_KEY = "myMorningDoorVoiceDefaultsV2";
const ARRIVAL_GAP_MS = 4 * 60 * 60 * 1000; // offer the full arrival once per stretch of the day, not per tab

const defaultPreferences = {
  motion: "full",
  motionSet: false, // true once the user has explicitly chosen a motion mode
  displayName: "",
  voice: false,
  voiceVolume: 0.5,
  ambient: "ocean",
  ambientVolume: 0.28,
  breathPattern: "even",
  tabMode: "long-breaks",
};

const ambientTracks = {
  ocean: { label: "Ocean", src: "assets/audio/ambient/ocean.m4a" },
  rain: { label: "Soft rain", src: "assets/audio/ambient/rain.m4a" },
  forest: { label: "Forest", src: "assets/audio/ambient/forest.m4a" },
  brown: { label: "Brown noise", src: "assets/audio/ambient/brown-noise.m4a" },
};

const voiceClips = {
  welcome: "welcome.mp3",
  complete: "complete.mp3",
  breathIntro: "breathing-intro.mp3",
  breathComplete: "breathing-complete.mp3",
  "breath-in": "breathing-in.mp3",
  "breath-hold-one": "breathing-pause.mp3",
  "breath-out": "breathing-out.mp3",
  "breath-hold-two": "breathing-rest.mp3",
  groundIntro: "grounding-intro.mp3",
  groundComplete: "grounding-complete.mp3",
  "ground-1": "grounding-see.mp3",
  "ground-2": "grounding-support.mp3",
  "ground-3": "grounding-hear.mp3",
  releaseIntro: "relaxation-intro.mp3",
  releaseComplete: "relaxation-complete.mp3",
  "release-support": "relaxation-chair.mp3",
  "release-feet": "relaxation-feet.mp3",
  "release-shoulders": "relaxation-shoulders.mp3",
  "release-hands": "relaxation-hands.mp3",
  "release-gaze": "relaxation-gaze.mp3",
};

const groundingSteps = [
  {
    count: "3",
    title: "things you can see",
    guidance: "Let your eyes rest on three things around you. They can be ordinary.",
  },
  {
    count: "2",
    title: "points of support",
    guidance: "Notice two places where the chair, desk, or floor supports you.",
  },
  {
    count: "1",
    title: "sound you can hear",
    guidance: "Notice one sound nearby or farther away.",
  },
];

const releaseSteps = [
  {
    title: "Feel the chair supporting you.",
    guidance: "Let some of your weight be held by the chair.",
    scene: "release-support",
  },
  {
    title: "Press your feet gently into the floor.",
    guidance: "Use only as much pressure as feels comfortable, then release.",
    scene: "release-feet",
  },
  {
    title: "Lift your shoulders slightly.",
    guidance: "Let them settle without forcing them down.",
    scene: "release-shoulders",
  },
  {
    title: "Soften your hands and jaw.",
    guidance: "Nothing needs to be held tightly right now.",
    scene: "release-hands",
  },
  {
    title: "Look beyond the screen.",
    guidance: "Let your gaze rest somewhere farther away for a moment.",
    scene: "release-gaze",
  },
];

const breathPatterns = {
  even: [
    { key: "in", title: "Breathe in", note: "Let the circle widen with you.", short: "Breathe in", ms: 4000 },
    { key: "out", title: "Breathe out slowly", note: "Let it be a little longer than the breath in.", short: "Breathe out", ms: 6000 },
  ],
  box: [
    { key: "in", title: "Breathe in slowly", note: "Let the circle widen at an easy pace.", short: "Breathe in", ms: 5000 },
    { key: "hold-one", title: "Pause softly", note: "Only if it feels comfortable.", short: "Pause", ms: 5000 },
    { key: "out", title: "Breathe out slowly", note: "Let the circle soften inward.", short: "Breathe out", ms: 5000 },
    { key: "hold-two", title: "Rest here", note: "Or keep breathing in your own way.", short: "Rest", ms: 5000 },
  ],
};

function getBreathPhases() {
  return breathPatterns[preferences.breathPattern] || breathPatterns.even;
}

function breathLabel() {
  return preferences.breathPattern === "box" ? "Box Breathing" : "Longer Exhale";
}

let preferences = loadPreferences();
applyVoiceDefaultsMigration();
let view = "arrival";
let activity = null;
let activityStep = 0;
let practicePace = null;
let activityTimer = 0;
let breathPhase = 0;
let breathRunning = false;
let breathPatternConfirmed = false;
let breathTimer = 0;
let breathTransitionToken = 0;
let currentGuidance = "";
let currentVoiceClip = voiceClips.welcome;
let completionVoiceClip = voiceClips.complete;
let soundLoading = false;
// Cached view of the shared sound session. The real engine lives in the
// extension's offscreen document (see ambient-engine.js / offscreen.js), so
// sound continues while the user browses and every tab reads the same state.
let ambientState = { active: false };
let bridgeMinutes = 30; // completion-screen duration choice; null = until stopped
let bridgeDurationExpanded = false;
let bridgeDurationChanged = false;
// Bumped by every completion-screen sound choice, so a start that resolves
// after a newer choice knows it has been superseded.
let bridgeChoiceToken = 0;
let renderTransitionToken = 0;

const voicePlayer = new Audio();
voicePlayer.preload = "auto";

const app = document.querySelector("#app");
const status = document.querySelector("#status");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsForm = document.querySelector("#settingsForm");
const soundToggle = document.querySelector("#soundToggle");

function loadPreferences() {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch {
    return { ...defaultPreferences };
  }
}

// The full pause menu is offered on the first tab
// after a long gap (a morning, a return from lunch). Every other tab opens as
// a quiet resting threshold that leaves the address bar alone.
function decideEntryView() {
  if (location.hash === "#arrival") return "arrival";
  if (location.hash === "#resting") return "resting";
  if (preferences.tabMode === "full") return "arrival";
  if (preferences.tabMode === "minimal") {
    try {
      localStorage.setItem(LAST_TAB_KEY, String(Date.now()));
    } catch {
      // Storage unavailable: the quiet resting threshold still works.
    }
    return "resting";
  }
  let lastTabAt = 0;
  try {
    lastTabAt = Number(localStorage.getItem(LAST_TAB_KEY)) || 0;
    localStorage.setItem(LAST_TAB_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: fall back to always offering the arrival.
  }
  // A stamp from the future (clock corrected backwards) is invalid - treat it
  // as no stamp so the first real tab of the stretch still gets the arrival.
  if (lastTabAt > Date.now()) lastTabAt = 0;
  return Date.now() - lastTabAt > ARRIVAL_GAP_MS ? "arrival" : "resting";
}

function savePreferences() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

// Earlier beta builds could leave voice guidance enabled at a much louder
// saved level. Apply the quieter, opt-in model once, then respect every choice
// the user makes from this version onward.
function applyVoiceDefaultsMigration() {
  try {
    if (localStorage.getItem(VOICE_DEFAULTS_KEY) === "1") return;
    preferences.voice = false;
    preferences.voiceVolume = defaultPreferences.voiceVolume;
    savePreferences();
    localStorage.setItem(VOICE_DEFAULTS_KEY, "1");
  } catch {
    preferences.voice = false;
    preferences.voiceVolume = defaultPreferences.voiceVolume;
  }
}

function clampVolume(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function cleanDisplayName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character]));
}

preferences.voiceVolume = clampVolume(preferences.voiceVolume, defaultPreferences.voiceVolume);
preferences.ambientVolume = clampVolume(preferences.ambientVolume, defaultPreferences.ambientVolume);
preferences.voice = preferences.voice === true;
preferences.displayName = cleanDisplayName(preferences.displayName);
if (!ambientTracks[preferences.ambient]) preferences.ambient = defaultPreferences.ambient;
if (!breathPatterns[preferences.breathPattern]) preferences.breathPattern = defaultPreferences.breathPattern;
if (!["long-breaks", "minimal", "full"].includes(preferences.tabMode)) preferences.tabMode = defaultPreferences.tabMode;
preferences.motionSet = preferences.motionSet === true;

// The system's reduced-motion setting is the DEFAULT, not a lock: once the
// user explicitly chooses a motion mode in Preferences, that choice wins.
function motionIsStill() {
  if (preferences.motion === "still") return true;
  if (preferences.motionSet) return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function updateSoundButton() {
  const stateText = soundToggle.querySelector(".sound-state");
  // The loading state is a quiet ellipsis rather than ": Starting…" so the
  // pill never grows and snaps back - its width is pinned in styles.css and
  // all three states fit inside it. The aria-label below still says
  // "starting" in full for screen readers.
  stateText.textContent = soundLoading ? ": …" : ambientState.active ? ": On" : ": Off";
  soundToggle.setAttribute("aria-checked", String(!!ambientState.active));
  soundToggle.setAttribute("aria-busy", String(soundLoading));
  if (soundLoading) soundToggle.setAttribute("aria-label", "Ambient sound, starting");
  else soundToggle.removeAttribute("aria-label");
}

function revealWebInstallLink() {
  const installLink = document.querySelector("#installPageLink");
  if (!installLink) return;
  if (location.protocol !== "chrome-extension:") installLink.hidden = false;
}

/* --- Sound session client -------------------------------------------
   All ambient playback happens in ONE place. Installed as an extension,
   that place is the offscreen document (via the service worker), so the
   sound survives navigation and is shared by every tab. In a direct HTML
   preview (no extension runtime) the same engine runs in this page. */

let previewEngine = null;
let ambientLocalMode = false; // shared playback failed → this page plays instead

// Prime the audio context synchronously inside a user gesture, before any of
// the awaits in the play path. Only matters on this web build — inside the
// extension audio lives in the offscreen document and this page never creates
// a context. iOS Safari only lets a context start when the call happens while
// the tap is still live; reaching resume() several awaits later leaves it
// suspended (button reads "on", nothing heard). Safe to call on every tap.
function primeAudioOnGesture() {
  if (globalThis.chrome?.runtime?.id) return; // extension: offscreen owns audio
  try {
    if (!previewEngine) previewEngine = createAmbientEngine(resolveAssetUrl);
    previewEngine.unlock();
  } catch {
    // No Web Audio here; the normal path will surface the failure.
  }
}

async function localAmbient(cmd, extra = {}) {
  try {
    if (!previewEngine) previewEngine = createAmbientEngine(resolveAssetUrl);
  } catch {
    return { active: false, error: "no-web-audio" };
  }

  const run = () => {
    switch (cmd) {
      case "play":
      case "select-sound":
        return previewEngine.play({
          key: extra.sound, label: extra.label, src: extra.src,
          volume: extra.volume, minutes: extra.minutes ?? null,
        });
      case "pause": return previewEngine.pause();
      case "resume": return previewEngine.resume();
      case "stop": return previewEngine.stop();
      case "set-volume": return previewEngine.setVolume(extra.volume);
      case "set-duration": return previewEngine.setDuration(extra.minutes ?? null);
      case "duck": return previewEngine.duck();
      case "unduck": return previewEngine.unduck();
      default: return previewEngine.getState();
    }
  };

  // No timeout here, unlike the extension's cross-process path. play() is a
  // direct call that returns when the audio is genuinely ready; decoding a bed
  // on a slow phone with a cold cache can take a couple of seconds, and racing
  // it against a deadline would report a slow-but-working start as a failure —
  // flipping the button back to "off" while sound was on its way, the exact
  // "stuck off" symptom. play() has its own guards (an 800ms cap on a
  // suspended context, an honest audio-blocked result) and the engine's fetch
  // has a 15s abort, so a real failure still comes back cleanly.
  try {
    return await Promise.resolve().then(run);
  } catch {
    return { active: false, error: "playback-failed" };
  }
}

async function ambientSend(cmd, extra = {}) {
  if (globalThis.chrome?.runtime?.id && !ambientLocalMode) {
    let state;
    try {
      // Never let a wedged worker or offscreen document hang the UI: every
      // command gets an answer within five seconds, whatever happens.
      const reply = await Promise.race([
        chrome.runtime.sendMessage({ target: "morningdoor-ambient", cmd, ...extra }),
        new Promise(resolve => setTimeout(() => resolve({ active: false, error: "no-reply" }), 5000)),
      ]);
      state = reply || { active: false };
    } catch {
      state = { active: false, error: "no-service-worker" };
    }
    // If shared playback could not start, fall back to playing in this page -
    // the user's click happened here, so audio is allowed. The trade-off
    // (sound pauses with the tab) is announced by the caller via state.local.
    if ((cmd === "play" || cmd === "select-sound") && !state.active) {
      const local = await localAmbient(cmd, extra);
      if (local?.active) {
        ambientLocalMode = true;
        return { ...local, local: true };
      }
    }
    return state;
  }
  return localAmbient(cmd, extra);
}

function stopVoice(restoreAmbient = true) {
  voicePlayer.pause();
  voicePlayer.removeAttribute("src");
  voicePlayer.load();
  window.speechSynthesis?.cancel();
  if (restoreAmbient && ambientState.active) ambientSend("unduck");
}

function fallbackSpeak(text = currentGuidance) {
  if (!("speechSynthesis" in window) || !text) {
    announce("Voice guidance is not available in this browser.");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.86;
  utterance.pitch = 0.96;
  utterance.volume = preferences.voiceVolume;
  if (ambientState.active) ambientSend("duck");
  const restoreAmbient = () => {
    if (ambientState.active) ambientSend("unduck");
  };
  utterance.addEventListener("end", restoreAmbient, { once: true });
  utterance.addEventListener("error", restoreAmbient, { once: true });
  window.speechSynthesis.speak(utterance);
}

function playVoice(clip = currentVoiceClip) {
  if (!preferences.voice || !clip) return;
  stopVoice(false);
  voicePlayer.src = `assets/audio/voice/${clip}`;
  voicePlayer.volume = preferences.voiceVolume;
  // Voice lowers the ambient bed rather than stopping it; it is restored
  // gradually when the clip ends. The loop itself never restarts.
  if (ambientState.active) ambientSend("duck");
  voicePlayer.play().catch(() => {
    if (ambientState.active) ambientSend("unduck");
    fallbackSpeak();
  });
}

voicePlayer.addEventListener("ended", () => {
  if (ambientState.active) ambientSend("unduck");
});

function resolveAssetUrl(path) {
  try {
    if (globalThis.chrome?.runtime?.getURL) return chrome.runtime.getURL(path);
  } catch {
    // Direct HTML previews do not expose the extension runtime.
  }
  return new URL(path, document.baseURI).href;
}

function announce(message) {
  status.textContent = "";
  requestAnimationFrame(() => { status.textContent = message; });
}

function visualAnchor() {
  return `<div class="visual-region" aria-hidden="true"><div class="threshold"></div></div>`;
}

function techniqueIcon(type) {
  const icons = {
    breath: `<svg class="technique-icon icon-breath" viewBox="0 0 48 48" aria-hidden="true">
      <path class="icon-stroke wind-line wind-one" d="M5 15h24c4.6 0 4.7-7 0-7-2.8 0-4.5 1.7-4.5 4"/>
      <path class="icon-stroke wind-line wind-two" d="M5 24h34c4.8 0 4.8 7.5 0 7.5-2.8 0-4.6-1.8-4.6-4.1"/>
      <path class="icon-stroke wind-line wind-three" d="M5 33h19.5c4.2 0 4.2 6.5 0 6.5-2.4 0-3.9-1.5-3.9-3.5"/>
    </svg>`,
    ground: `<svg class="technique-icon icon-ground" viewBox="0 0 48 48" aria-hidden="true">
      <circle class="icon-fill sun-core" cx="24" cy="24" r="8"/>
      <path class="icon-stroke sun-rays" d="M24 5v5M24 38v5M5 24h5M38 24h5M10.6 10.6l3.6 3.6M33.8 33.8l3.6 3.6M37.4 10.6l-3.6 3.6M14.2 33.8l-3.6 3.6"/>
    </svg>`,
    release: `<svg class="technique-icon icon-release" viewBox="0 0 48 48" aria-hidden="true">
      <circle class="icon-fill seated-head" cx="20" cy="8" r="5.5"/>
      <path class="icon-stroke seated-chair" d="M9 19.5l2.4 15.3C12.3 40.2 16 43 21.5 43H29"/>
      <path class="icon-stroke seated-body" d="M20 17.5l2.4 12.6c.7 3.7 2.9 5.4 6.5 5.4H38V44"/>
    </svg>`,
  };
  return icons[type] || "";
}

function guidanceButton() {
  const enabled = preferences.voice;
  const percent = Math.round(preferences.voiceVolume * 100);
  return `<div class="guidance-controls">
    <button
      type="button"
      class="guidance-button"
      data-action="toggle-guidance"
      role="switch"
      aria-checked="${enabled}"
    ><span>Voice guidance</span><span aria-hidden="true">: ${enabled ? "On" : "Off"}</span></button>
    ${enabled ? `<div class="practice-guidance-volume">
      <label for="practiceGuidanceVolume">Volume</label>
      <input
        id="practiceGuidanceVolume"
        class="practice-guidance-volume-input"
        type="range"
        min="0"
        max="100"
        step="1"
        value="${percent}"
        aria-label="Voice guidance volume"
      >
      <output for="practiceGuidanceVolume">${percent}%</output>
    </div>` : ""}
  </div>`;
}

function practiceActions(primaryLabel, primaryAction) {
  return `<div class="actions">
    <button type="button" class="primary-button" data-action="${primaryAction}">${primaryLabel}</button>
    <button type="button" class="practice-exit" data-action="choose-another">Leave this practice</button>
  </div>`;
}

function leavePracticeButton() {
  return `<button type="button" class="practice-exit" data-action="choose-another">Leave this practice</button>`;
}

function stepMarker(current, total) {
  return `<p class="step-marker"><span>${current}</span> of ${total}</p>`;
}

function sceneName() {
  if (view === "resting") return "resting";
  if (view === "arrival") return "arrive";
  if (view === "complete") return "complete";
  if (activity === "breath") {
    return breathRunning ? `breath-${getBreathPhases()[breathPhase].key}` : "breath-ready";
  }
  if (activity === "ground") return practicePace ? `ground-${activityStep + 1}` : "ground-ready";
  if (activity === "release") return practicePace ? releaseSteps[activityStep].scene : "release-ready";
  return "arrive";
}

function dispatchScene(scene = sceneName(), options = {}) {
  document.body.dataset.scene = scene;
  let duration = 4000;
  if (scene.startsWith("breath-")) {
    const phase = getBreathPhases()[breathPhase];
    if (phase) duration = phase.ms;
  }
  window.dispatchEvent(new CustomEvent("morningdoor:scene", {
    detail: {
      scene,
      duration,
      crossfade: options.crossfade !== false,
    },
  }));
}

/* --- Screen transitions ---------------------------------------------
   Two kinds, chosen by what stays on screen:

   "morph"  - both screens share the two-column layout with the glass
              panel. The frame itself never fades: the old text dissolves
              inside it, the new text settles in, and the frame's height
              eases between the two. This is every click inside the flow
              (arrival -> practice -> steps -> complete).

   "home" / "home-open" - the resting threshold is on one side, so the
              layouts genuinely differ and the whole screen crossfades.

   The morph is captured BEFORE the DOM is replaced and applied straight
   after, in the same frame, so nothing flashes in between. */

function screenTransitionType(previousScene, nextScene) {
  if (motionIsStill() || !previousScene) return "none";
  if (previousScene === "resting" && nextScene === "arrive") return "home-open";
  if (previousScene === "resting" || nextScene === "resting") return "home";
  return "morph";
}

// A clone must never be findable as the "real" screen: ids collide, and the
// focus step must not land on an inert copy of the title.
function scrubClone(node) {
  node.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
  node.querySelectorAll("[data-screen-title]").forEach(element => element.removeAttribute("data-screen-title"));
}

// A click lands on a control that is, by definition, under the cursor - and
// therefore hovered. The clone is not, so at the moment of the swap the
// button under the pointer flicks from its hover paint back to base: a tiny
// blip, exactly where the person is looking. Carry the hovered (or
// keyboard-focused) control's computed paint onto its twin in the clone.
function carryPointerPaint(source, clone) {
  const live = [...source.querySelectorAll(
    "button:hover, a:hover, [data-action]:hover, button:focus-visible, a:focus-visible",
  )].pop();
  if (!live) return;
  const twin = [...clone.querySelectorAll("*")][[...source.querySelectorAll("*")].indexOf(live)];
  if (!twin) return;
  const paint = getComputedStyle(live);
  twin.style.backgroundColor = paint.backgroundColor;
  twin.style.color = paint.color;
  twin.style.transform = paint.transform;
  twin.style.boxShadow = paint.boxShadow;
  if (live.matches(":focus-visible")) {
    twin.style.outline = paint.outline;
    twin.style.outlineOffset = paint.outlineOffset;
  }
}

// If a whole-screen crossfade is still running when the next render arrives,
// the half-faded overlay would be destroyed with the DOM and pop away in one
// frame. Capture it (and how faded it currently is) so the new transition can
// carry it the rest of the way out.
function captureFadingOverlay() {
  const fading = app.querySelector(".screen-crossfade-out");
  if (!fading) return null;
  return { node: fading, opacity: Number(getComputedStyle(fading).opacity) || 0 };
}

function continueFadingOverlay(carry, before) {
  if (!carry || carry.opacity <= 0.02) return;
  carry.node.style.zIndex = "0";
  app.insertBefore(carry.node, before);
  carry.node.animate(
    [{ opacity: carry.opacity }, { opacity: 0 }],
    { duration: 420, easing: "ease-out", fill: "forwards" },
  ).finished.catch(() => {}).finally(() => carry.node.remove());
}

function beginScreenTransition(previousScene, nextScene) {
  let type = screenTransitionType(previousScene, nextScene);
  if (type === "none" || typeof document.body.animate !== "function") return null;

  if (type === "morph") {
    const region = app.querySelector(".screen:not(.screen-crossfade-out) .copy-region");
    if (region) {
      const inner = region.cloneNode(true);
      // An interrupted morph leaves the previous ghost inside the panel;
      // it must not be carried into the next one.
      inner.querySelectorAll(".copy-ghost").forEach(element => element.remove());
      carryPointerPaint(region, inner);
      scrubClone(inner);

      // Content still fading in keeps its current opacity, so a quick second
      // click continues the dissolve instead of popping back to solid.
      const liveChildren = [...region.children].filter(element => !element.classList.contains("copy-ghost"));
      [...inner.children].forEach((child, index) => {
        const source = liveChildren[index];
        if (!source) return;
        const opacity = Number(getComputedStyle(source).opacity);
        if (opacity < 1) child.style.opacity = String(opacity);
      });

      // The wrapper carries the outgoing screen's layout class so every
      // ancestor-scoped rule (phone paddings, kickers hidden on short
      // viewports) keeps matching the old content while it fades.
      const ghost = document.createElement("div");
      ghost.className = "copy-ghost";
      const layoutClass = [...(region.closest(".screen")?.classList || [])].find(name => name.endsWith("-layout"));
      if (layoutClass) ghost.classList.add(layoutClass);
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.append(inner);
      return { type, ghost, height: region.getBoundingClientRect().height, carry: captureFadingOverlay() };
    }
    type = "home"; // a flow screen without the panel: fall back to the full fade
  }

  const current = app.querySelector(".screen:not(.screen-crossfade-out)") || app.querySelector(".screen");
  if (!current) return null;
  const clone = current.cloneNode(true);
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.querySelectorAll(".copy-ghost").forEach(element => element.remove());
  carryPointerPaint(current, clone);
  scrubClone(clone);
  return { type, clone, carry: captureFadingOverlay() };
}

function runScreenTransition(pending) {
  if (!pending) return;
  if (pending.type === "morph") runCopyMorph(pending);
  else runScreenCrossfade(pending);
}

// One easing pair for every content dissolve, so each click feels like the
// same quiet page turn rather than a different effect each time. Both curves
// spread their change evenly across the whole duration ON PURPOSE: when the
// machine drops a frame mid-transition (re-blurring the glass at Retina is
// expensive), an even curve loses a sliver, while a fast-start curve loses
// its whole opening and reads as a hard cut - which is what the v0.25.14
// screen recording showed.
const MORPH_OUT = { duration: 420, easing: "cubic-bezier(.4, 0, .3, 1)", fill: "forwards" };
const MORPH_IN = { duration: 560, delay: 40, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "backwards" };

function runCopyMorph({ ghost, height, carry }) {
  const screen = app.querySelector(".screen");
  const region = screen?.querySelector(".copy-region");
  if (!region || typeof region.animate !== "function") return;

  // The frame is continuing, not arriving: skip the whole-screen enter fade.
  screen.classList.add("screen-settled");
  continueFadingOverlay(carry, screen);

  const incoming = [...region.children];
  region.append(ghost);

  const nextHeight = region.getBoundingClientRect().height;
  if (Math.abs(nextHeight - height) > 1) {
    region.animate(
      [{ height: `${height}px` }, { height: `${nextHeight}px` }],
      { duration: 520, easing: "cubic-bezier(.4, 0, .2, 1)" },
    );
  }

  ghost.animate([{ opacity: 1 }, { opacity: 0 }], MORPH_OUT)
    .finished.catch(() => {}).finally(() => ghost.remove());

  incoming.forEach(element => {
    element.animate(
      [{ opacity: 0, transform: "translateY(9px)" }, { opacity: 1, transform: "none" }],
      MORPH_IN,
    );
  });
}

function runScreenCrossfade({ clone, type, carry }) {
  const incomingScreen = app.querySelector(".screen");
  if (!incomingScreen || typeof incomingScreen.animate !== "function") return;

  const token = ++renderTransitionToken;
  const duration = 760;
  const easing = "ease-in-out";

  clone.classList.add("screen-crossfade-out");
  incomingScreen.classList.add("screen-crossfade-in");
  app.insertBefore(clone, incomingScreen);
  continueFadingOverlay(carry, clone);

  const out = clone.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration, easing, fill: "forwards" },
  );
  const incoming = incomingScreen.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: duration + 90, easing, fill: "both" },
  );

  Promise.allSettled([out.finished, incoming.finished]).then(() => {
    clone.remove();
    if (token !== renderTransitionToken) return;
    // Settle BEFORE dropping the crossfade class. Removing it re-enables
    // the .screen enter animation, and the browser then auto-removes the
    // finished crossfade as "replaced" - the whole screen restarted its
    // enter fade from nothing about a second after arriving (the vanishing
    // panel in the 2026-08-14 21:48 recording). screen-settled keeps
    // `animation: none` in force so nothing can re-arm.
    incomingScreen.classList.add("screen-settled");
    incomingScreen.classList.remove("screen-crossfade-in");
  });
}

function render(shouldFocus = true, transition = "auto") {
  clearTimeout(breathTimer);
  breathTimer = 0;
  clearTimeout(activityTimer);
  activityTimer = 0;
  breathTransitionToken += 1;
  document.documentElement.dataset.motion = preferences.motion;
  document.documentElement.dataset.motionExplicit = preferences.motionSet ? "1" : "0";
  const previousScene = document.body.dataset.scene || "";
  const nextScene = sceneName();
  const pending = transition === "none" ? null : beginScreenTransition(previousScene, nextScene);

  if (view === "resting") renderResting();
  if (view === "arrival") renderArrival();
  if (view === "practice") renderPractice();
  if (view === "complete") renderComplete();

  dispatchScene(nextScene);
  runScreenTransition(pending);
  // Any repaint of a screen that was already showing must not replay the
  // whole-screen enter fade - that flash is exactly the "shot-to-shot cut"
  // this system exists to remove. The morph adds the class itself; the
  // crossfade replaces the enter fade with its own; everything else (an
  // explicit "none", a motion-Still click, a preferences save) gets it here.
  if (!pending && previousScene) {
    app.querySelector(".screen")?.classList.add("screen-settled");
  }
  if (activity === "breath" && breathRunning) startBreathCycle();
  if (["ground", "release"].includes(activity) && practicePace === "guided") scheduleGuidedStep();

  if (shouldFocus) {
    // :not([inert]) keeps the focus off the fading clone during a
    // whole-screen crossfade; only the live title may take it.
    requestAnimationFrame(() => app.querySelector(".screen:not([inert]) [data-screen-title]")?.focus());
  }
}

function greetingForNow() {
  const hour = new Date().getHours();
  // 0–3 stays "evening": a 1am tab belongs to a long night, not a pointed
  // "technically it's morning".
  if (hour < 4) return "Good evening";
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function greetingText() {
  const name = cleanDisplayName(preferences.displayName);
  return name ? `${greetingForNow()}, ${name}.` : `${greetingForNow()}.`;
}

// The repeat-tab resting state: the browser's address bar keeps focus and
// stays the way onward. This screen only offers atmosphere and one door.
function renderResting() {
  currentGuidance = "";
  currentVoiceClip = null;
  app.innerHTML = `<section class="screen resting-layout">
    ${visualAnchor()}
    <div class="resting-copy">
      <h1 class="resting-greeting" tabindex="-1" data-screen-title>${escapeHtml(greetingText())}</h1>
      <p class="resting-note">A short breathing, grounding, or muscle-relaxation practice is here if you need it.</p>
      <button class="primary-button resting-open" data-action="open-arrival">Pause for a moment</button>
    </div>
  </section>`;
}

function renderArrival() {
  currentGuidance = "Choose breathing, sensory grounding, or seated muscle release. You can also continue without a practice.";
  currentVoiceClip = voiceClips.welcome;
  app.innerHTML = `<section class="screen arrival-layout">
    ${visualAnchor()}
    <div class="copy-region arrival-copy">
      <p class="kicker">Before you begin</p>
      <h1 class="arrival-title" tabindex="-1" data-screen-title>Choose your pause.</h1>
      <p class="lead">Breathe, ground, or release tension. You can also continue without a practice.</p>

      <div class="doorway-list" role="group" aria-label="Available practices">
        <button class="doorway" data-action="choose-practice" data-value="breath">
          <span class="doorway-symbol">${techniqueIcon("breath")}</span>
          <span><strong>Breathing</strong><small>Longer Exhale or Box Breathing</small></span>
          <span class="doorway-arrow" aria-hidden="true">→</span>
        </button>
        <button class="doorway" data-action="choose-practice" data-value="ground">
          <span class="doorway-symbol">${techniqueIcon("ground")}</span>
          <span><strong>Sensory Grounding</strong><small>3–2–1 noticing through sight, support and sound</small></span>
          <span class="doorway-arrow" aria-hidden="true">→</span>
        </button>
        <button class="doorway" data-action="choose-practice" data-value="release">
          <span class="doorway-symbol">${techniqueIcon("release")}</span>
          <span><strong>Seated Muscle Release</strong><small>Five steps to soften physical tension</small></span>
          <span class="doorway-arrow" aria-hidden="true">→</span>
        </button>
      </div>

      <button class="skip-button" data-action="skip-practice">Continue without a practice</button>
    </div>
  </section>`;
}

function renderPractice() {
  if (activity === "breath") renderBreath();
  if (activity === "ground") renderGrounding();
  if (activity === "release") renderRelease();
}

function renderBreath() {
  const phases = getBreathPhases();
  const label = breathLabel();
  if (!breathPatternConfirmed) {
    currentGuidance = "Choose a breathing rhythm. Longer Exhale has no breath holding. Box Breathing uses four slower, equal phases with two optional pauses.";
    currentVoiceClip = null;
    app.innerHTML = `<section class="screen practice-layout">
      ${visualAnchor()}
      <div class="copy-region practice-copy">
        <p class="kicker">Breathing</p>
        <h1 tabindex="-1" data-screen-title>Choose a breathing rhythm.</h1>
        <p class="lead">Both are short. Keep breathing normally if either pattern feels uncomfortable.</p>
        <div class="rhythm-options" role="group" aria-label="Breathing rhythms">
          <button class="rhythm-option" data-action="select-breath-pattern" data-value="even"
            aria-pressed="${preferences.breathPattern === "even"}">
            <span><strong>Longer Exhale</strong><small>No holding, with a little more time to breathe out</small></span>
            <span class="rhythm-arrow" aria-hidden="true">→</span>
          </button>
          <button class="rhythm-option" data-action="select-breath-pattern" data-value="box"
            aria-pressed="${preferences.breathPattern === "box"}">
            <span><strong>Box Breathing</strong><small>Four slower, equal phases with two optional pauses</small></span>
            <span class="rhythm-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        ${leavePracticeButton()}
      </div>
    </section>`;
    return;
  }

  if (!breathRunning) {
    const rhythm = preferences.breathPattern === "box"
      ? "Five seconds for each phase. Pause only if it feels comfortable, or keep breathing normally."
      : "Breathe in comfortably, then let the breath out a little longer. No holding.";
    currentGuidance = "Follow the movement at a comfortable pace. If a phase does not feel comfortable, keep breathing normally. You can leave at any time.";
    currentVoiceClip = voiceClips.breathIntro;
    app.innerHTML = `<section class="screen practice-layout">
      ${visualAnchor()}
      <div class="copy-region practice-copy">
        <div class="practice-meta"><p class="kicker">${label}</p>${guidanceButton()}</div>
        <h1 tabindex="-1" data-screen-title>Follow the rhythm.</h1>
        <p class="lead">${rhythm}</p>
        <div class="phase-preview" aria-label="${phases.map(item => item.short).join(", ")}">
          ${phases.map(item => `<span>${item.short}</span>`).join("")}
        </div>
        ${practiceActions("Start the rhythm", "start-breath")}
      </div>
    </section>`;
    return;
  }

  const phase = phases[breathPhase];
  currentGuidance = `${phase.title}. ${phase.note}`;
  currentVoiceClip = voiceClips[`breath-${phase.key}`];
  app.innerHTML = `<section class="screen practice-layout">
    ${visualAnchor()}
    <div class="copy-region practice-copy breath-active">
      <div class="practice-meta"><p class="kicker">${label}</p>${guidanceButton()}</div>
      <h1 tabindex="-1" data-screen-title id="breathTitle">${phase.title}</h1>
      <p class="lead" id="breathNote">${phase.note}</p>
      <div class="phase-dots" aria-hidden="true">
        ${phases.map((_, index) => `<i class="${index === breathPhase ? "active" : ""}"></i>`).join("")}
      </div>
      ${practiceActions("I’m ready to continue", "finish-practice")}
    </div>
  </section>`;
}

function renderGrounding() {
  if (!practicePace) {
    currentGuidance = "Sensory grounding uses sight, physical support, and sound to help you notice the present moment. Choose automatic guidance or move at your own pace.";
    currentVoiceClip = voiceClips.groundIntro;
    app.innerHTML = `<section class="screen practice-layout">
      ${visualAnchor()}
      <div class="copy-region practice-copy">
        <div class="practice-meta"><p class="kicker">Sensory Grounding</p>${guidanceButton()}</div>
        <h1 tabindex="-1" data-screen-title>Choose your pace.</h1>
        <p class="lead">A 3–2–1 noticing practice using sight, physical support and sound.</p>
        <div class="actions">
          <button type="button" class="primary-button" data-action="start-practice-pace" data-value="guided">Guide me automatically</button>
          <button type="button" class="secondary-button" data-action="start-practice-pace" data-value="manual">I’ll move at my own pace</button>
        </div>
        <p class="pace-note">Automatic guidance gives you fifteen seconds for each prompt. The final step waits for you.</p>
        ${leavePracticeButton()}
      </div>
    </section>`;
    return;
  }

  const step = groundingSteps[activityStep];
  const isLast = activityStep === groundingSteps.length - 1;
  currentGuidance = step.guidance;
  currentVoiceClip = voiceClips[`ground-${activityStep + 1}`];
  app.innerHTML = `<section class="screen practice-layout">
    ${visualAnchor()}
    <div class="copy-region practice-copy">
      <div class="practice-meta"><p class="kicker">Sensory Grounding</p>${guidanceButton()}</div>
      ${stepMarker(activityStep + 1, groundingSteps.length)}
      <div class="sense-count" aria-hidden="true">${step.count}</div>
      <h1 tabindex="-1" data-screen-title>${step.title}</h1>
      <p class="lead">${step.guidance} You do not need to enter an answer.</p>
      ${practicePace === "guided" && !isLast
        ? `<div class="actions"><button type="button" class="primary-button" data-action="next-ground">Continue now</button><button type="button" class="secondary-button" data-action="switch-manual">Use my own pace</button></div><p class="automatic-note">The next step will appear automatically.</p>${leavePracticeButton()}`
        : practiceActions(isLast ? "I’m ready to continue" : "I noticed them", isLast ? "finish-practice" : "next-ground")}
    </div>
  </section>`;
}

function renderRelease() {
  if (!practicePace) {
    currentGuidance = "Seated muscle release uses five steps to notice support and soften tension. Choose automatic guidance or move at your own pace.";
    currentVoiceClip = voiceClips.releaseIntro;
    app.innerHTML = `<section class="screen practice-layout">
      ${visualAnchor()}
      <div class="copy-region practice-copy">
        <div class="practice-meta"><p class="kicker">Seated Muscle Release</p>${guidanceButton()}</div>
        <h1 tabindex="-1" data-screen-title>Choose your pace.</h1>
        <p class="lead">Five seated steps using support, light pressure and release.</p>
        <div class="actions">
          <button type="button" class="primary-button" data-action="start-practice-pace" data-value="guided">Guide me automatically</button>
          <button type="button" class="secondary-button" data-action="start-practice-pace" data-value="manual">I’ll move at my own pace</button>
        </div>
        <p class="pace-note">Automatic guidance changes steps every ten seconds. The final step waits for you.</p>
        ${leavePracticeButton()}
      </div>
    </section>`;
    return;
  }

  const step = releaseSteps[activityStep];
  const isLast = activityStep === releaseSteps.length - 1;
  currentGuidance = `${step.title} ${step.guidance}`;
  currentVoiceClip = voiceClips[step.scene];
  app.innerHTML = `<section class="screen practice-layout">
    ${visualAnchor()}
    <div class="copy-region practice-copy">
      <div class="practice-meta"><p class="kicker">Seated Muscle Release</p>${guidanceButton()}</div>
      ${stepMarker(activityStep + 1, releaseSteps.length)}
      <h1 tabindex="-1" data-screen-title>${step.title}</h1>
      <p class="lead">${step.guidance}</p>
      ${practicePace === "guided" && !isLast
        ? `<div class="actions"><button type="button" class="primary-button" data-action="next-release">Continue now</button><button type="button" class="secondary-button" data-action="switch-manual">Use my own pace</button></div><p class="automatic-note">The next step will appear automatically.</p>${leavePracticeButton()}`
        : practiceActions(isLast ? "I’m ready to continue" : "Next step", isLast ? "finish-practice" : "next-release")}
    </div>
  </section>`;
}

// Sound-name phrasing for the bridge sentence: "the ocean", "the soft rain",
// "the forest", but plain "brown noise".
function soundPhrase(label) {
  const lower = label.toLowerCase();
  return lower === "brown noise" ? "brown noise" : `the ${lower}`;
}

function soundTitle(label) {
  return label.replace(/(^|\s)[a-z]/g, match => match.toUpperCase());
}

function bridgeNote() {
  return bridgeMinutes
    ? `It will fade out after about ${bridgeMinutes} minutes.`
    : "Pause or stop it any time with the Ambient control at the top of the page.";
}

function bridgeDurationPhrase() {
  return bridgeMinutes ? `for ${bridgeMinutes} minutes` : "until you stop it";
}

// Completion: the ritual is done; the only question is whether the sound
// comes along. Sound never starts without the explicit choice below.
function renderComplete() {
  const track = ambientTracks[preferences.ambient];
  const label = ambientState.active && ambientState.label ? ambientState.label : track.label;
  const playing = !!ambientState.active;
  currentGuidance = "You are here. Open what you need when you are ready.";
  currentVoiceClip = completionVoiceClip;
  const durations = [
    { minutes: 15, text: "15 min" },
    { minutes: 30, text: "30 min" },
    { minutes: 60, text: "60 min" },
    { minutes: null, text: "Until I stop" },
  ];
  if (playing && bridgeMinutes && !durations.some(option => option.minutes === bridgeMinutes)) {
    durations.unshift({
      minutes: bridgeMinutes,
      text: `About ${bridgeMinutes} min left`,
    });
  }
  app.innerHTML = `<section class="screen complete-layout">
    ${visualAnchor()}
    <div class="copy-region complete-copy">
      <p class="kicker">Pause complete</p>
      <h1 tabindex="-1" data-screen-title>You’re here.</h1>
      <p class="lead">${playing
        ? `Keep ${soundPhrase(label)} with you ${bridgeDurationPhrase()}?`
        : `Would you like ${soundPhrase(label)} with you ${bridgeDurationPhrase()}?`}</p>
      <div class="actions bridge-actions">
        <button class="secondary-button bridge-choice" data-action="keep-sound">${playing
          ? `Keep ${soundTitle(label)} Playing`
          : `Play ${soundTitle(label)}`}</button>
        <button class="secondary-button bridge-choice" data-action="finish-quiet">Continue quietly</button>
      </div>
      <button class="duration-change" data-action="toggle-duration"
        aria-expanded="${bridgeDurationExpanded}" aria-controls="bridgeDurations">Change duration</button>
      <fieldset class="duration-fieldset" id="bridgeDurations" ${bridgeDurationExpanded ? "" : "hidden"}>
        <legend class="sr-only">How long the sound stays with you</legend>
        <div class="duration-row">
          ${durations.map(option => `<label class="duration-chip">
            <input type="radio" name="bridge-duration" value="${option.minutes ?? ""}"
              ${bridgeMinutes === option.minutes ? "checked" : ""}>
            <span>${option.text}</span>
          </label>`).join("")}
        </div>
      </fieldset>
      <p class="bridge-note">${bridgeNote()}</p>
    </div>
  </section>`;
}

function startBreathCycle() {
  const phases = getBreathPhases();
  const advance = () => {
    breathPhase = (breathPhase + 1) % phases.length;
    const phase = phases[breathPhase];
    currentGuidance = `${phase.title}. ${phase.note}`;
    transitionBreathCopy(phase, breathPhase);
    breathTimer = window.setTimeout(advance, phase.ms);
  };
  breathTimer = window.setTimeout(advance, phases[breathPhase].ms);
}

function scheduleGuidedStep() {
  if (view !== "practice" || practicePace !== "guided") return;
  const steps = activity === "ground" ? groundingSteps : activity === "release" ? releaseSteps : [];
  if (!steps.length || activityStep >= steps.length - 1) return;

  const delay = activity === "ground" ? 15000 : 10000;
  activityTimer = window.setTimeout(advanceGuidedStep, delay);
}

function advanceGuidedStep() {
  const steps = activity === "ground" ? groundingSteps : releaseSteps;
  if (view !== "practice" || practicePace !== "guided" || activityStep >= steps.length - 1) return;

  // The render's own content morph is the dissolve; a separate fade here
  // would stack on top of it and stutter.
  activityStep += 1;
  render(false);
  playVoice();
  announce(currentGuidance);
}

function transitionBreathCopy(phase, phaseIndex) {
  const title = document.querySelector("#breathTitle");
  const note = document.querySelector("#breathNote");
  if (!title || !note) return;

  const token = ++breathTransitionToken;
  const reduced = motionIsStill();

  // Begin the new visual phase at the actual rhythm boundary. The copy can
  // dissolve at its own quieter pace without shortening the breathing motion.
  dispatchScene(`breath-${phase.key}`);

  const applyPhase = () => {
    if (token !== breathTransitionToken || activity !== "breath" || !breathRunning) return;
    title.textContent = phase.title;
    note.textContent = phase.note;
    currentGuidance = `${phase.title}. ${phase.note}`;
    currentVoiceClip = voiceClips[`breath-${phase.key}`];
    document.querySelectorAll(".phase-dots i").forEach((dot, index) => {
      dot.classList.toggle("active", index === phaseIndex);
    });
    playVoice();
    announce(phase.title);
  };

  if (reduced || typeof title.animate !== "function") {
    applyPhase();
    return;
  }

  const titleOut = title.animate(
    [
      { opacity: 1 },
      { opacity: 0 },
    ],
    { duration: 680, easing: "ease-in-out", fill: "forwards" },
  );
  const noteOut = note.animate(
    [
      { opacity: 1 },
      { opacity: 0 },
    ],
    { duration: 620, delay: 60, easing: "ease-in-out", fill: "forwards" },
  );

  Promise.all([titleOut.finished, noteOut.finished]).then(() => {
    if (token !== breathTransitionToken) return;
    applyPhase();
    if (token !== breathTransitionToken) return;

    title.animate(
      [
        { opacity: 0 },
        { opacity: 1 },
      ],
      { duration: 860, easing: "ease-in-out", fill: "both" },
    );
    note.animate(
      [
        { opacity: 0 },
        { opacity: 1 },
      ],
      { duration: 900, delay: 90, easing: "ease-in-out", fill: "both" },
    );
  }).catch(() => {});
}

async function startAmbientSession(minutes) {
  const track = ambientTracks[preferences.ambient];
  if (!track) return { active: false };
  soundLoading = true;
  updateSoundButton();
  let state;
  try {
    state = await ambientSend("play", {
      sound: preferences.ambient,
      label: track.label,
      src: track.src,
      volume: preferences.ambientVolume,
      minutes: minutes ?? null,
    });
  } catch {
    // Whatever went wrong, the control must not be left mid-flight: toggleSound
    // refuses to run while soundLoading is set, so a throw here would make the
    // button permanently unusable rather than merely unsuccessful.
    state = { active: false, error: "playback-failed" };
  } finally {
    soundLoading = false;
  }
  ambientState = state?.active ? state : { active: false };
  if (ambientState.active && !voicePlayer.paused && !voicePlayer.ended) {
    await ambientSend("duck");
  }
  updateSoundButton();
  return ambientState;
}

async function toggleSound() {
  primeAudioOnGesture(); // synchronous, before any await — required by iOS Safari
  if (soundLoading) return;
  if (ambientState.active) {
    ambientState = { active: false };
    updateSoundButton();
    await ambientSend("stop");
    announce("Ambient sound stopped.");
    return;
  }
  const track = ambientTracks[preferences.ambient];
  const state = await startAmbientSession(null);
  announce(state.active
    ? (state.local
      ? `${track.label} is on and playing in this tab.`
      : `${track.label} is on until you stop it.`)
    : "Ambient sound could not start. Try choosing a sound again.");
}

function returnHome() {
  breathRunning = false;
  breathPhase = 0;
  breathPatternConfirmed = false;
  activity = null;
  activityStep = 0;
  practicePace = null;
  view = "arrival";
  completionVoiceClip = voiceClips.complete;
  stopVoice();
  render();
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  // Prime the audio context while the tap is still live (iOS requirement).
  // Harmless on every action; only the sound-producing ones use it.
  primeAudioOnGesture();

  const { action, value } = button.dataset;
  if (action === "toggle-guidance") {
    preferences.voice = !preferences.voice;
    savePreferences();
    const controls = button.closest(".guidance-controls");
    if (!preferences.voice) stopVoice();
    if (controls) controls.outerHTML = guidanceButton();
    announce(`Voice guidance ${preferences.voice ? "on" : "off"}.`);
    if (preferences.voice) requestAnimationFrame(() => playVoice());
    return;
  }
  if (action === "toggle-duration") {
    bridgeDurationExpanded = !bridgeDurationExpanded;
    button.setAttribute("aria-expanded", String(bridgeDurationExpanded));
    const fieldset = app.querySelector("#bridgeDurations");
    if (fieldset) fieldset.hidden = !bridgeDurationExpanded;
    if (bridgeDurationExpanded) {
      fieldset?.querySelector("input:checked, input")?.focus();
    }
    return;
  }
  if (action === "keep-sound") {
    const track = ambientTracks[preferences.ambient];
    const minutes = bridgeMinutes;
    // Starting a bed can take seconds on a slow phone (the web build waits
    // for the real decode), and the buttons stay live meanwhile. Each bridge
    // choice supersedes the one before it: a result that comes back after a
    // newer choice must neither claim the session nor announce anything.
    const myChoice = ++bridgeChoiceToken;
    stopVoice(false);
    const state = ambientState.active && !bridgeDurationChanged
      ? await ambientSend("unduck")
      : await startAmbientSession(minutes);
    if (myChoice !== bridgeChoiceToken) {
      // Superseded while loading: let the engine's actual state, not this
      // stale result, set the header button.
      ambientSend("get-state").then(current => {
        ambientState = current?.active ? current : { active: false };
        updateSoundButton();
      });
      return;
    }
    ambientState = state?.active ? state : { active: false };
    if (ambientState.active) await ambientSend("unduck");
    updateSoundButton();
    const suffix = state?.local ? " It plays in this tab and pauses if you close it." : "";
    announce(state?.active
      ? (minutes
        ? `${track.label} stays with you for ${minutes} minutes, then fades out on its own.${suffix}`
        : `${track.label} stays with you until you stop it.${suffix}`)
      : "Ambient sound could not start. Try choosing a sound again.");
    view = "resting";
    render();
    return;
  }
  if (action === "finish-quiet") {
    bridgeChoiceToken += 1;
    // A start that is still loading counts as sound-on: quietly means the
    // pending session must be stopped too, not just an already-playing one.
    if (ambientState.active || soundLoading) {
      ambientState = { active: false };
      updateSoundButton();
      await ambientSend("stop");
    }
    announce("Finished quietly.");
    stopVoice(false);
    view = "resting";
    render();
    return;
  }

  let playAfterRender = false;
  if (action === "open-arrival") {
    view = "arrival";
  }
  if (action === "choose-practice") {
    activity = value;
    activityStep = 0;
    practicePace = null;
    breathPhase = 0;
    breathRunning = false;
    breathPatternConfirmed = false;
    completionVoiceClip = voiceClips.complete;
    view = "practice";
    playAfterRender = true;
  }
  if (action === "choose-another") {
    activity = null;
    activityStep = 0;
    practicePace = null;
    breathRunning = false;
    breathPatternConfirmed = false;
    completionVoiceClip = voiceClips.complete;
    view = "arrival";
  }
  if (action === "skip-practice" || action === "finish-practice") {
    if (action === "finish-practice") {
      completionVoiceClip = activity === "breath"
        ? voiceClips.breathComplete
        : activity === "ground"
          ? voiceClips.groundComplete
          : voiceClips.releaseComplete;
    } else {
      completionVoiceClip = voiceClips.complete;
    }
    breathRunning = false;
    practicePace = null;
    bridgeMinutes = ambientState.active
      ? (ambientState.remaining === null || ambientState.remaining === undefined
        ? null
        : Math.max(1, Math.round(ambientState.remaining / 60)))
      : 30;
    bridgeDurationExpanded = false;
    bridgeDurationChanged = false;
    view = "complete";
    playAfterRender = true;
    announce("You’re here. Open what you need when you’re ready.");
  }
  if (action === "start-breath") {
    breathPhase = 0;
    breathRunning = true;
    playAfterRender = true;
  }
  if (action === "select-breath-pattern") {
    preferences.breathPattern = value === "box" ? "box" : "even";
    savePreferences();
    breathPhase = 0;
    breathRunning = false;
    breathPatternConfirmed = true;
    playAfterRender = true;
    announce(`${breathLabel()} selected.`);
  }
  if (action === "start-practice-pace") {
    practicePace = value === "guided" ? "guided" : "manual";
    activityStep = 0;
    playAfterRender = true;
  }
  if (action === "switch-manual") practicePace = "manual";
  if (action === "next-ground") {
    activityStep = Math.min(activityStep + 1, groundingSteps.length - 1);
    playAfterRender = true;
  }
  if (action === "next-release") {
    activityStep = Math.min(activityStep + 1, releaseSteps.length - 1);
    playAfterRender = true;
  }

  stopVoice(false);
  render();
  if (playAfterRender) requestAnimationFrame(() => playVoice());
});

document.addEventListener("change", event => {
  const guidanceVolume = event.target.closest(".practice-guidance-volume-input");
  if (guidanceVolume) {
    preferences.voiceVolume = clampVolume(Number(guidanceVolume.value) / 100, defaultPreferences.voiceVolume);
    voicePlayer.volume = preferences.voiceVolume;
    savePreferences();
    announce(`Voice guidance volume ${guidanceVolume.value} percent.`);
    return;
  }

  const input = event.target.closest('input[name="bridge-duration"]');
  if (!input) return;
  bridgeMinutes = input.value ? Number(input.value) : null;
  bridgeDurationChanged = true;
  const lead = app.querySelector(".complete-copy .lead");
  const track = ambientTracks[preferences.ambient];
  const label = ambientState.active && ambientState.label ? ambientState.label : track.label;
  if (lead) {
    lead.textContent = ambientState.active
      ? `Keep ${soundPhrase(label)} with you ${bridgeDurationPhrase()}?`
      : `Would you like ${soundPhrase(label)} with you ${bridgeDurationPhrase()}?`;
  }
  const note = app.querySelector(".bridge-note");
  if (note) note.textContent = bridgeNote();
});

document.addEventListener("input", event => {
  const guidanceVolume = event.target.closest(".practice-guidance-volume-input");
  if (!guidanceVolume) return;
  preferences.voiceVolume = clampVolume(Number(guidanceVolume.value) / 100, defaultPreferences.voiceVolume);
  voicePlayer.volume = preferences.voiceVolume;
  const output = guidanceVolume.closest(".practice-guidance-volume")?.querySelector("output");
  if (output) output.textContent = `${guidanceVolume.value}%`;
});

soundToggle.addEventListener("click", toggleSound);

document.querySelector("#settingsOpen").addEventListener("click", () => {
  settingsDialog.querySelector(`[name="motion"][value="${preferences.motion}"]`).checked = true;
  // The web build has no "New tab behaviour" fieldset - tab frequency is a
  // browser-extension concern - so this control may not exist.
  const tabModeChoice = settingsDialog.querySelector(`[name="tabMode"][value="${preferences.tabMode}"]`);
  if (tabModeChoice) tabModeChoice.checked = true;
  settingsDialog.querySelector(`[name="breath"][value="${preferences.breathPattern}"]`).checked = true;
  settingsDialog.querySelector(`[name="ambient"][value="${preferences.ambient}"]`).checked = true;
  document.querySelector("#voiceSetting").checked = preferences.voice;
  document.querySelector("#displayName").value = preferences.displayName;
  document.querySelector("#ambientVolume").value = Math.round(preferences.ambientVolume * 100);
  document.querySelector("#voiceVolume").value = Math.round(preferences.voiceVolume * 100);
  document.querySelector("#ambientVolumeValue").textContent = `${Math.round(preferences.ambientVolume * 100)}%`;
  document.querySelector("#voiceVolumeValue").textContent = `${Math.round(preferences.voiceVolume * 100)}%`;
  settingsDialog.showModal();
});

document.querySelector("#settingsClose").addEventListener("click", () => {
  settingsDialog.close("cancel");
});

settingsForm.addEventListener("submit", () => {
  // The Save button has no data-action, so the document-level click primer
  // never covers it - and saving can switch the playing sound, which needs a
  // live gesture on iOS. Synchronous, before any preference reads.
  primeAudioOnGesture();
  const previousAmbient = preferences.ambient;
  const previousBreath = preferences.breathPattern;
  const previousMotion = preferences.motion;
  const previousTabMode = preferences.tabMode;
  const previousVoice = preferences.voice;
  const previousDisplayName = preferences.displayName;
  preferences.motion = settingsDialog.querySelector('[name="motion"]:checked')?.value || "full";
  preferences.motionSet = true; // an explicit choice now outranks the OS default
  preferences.tabMode = settingsDialog.querySelector('[name="tabMode"]:checked')?.value || defaultPreferences.tabMode;
  preferences.displayName = cleanDisplayName(document.querySelector("#displayName").value);
  preferences.breathPattern = settingsDialog.querySelector('[name="breath"]:checked')?.value || defaultPreferences.breathPattern;
  preferences.ambient = settingsDialog.querySelector('[name="ambient"]:checked')?.value || defaultPreferences.ambient;
  preferences.ambientVolume = clampVolume(Number(document.querySelector("#ambientVolume").value) / 100, defaultPreferences.ambientVolume);
  preferences.voice = document.querySelector("#voiceSetting").checked;
  preferences.voiceVolume = clampVolume(Number(document.querySelector("#voiceVolume").value) / 100, defaultPreferences.voiceVolume);
  if (previousBreath !== preferences.breathPattern) breathPhase = 0;
  savePreferences();
  voicePlayer.volume = preferences.voiceVolume;
  if (!preferences.voice) stopVoice();
  if (ambientState.active) {
    if (previousAmbient !== preferences.ambient) {
      const track = ambientTracks[preferences.ambient];
      ambientSend("select-sound", {
        sound: preferences.ambient,
        label: track.label,
        src: track.src,
        volume: preferences.ambientVolume,
        minutes: ambientState.remaining ? Math.max(1 / 60, ambientState.remaining / 60) : null,
      }).then(state => {
        ambientState = state?.active ? state : { active: false };
        updateSoundButton();
      });
    } else {
      ambientSend("set-volume", { volume: preferences.ambientVolume });
    }
  }
  updateSoundButton();
  announce("Preferences saved.");
  // Re-render only when a saved change affects the current view.
  const needsRender = previousMotion !== preferences.motion
    || previousTabMode !== preferences.tabMode
    || previousBreath !== preferences.breathPattern
    || previousVoice !== preferences.voice
    || previousDisplayName !== preferences.displayName;
  if (previousTabMode !== preferences.tabMode && ["arrival", "resting"].includes(view)) {
    if (preferences.tabMode === "minimal") view = "resting";
    if (preferences.tabMode === "full") view = "arrival";
  }
  // A preferences save repaints in place; the content is the same thought,
  // so a dissolve here would read as a glitch rather than a step.
  if (needsRender) render(false, "none");
});

document.querySelector("#ambientVolume").addEventListener("input", event => {
  document.querySelector("#ambientVolumeValue").textContent = `${event.target.value}%`;
});

document.querySelector("#voiceVolume").addEventListener("input", event => {
  document.querySelector("#voiceVolumeValue").textContent = `${event.target.value}%`;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Voice guidance ends when the user moves on; a continuing sound session
    // lives in the offscreen document and is untouched by tab visibility.
    stopVoice(false);
    clearTimeout(breathTimer);
    clearTimeout(activityTimer);
  } else {
    if (view === "resting") {
      // Refresh the greeting on a tab left open across a time-of-day boundary.
      const greeting = app.querySelector(".resting-greeting");
      if (greeting) greeting.textContent = greetingText();
    }
    if (activity === "breath" && breathRunning) startBreathCycle();
    if (["ground", "release"].includes(activity) && practicePace === "guided") scheduleGuidedStep();
    // Another tab may have started or stopped the shared session meanwhile.
    ambientSend("get-state").then(state => {
      ambientState = state?.active ? state : { active: false };
      updateSoundButton();
    });
  }
});

view = decideEntryView();
revealWebInstallLink();
updateSoundButton();
render(false);

// A sound session may already be running from another tab - reflect it.
ambientSend("get-state").then(state => {
  if (state?.active) {
    ambientState = state;
    updateSoundButton();
  }
});
