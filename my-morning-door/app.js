const PREFS_KEY = "myMorningDoorPreferencesV3";
// One rolling timestamp, only to tell "first tab in a while" from "another tab".
// Deliberately NOT a history: nothing accumulates, nothing is dated, nothing is shown back.
const LAST_TAB_KEY = "myMorningDoorLastTabAt";
const VOICE_DEFAULTS_KEY = "myMorningDoorVoiceDefaultsV2";
const ARRIVAL_GAP_MS = 4 * 60 * 60 * 1000; // offer the full arrival once per stretch of the day, not per tab

const defaultPreferences = {
  motion: "full",
  motionSet: false, // true once the user has explicitly chosen a motion mode
  voice: false,
  voiceVolume: 0.5,
  ambient: "ocean",
  ambientVolume: 0.28,
  breathPattern: "even",
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
    { key: "in", title: "Breathe in", note: "Let the circle widen with you.", short: "Breathe in", ms: 4000 },
    { key: "hold-one", title: "A quiet pause", note: "Stay here only if it feels comfortable.", short: "Pause", ms: 4000 },
    { key: "out", title: "Breathe out slowly", note: "Let the circle soften inward.", short: "Breathe out", ms: 4000 },
    { key: "hold-two", title: "Rest here", note: "Keep breathing in your own way.", short: "Rest", ms: 4000 },
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
let softenNextPractice = false;
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

const voicePlayer = new Audio();
voicePlayer.preload = "auto";

const app = document.querySelector("#app");
const status = document.querySelector("#status");
const settingsDialog = document.querySelector("#settingsDialog");
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

preferences.voiceVolume = clampVolume(preferences.voiceVolume, defaultPreferences.voiceVolume);
preferences.ambientVolume = clampVolume(preferences.ambientVolume, defaultPreferences.ambientVolume);
preferences.voice = preferences.voice === true;
if (!ambientTracks[preferences.ambient]) preferences.ambient = defaultPreferences.ambient;
if (!breathPatterns[preferences.breathPattern]) preferences.breathPattern = defaultPreferences.breathPattern;
preferences.motionSet = preferences.motionSet === true;

// The system's reduced-motion setting is the DEFAULT, not a lock: once the
// user explicitly chooses a motion mode in Preferences, that choice wins.
function motionIsStill() {
  if (preferences.motion === "still") return true;
  if (preferences.motionSet) return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function updateSoundButton() {
  const label = ambientState.active && ambientState.label
    ? ambientState.label
    : ambientTracks[preferences.ambient]?.label || "Ambient sound";
  soundToggle.textContent = soundLoading ? "Starting ambient…" : ambientState.active ? `${label} on` : "Ambient off";
  soundToggle.setAttribute("aria-pressed", String(!!ambientState.active));
  soundToggle.setAttribute("aria-busy", String(soundLoading));
  soundToggle.setAttribute(
    "aria-label",
    soundLoading ? "Starting ambient sound" : ambientState.active ? `Turn off ${label}` : `Turn on ${label}`,
  );
}

/* --- Sound session client -------------------------------------------
   All ambient playback happens in ONE place. Installed as an extension,
   that place is the offscreen document (via the service worker), so the
   sound survives navigation and is shared by every tab. In a direct HTML
   preview (no extension runtime) the same engine runs in this page. */

let previewEngine = null;
let ambientLocalMode = false; // shared playback failed → this page plays instead

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

  // The same five-second ceiling the shared path uses, for the same reason: a
  // failed fetch, an undecodable file, or a context that never resumes must
  // resolve to an inactive state rather than reject. A rejection here would
  // leave the control reading "Starting ambient…" with no way back.
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise(resolve => setTimeout(() => resolve({ active: false, error: "no-reply" }), 5000)),
    ]);
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
      class="guidance-button"
      data-action="toggle-guidance"
      aria-pressed="${enabled}"
      aria-label="${enabled ? "Turn off" : "Turn on"} voice guidance"
    >Voice guidance: ${enabled ? "On" : "Off"}</button>
    ${enabled ? `<label class="practice-guidance-volume">
      <span>Volume</span>
      <input
        class="practice-guidance-volume-input"
        type="range"
        min="0"
        max="100"
        step="1"
        value="${percent}"
        aria-label="Voice guidance volume"
      >
      <output>${percent}%</output>
    </label>` : ""}
  </div>`;
}

function practiceActions(primaryLabel, primaryAction) {
  return `<div class="actions">
    <button class="primary-button" data-action="${primaryAction}">${primaryLabel}</button>
    <button class="secondary-button" data-action="choose-another">Choose something else</button>
  </div>`;
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

function dispatchScene(scene = sceneName()) {
  document.body.dataset.scene = scene;
  let duration = 4000;
  if (scene.startsWith("breath-")) {
    const phase = getBreathPhases()[breathPhase];
    if (phase) duration = phase.ms;
  }
  window.dispatchEvent(new CustomEvent("morningdoor:scene", { detail: { scene, duration } }));
}

function render(shouldFocus = true) {
  clearTimeout(breathTimer);
  breathTimer = 0;
  clearTimeout(activityTimer);
  activityTimer = 0;
  breathTransitionToken += 1;
  document.documentElement.dataset.motion = preferences.motion;
  document.documentElement.dataset.motionExplicit = preferences.motionSet ? "1" : "0";

  if (view === "resting") renderResting();
  if (view === "arrival") renderArrival();
  if (view === "practice") renderPractice();
  if (view === "complete") renderComplete();

  dispatchScene();
  if (activity === "breath" && breathRunning) startBreathCycle();
  if (["ground", "release"].includes(activity) && practicePace === "guided") scheduleGuidedStep();

  if (softenNextPractice) {
    softenNextPractice = false;
    requestAnimationFrame(() => {
      const copy = app.querySelector(".practice-copy");
      const reduced = motionIsStill();
      if (!copy || reduced || typeof copy.animate !== "function") return;
      copy.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 680, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" },
      );
    });
  }

  if (shouldFocus) {
    requestAnimationFrame(() => app.querySelector("[data-screen-title]")?.focus());
  }
}

function greetingForNow() {
  const hour = new Date().getHours();
  // 0–3 stays "evening": a 1am tab belongs to a long night, not a pointed
  // "technically it's morning".
  if (hour < 4) return "Good evening";
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// The repeat-tab resting state: the browser's address bar keeps focus and
// stays the way onward. This screen only offers atmosphere and one door.
function renderResting() {
  currentGuidance = "";
  currentVoiceClip = null;
  app.innerHTML = `<section class="screen resting-layout">
    ${visualAnchor()}
    <div class="resting-copy">
      <h1 class="resting-greeting" tabindex="-1" data-screen-title>${greetingForNow()}.</h1>
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

      <div class="doorway-list" aria-label="Available practices">
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
    currentGuidance = "Choose a breathing rhythm. Longer Exhale has no breath holding. Box Breathing includes two breath holds.";
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
            <span><strong>Box Breathing</strong><small>Four equal phases, including two breath holds</small></span>
            <span class="rhythm-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        <button class="secondary-button rhythm-back" data-action="choose-another">Choose something else</button>
      </div>
    </section>`;
    return;
  }

  if (!breathRunning) {
    const rhythm = preferences.breathPattern === "box"
      ? "Four equal phases with breath holds. Keep breathing normally whenever that feels better."
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
          <button class="primary-button" data-action="start-practice-pace" data-value="guided">Guide me automatically</button>
          <button class="secondary-button" data-action="start-practice-pace" data-value="manual">I’ll move at my own pace</button>
        </div>
        <p class="pace-note">Automatic guidance gives you fifteen seconds for each prompt. The final step waits for you.</p>
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
        ? `<div class="actions"><button class="primary-button" data-action="next-ground">Continue now</button><button class="secondary-button" data-action="switch-manual">Use my own pace</button></div><p class="automatic-note">The next step will appear automatically.</p>`
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
          <button class="primary-button" data-action="start-practice-pace" data-value="guided">Guide me automatically</button>
          <button class="secondary-button" data-action="start-practice-pace" data-value="manual">I’ll move at my own pace</button>
        </div>
        <p class="pace-note">Automatic guidance changes steps every ten seconds. The final step waits for you.</p>
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
        ? `<div class="actions"><button class="primary-button" data-action="next-release">Continue now</button><button class="secondary-button" data-action="switch-manual">Use my own pace</button></div><p class="automatic-note">The next step will appear automatically.</p>`
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
    : "Use the door icon by the address bar whenever you want to pause or stop it.";
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

  let applied = false;
  const applyNextStep = () => {
    if (applied || view !== "practice" || practicePace !== "guided") return;
    applied = true;
    activityStep += 1;
    softenNextPractice = true;
    render(false);
    playVoice();
    announce(currentGuidance);
  };

  const copy = app.querySelector(".practice-copy");
  const reduced = motionIsStill();
  if (!copy || reduced || typeof copy.animate !== "function") {
    applyNextStep();
    return;
  }

  copy.animate(
    [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-7px)" },
    ],
    { duration: 340, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
  ).finished.then(applyNextStep).catch(applyNextStep);
}

function transitionBreathCopy(phase, phaseIndex) {
  const title = document.querySelector("#breathTitle");
  const note = document.querySelector("#breathNote");
  if (!title || !note) return;

  const token = ++breathTransitionToken;
  const reduced = motionIsStill();

  const applyPhase = () => {
    if (token !== breathTransitionToken || activity !== "breath" || !breathRunning) return;
    title.textContent = phase.title;
    note.textContent = phase.note;
    currentGuidance = `${phase.title}. ${phase.note}`;
    currentVoiceClip = voiceClips[`breath-${phase.key}`];
    document.querySelectorAll(".phase-dots i").forEach((dot, index) => {
      dot.classList.toggle("active", index === phaseIndex);
    });
    dispatchScene(`breath-${phase.key}`);
    playVoice();
    announce(phase.title);
  };

  if (reduced || typeof title.animate !== "function") {
    applyPhase();
    return;
  }

  const titleOut = title.animate(
    [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-7px)" },
    ],
    { duration: 360, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
  );
  const noteOut = note.animate(
    [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-5px)" },
    ],
    { duration: 320, delay: 45, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
  );

  Promise.all([titleOut.finished, noteOut.finished]).then(() => {
    if (token !== breathTransitionToken) return;
    applyPhase();
    if (token !== breathTransitionToken) return;

    title.animate(
      [
        { opacity: 0, transform: "translateY(9px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 680, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" },
    );
    note.animate(
      [
        { opacity: 0, transform: "translateY(7px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 720, delay: 80, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" },
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
  if (action === "home") {
    returnHome();
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
    stopVoice(false);
    const state = ambientState.active && !bridgeDurationChanged
      ? await ambientSend("unduck")
      : await startAmbientSession(minutes);
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
    if (ambientState.active) {
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
  settingsDialog.querySelector(`[name="breath"][value="${preferences.breathPattern}"]`).checked = true;
  settingsDialog.querySelector(`[name="ambient"][value="${preferences.ambient}"]`).checked = true;
  document.querySelector("#voiceSetting").checked = preferences.voice;
  document.querySelector("#ambientVolume").value = Math.round(preferences.ambientVolume * 100);
  document.querySelector("#voiceVolume").value = Math.round(preferences.voiceVolume * 100);
  document.querySelector("#ambientVolumeValue").textContent = `${Math.round(preferences.ambientVolume * 100)}%`;
  document.querySelector("#voiceVolumeValue").textContent = `${Math.round(preferences.voiceVolume * 100)}%`;
  settingsDialog.showModal();
});

document.querySelector("#settingsSave").addEventListener("click", () => {
  const previousAmbient = preferences.ambient;
  const previousBreath = preferences.breathPattern;
  const previousMotion = preferences.motion;
  const previousVoice = preferences.voice;
  preferences.motion = settingsDialog.querySelector('[name="motion"]:checked')?.value || "full";
  preferences.motionSet = true; // an explicit choice now outranks the OS default
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
    || previousBreath !== preferences.breathPattern
    || previousVoice !== preferences.voice;
  if (needsRender) render(false);
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
      if (greeting) greeting.textContent = `${greetingForNow()}.`;
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
updateSoundButton();
render(false);

// A sound session may already be running from another tab - reflect it.
ambientSend("get-state").then(state => {
  if (state?.active) {
    ambientState = state;
    updateSoundButton();
  }
});
