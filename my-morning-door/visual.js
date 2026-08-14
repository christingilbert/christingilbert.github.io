(() => {
  const canvas = document.querySelector("#livingThreshold");
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let scene = "arrive";
  let sceneStarted = performance.now();
  let sceneDuration = 4000;
  let previousScene = null;
  // 0..1 progress of the scene fade, advanced only by frames that actually
  // paint (see draw) so a stalled main thread pauses the fade instead of
  // skipping most of it.
  let fadeProgress = 1;
  // The area the last frame actually drew into; each frame clears only the
  // union of this and the new area, so canvas damage stays away from the
  // glass panel (see draw).
  let dirtyBox = null;
  let raf = 0;
  let started = false;      // the loop begins only after the page has painted
  let lastDrawAt = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;

  // This ambience moves at drift speeds, so ~30fps is visually identical to
  // 60fps and halves the canvas cost (and the glass's re-blur cost above it).
  const FRAME_MS = 31;

  // In Still / reduced-motion the scene is a single static frame, so we render
  // once and stop the loop instead of repainting the same frame ~60fps forever.
  // A fresh frame is requested on scene change, resize, motion change and on
  // returning to the tab.
  const restingLogo = new Image();
  restingLogo.decoding = "async";
  restingLogo.onload = () => {
    readLogoInk();
    requestFrame();
  };
  // Resolved defensively: outside an extension `chrome` may exist while
  // `chrome.runtime` does not, and an unguarded call here throws before the
  // animation loop is ever set up.
  restingLogo.src = (() => {
    const path = "assets/brand/resting-logo.svg";
    try {
      if (globalThis.chrome?.runtime?.getURL) return chrome.runtime.getURL(path);
    } catch {
      // No extension runtime - fall through to the ordinary relative URL.
    }
    return new URL(path, document.baseURI).href;
  })();

  // The resting mark is a white SVG, which reads clearly over the dark
  // photographs but washes out over the light ones (desert, snow). Recolouring
  // it to --paper keeps it the same colour as the greeting sitting beneath it,
  // in every theme, without needing a second file.
  let logoInk = "#f4f1e8";
  let logoTint = null;
  let logoTintKey = "";

  // The welcome logo follows --paper so it stays readable over each photo.
  // Practice marks stay warm white across themes. On pale photos they composite
  // normally rather than with screen, so they keep their soft outline without
  // turning into a dark, stark graphic.
  let themeIsLight = false;
  const practiceInkRGB = [255, 253, 248];

  function readLogoInk() {
    const root = document.documentElement;
    const value = getComputedStyle(root).getPropertyValue("--paper").trim();
    themeIsLight = root.dataset.glassTheme === "light";
    if (value && value !== logoInk) {
      logoInk = value;
      logoTintKey = ""; // colour changed, so the cached mark is stale
    }
  }

  function ink(alpha) {
    return `rgba(${practiceInkRGB[0]},${practiceInkRGB[1]},${practiceInkRGB[2]},${alpha})`;
  }

  // Screen lightens; it cannot darken. Light themes must composite normally.
  function blendMode() {
    return themeIsLight ? "source-over" : "screen";
  }

  function tintedLogo(targetWidth) {
    // Bucketed so the breathing scale, which changes the width a little every
    // frame, does not rebuild the cache 30 times a second.
    const bucket = Math.max(64, Math.ceil(targetWidth / 64) * 64);
    const key = `${logoInk}|${bucket}`;
    if (logoTintKey === key && logoTint) return logoTint;

    const surface = logoTint || document.createElement("canvas");
    const ratio = restingLogo.naturalHeight / restingLogo.naturalWidth;
    surface.width = bucket;
    surface.height = Math.max(1, Math.round(bucket * ratio));

    const paint = surface.getContext("2d");
    paint.clearRect(0, 0, surface.width, surface.height);
    paint.drawImage(restingLogo, 0, 0, surface.width, surface.height);
    // Keep the mark's alpha, replace its colour.
    paint.globalCompositeOperation = "source-in";
    paint.fillStyle = logoInk;
    paint.fillRect(0, 0, surface.width, surface.height);
    paint.globalCompositeOperation = "source-over";

    logoTint = surface;
    logoTintKey = key;
    return logoTint;
  }

  // The theme follows the chosen background, so repaint the mark when it moves.
  new MutationObserver(() => {
    readLogoInk();
    requestFrame();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-glass-theme"],
  });
  readLogoInk();

  function scheduleNext() {
    if (motionMode() === "still") return;
    raf = requestAnimationFrame(draw);
  }

  function requestFrame() {
    if (!started) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  function measuredViewport() {
    const rootStyle = getComputedStyle(document.documentElement);
    const cssWidth = parseFloat(rootStyle.getPropertyValue("--viewport-width"));
    const cssHeight = parseFloat(rootStyle.getPropertyValue("--viewport-height"));
    const measuredWidth =
      Number.isFinite(cssWidth) && cssWidth > 0
        ? cssWidth
        : window.visualViewport?.width ?? document.documentElement.clientWidth ?? innerWidth;
    const measuredHeight =
      Number.isFinite(cssHeight) && cssHeight > 0
        ? cssHeight
        : window.visualViewport?.height ?? document.documentElement.clientHeight ?? innerHeight;

    return {
      width: Math.max(1, Math.floor(measuredWidth)),
      height: Math.max(1, Math.floor(measuredHeight)),
    };
  }

  function resize() {
    // A real viewport change moves everything at once; gliding there would
    // look like drifting, so the next frame snaps to the new anchor.
    geoCurrent = null;
    // Setting canvas.width below wipes the bitmap, so there is nothing left
    // to clear from the previous frame.
    dirtyBox = null;
    // 1.5× is indistinguishable for soft glows and rings, and much cheaper
    // than 2× on high-density displays.
    const viewport = measuredViewport();
    viewportWidth = viewport.width;
    viewportHeight = viewport.height;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(viewportWidth * ratio);
    canvas.height = Math.round(viewportHeight * ratio);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function motionMode() {
    // An explicit in-app choice (Preferences → Motion) outranks the system's
    // reduced-motion setting; the system setting is only the default.
    const chosen = document.documentElement.dataset.motion || "full";
    if (document.documentElement.dataset.motionExplicit === "1") return chosen;
    if (reduceMotion.matches) return "still";
    return chosen;
  }

  function geometry() {
    // During a whole-screen crossfade two anchors exist for a moment; the
    // incoming one is where the circle is heading, so measure that.
    const target = document.querySelector(".screen:not(.screen-crossfade-out) .visual-region")
      || document.querySelector(".visual-region");
    if (target) {
      const rect = target.getBoundingClientRect();
      const diameter = Math.min(rect.width, rect.height);
      // On short screens the arrival layout gives the visual its remaining
      // height, which can reach zero. A collapsed or hidden region reports a
      // 0x0 rect at the origin, so fall through rather than paint a speck in
      // the top-left corner.
      if (diameter > 8) {
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          r: diameter * 0.47,
        };
      }
      if (rect.width === 0 && rect.height === 0) return null;
    }

    return {
      x: viewportWidth / 2,
      y: viewportHeight / 2,
      r: Math.min(viewportWidth, viewportHeight) * 0.24,
    };
  }

  function ease(value) {
    const v = Math.max(0, Math.min(1, value));
    return v * v * (3 - 2 * v);
  }

  /* The anchor box changes size between layouts (the resting circle is
     smaller than the arrival one). Rather than snapping to the new box, the
     centre and radius glide toward it, so the circle reads as one object
     moving, not two objects swapping. */
  let geoCurrent = null;
  let geoLastTime = 0;

  function smoothedGeometry(now, hold = false) {
    const target = geometry();
    if (!target) {
      geoCurrent = null;
      return null;
    }
    if (motionMode() === "still" || !geoCurrent) {
      geoCurrent = target;
      geoLastTime = now;
      return geoCurrent;
    }
    if (hold) {
      // Keep the clock warm so releasing the hold resumes gently rather
      // than jumping by the whole held duration.
      geoLastTime = now;
      return geoCurrent;
    }
    const dt = Math.min(120, Math.max(0, now - geoLastTime));
    geoLastTime = now;
    const blend = 1 - Math.exp(-dt / 190);
    geoCurrent = {
      x: geoCurrent.x + (target.x - geoCurrent.x) * blend,
      y: geoCurrent.y + (target.y - geoCurrent.y) * blend,
      r: geoCurrent.r + (target.r - geoCurrent.r) * blend,
    };
    if (
      Math.abs(geoCurrent.x - target.x) < 0.5
      && Math.abs(geoCurrent.y - target.y) < 0.5
      && Math.abs(geoCurrent.r - target.r) < 0.5
    ) {
      geoCurrent = target;
    }
    return geoCurrent;
  }

  function ring(x, y, radius, alpha, width = 1, scaleY = 1) {
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * scaleY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ink(alpha);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function mobileVisualScale() {
    return viewportWidth <= 780 || viewportHeight <= 740 ? 0.64 : 1;
  }

  function glowPoint(x, y, radius = 4, alpha = 0.92) {
    const dotRadius = radius * mobileVisualScale();
    const glowRadius = dotRadius * (viewportWidth <= 780 ? 4.8 : 6);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, ink(Math.min(1, alpha + 0.08)));
    glow.addColorStop(0.22, ink(alpha * 0.78));
    glow.addColorStop(1, ink(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = ink(Math.max(0.72, alpha));
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.7, dotRadius * 0.58), 0, Math.PI * 2);
    ctx.fill();
  }

  function coreGlow(x, y, radius, alpha = 0.9) {
    const core = ctx.createRadialGradient(x, y, 0, x, y, radius * 4.5);
    core.addColorStop(0, ink(alpha));
    core.addColorStop(0.18, ink(alpha * 0.84));
    core.addColorStop(0.55, ink(alpha * 0.3));
    core.addColorStop(1, ink(0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, radius * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function groundLine(x, y, radius, alpha, width = 3.8) {
    const gradient = ctx.createLinearGradient(x - radius, y, x + radius, y);
    gradient.addColorStop(0, ink(0));
    gradient.addColorStop(0.5, ink(alpha));
    gradient.addColorStop(1, ink(0));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.stroke();
  }

  function soundWave(x, y, halfWidth, amplitude, alpha) {
    ctx.beginPath();
    const points = 90;
    for (let index = 0; index <= points; index += 1) {
      const unit = index / points;
      const px = x - halfWidth + unit * halfWidth * 2;
      const envelope = Math.sin(unit * Math.PI);
      const py = y + Math.sin(unit * Math.PI * 4) * amplitude * envelope;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = ink(alpha);
    ctx.lineWidth = 4.4;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawGrounding(x, y, r, now) {
    const mode = motionMode();
    const still = mode === "still";
    const elapsed = still ? 1 : ease((now - sceneStarted) / 3600);
    const t = still ? 0 : now / 1000;

    ctx.save();
    ctx.globalCompositeOperation = blendMode();
    ctx.lineCap = "round";

    if (scene === "ground-ready") {
      groundLine(x, y + r * 0.38, r * 0.76, 0.64, 4);
      const dotSpread = viewportWidth <= 780 ? 0.82 : 1;
      [[-0.52, -0.26], [0.06, -0.48], [0.56, 0.02]].forEach(([dx, dy], index) => {
        glowPoint(x + r * dx * dotSpread, y + r * dy * dotSpread, 4.8 + index * 0.35, 0.82);
      });
    }

    if (scene === "ground-1") {
      const dotSpread = viewportWidth <= 780 ? 0.82 : 1;
      const points = [[-0.52, -0.26], [0.06, -0.48], [0.56, 0.02]];
      points.forEach(([dx, dy], index) => {
        const reveal = still ? 1 : ease(Math.max(0, Math.min(1, elapsed * 1.7 - index * 0.34)));
        const float = still ? 0 : Math.sin(t * 0.42 + index * 1.8) * r * 0.012;
        glowPoint(x + r * dx * dotSpread, y + r * dy * dotSpread + float, 5.2 + index * 0.45, 0.36 + reveal * 0.62);
      });
    }

    if (scene === "ground-2") {
      const supportY = y + r * 0.34;
      groundLine(x, supportY, r * 0.84, 0.82, 4.2);
      [-0.29, 0.29].forEach((dx, index) => {
        const startY = y - r * (0.18 + index * 0.05);
        const pointY = startY + (supportY - startY) * elapsed;
        glowPoint(x + r * dx, pointY, 5.5, 0.98);
      });
    }

    if (scene === "ground-3") {
      const cycle = still ? 0.72 : ((now - sceneStarted) / 4400) % 1;
      const width = r * (0.18 + cycle * 0.68);
      const amplitude = r * (0.05 - cycle * 0.018);
      const alpha = 0.96 - cycle * 0.3;
      glowPoint(x, y, 4.8, 0.96);
      soundWave(x, y, width, amplitude, alpha);
    }

    ctx.restore();
  }

  function ribbonHalf(x, y, r, side, spread, yOffset, depth, alpha, width = 5.8) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.74 * spread, y - r * 0.18 + yOffset);
    ctx.bezierCurveTo(
      x + side * r * 0.5 * spread,
      y - r * 0.2 + yOffset,
      x + side * r * 0.25 * spread,
      y + r * depth + yOffset,
      x + side * r * 0.06,
      y + r * 0.18 + yOffset,
    );
    ctx.strokeStyle = ink(alpha);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function lowerRibbon(x, y, r, spread, yOffset, depth, alpha, width = 4.8) {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55 * spread, y + r * 0.27 + yOffset);
    ctx.quadraticCurveTo(x, y + r * depth + yOffset, x + r * 0.55 * spread, y + r * 0.27 + yOffset);
    ctx.strokeStyle = ink(alpha);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawRelease(x, y, r, now) {
    const mode = motionMode();
    const still = mode === "still";
    const progress = still ? 1 : ease((now - sceneStarted) / 3800);
    let spread = 0.94;
    let yOffset = 0;
    let depth = 0.08;
    let alpha = 0.82;

    if (scene === "release-ready") {
      spread = 0.9;
      alpha = 0.68;
    }
    if (scene === "release-support") yOffset = r * 0.07 * progress;
    if (scene === "release-feet") yOffset = r * 0.1;
    if (scene === "release-shoulders") {
      if (progress < 0.42) {
        yOffset = -r * 0.12 * ease(progress / 0.42);
      } else {
        yOffset = -r * 0.12 + r * 0.17 * ease((progress - 0.42) / 0.58);
      }
    }
    if (scene === "release-hands") {
      spread = 0.94 + progress * 0.16;
      yOffset = r * 0.04;
    }
    if (scene === "release-gaze") {
      spread = 0.96 + progress * 0.3;
      depth = 0.03;
      alpha = 0.76;
    }

    ctx.save();
    ctx.globalCompositeOperation = blendMode();
    // Glow from a wide low-alpha underlay stroke - visually equivalent to the
    // old shadowBlur, at a fraction of its per-frame cost.
    ribbonHalf(x, y, r, -1, spread, yOffset, depth, alpha * 0.16, 13);
    ribbonHalf(x, y, r, 1, spread, yOffset, depth, alpha * 0.16, 13);
    lowerRibbon(x, y, r, spread, yOffset, 0.39 - progress * 0.035, alpha * 0.12, 11);
    ribbonHalf(x, y, r, -1, spread, yOffset, depth, alpha);
    ribbonHalf(x, y, r, 1, spread, yOffset, depth, alpha);
    lowerRibbon(x, y, r, spread, yOffset, 0.39 - progress * 0.035, alpha * 0.76);

    if (scene === "release-feet") {
      const supportY = y + r * 0.48;
      groundLine(x, supportY, r * 0.9, 0.78, 4.2);
      glowPoint(x - r * 0.26, supportY, 5.4, 0.98);
      glowPoint(x + r * 0.26, supportY, 5.4, 0.98);
    }
    if (scene === "release-hands") {
      glowPoint(x - r * 0.76 * spread, y + yOffset, 4.8, 0.92);
      glowPoint(x + r * 0.76 * spread, y + yOffset, 4.8, 0.92);
    }
    if (scene === "release-gaze") {
      glowPoint(x - r * 0.82 * spread, y, 4.6, 0.88);
      glowPoint(x + r * 0.82 * spread, y, 4.6, 0.88);
    }
    ctx.restore();
  }

  function drawRestingDoor(x, y, r, now) {
    if (!restingLogo.complete || !restingLogo.naturalWidth) return;

    const mode = motionMode();
    const motionStrength = mode === "still" ? 0 : mode === "gentle" ? 0.55 : 1;
    const wave = Math.sin((now / 1000) * 0.42);
    const scale = 1 + wave * 0.012 * motionStrength;
    const yDrift = wave * r * 0.008 * motionStrength;
    const opacity = 0.8 + wave * 0.035 * motionStrength;
    const width = r * 1.72 * scale;
    const height = width * (restingLogo.naturalHeight / restingLogo.naturalWidth);
    const mark = tintedLogo(width * (devicePixelRatio > 1 ? 1.5 : 1));
    ctx.save();
    // MULTIPLY, never assign: paintScene has already applied the scene
    // crossfade to globalAlpha, and assigning here discarded it - which is
    // why the door mark popped instead of fading on every home transition.
    ctx.globalAlpha *= opacity;
    ctx.drawImage(mark, x - width / 2, y + yDrift - height / 2, width, height);
    ctx.restore();
  }

  function sceneShape(now, baseR) {
    const mode = motionMode();
    const still = mode === "still";
    const gentle = mode === "gentle";
    const t = still ? 0 : now / 1000;
    const elapsed = still ? 1 : Math.min((now - sceneStarted) / sceneDuration, 1);
    const drift = Math.sin(t * 0.46) * (gentle ? 0.008 : 0.018);
    let scale = 1 + drift;
    let yOffset = 0;
    let scaleY = 1;
    let ringAlpha = 0.78;
    let pointMode = "orbit";

    if (scene === "breath-in") { scale = 0.78 + ease(elapsed) * 0.22; ringAlpha = 0.92; }
    if (scene === "breath-hold-one") {
      // Return to the exact phase boundary at both ends, with a small living
      // movement in between so a pause feels settled rather than frozen.
      scale = 1 - Math.sin(Math.PI * elapsed) * 0.006;
      ringAlpha = 0.92;
    }
    if (scene === "breath-out") { scale = 1 - ease(elapsed) * 0.22; ringAlpha = 0.92; }
    if (scene === "breath-hold-two") {
      scale = 0.78 + Math.sin(Math.PI * elapsed) * 0.006;
      ringAlpha = 0.92;
    }
    if (scene === "breath-ready") { scale = 0.78; ringAlpha = 0.92; }

    if (scene === "complete" || scene === "resting") {
      scale = 0.72 + drift * 0.35;
      ringAlpha = scene === "resting" ? 0.58 : 0.68;
      pointMode = "rest";
    }

    return { scale, yOffset, scaleY, ringAlpha, pointMode };
  }

  // The concentric-ring scenes are one drawing at different sizes. During a
  // transition between two of them, both are pinned to a single blended
  // scale, so the fade reads as one circle changing size - never two circles
  // of different sizes stacked on each other.
  function circleFamily(name) {
    return name === "arrive" || name === "complete" || name.startsWith("breath");
  }

  let lastCircleScale = 1;
  let morphFromScale = null;
  // Alpha the current scene is painted at (1 outside a fade). When a fade is
  // interrupted, the next one starts from here instead of popping to solid.
  let incomingAlpha = 1;
  let outgoingAlphaStart = 1;

  function paintScene(targetScene, now, geo, alpha = 1, scaleOverride = null) {
    const savedScene = scene;
    scene = targetScene;
    const { x, y, r } = geo;

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));

    if (scene.startsWith("ground")) {
      drawGrounding(x, y, r, now);
      ctx.restore();
      scene = savedScene;
      return;
    }

    if (scene.startsWith("release")) {
      drawRelease(x, y, r, now);
      ctx.restore();
      scene = savedScene;
      return;
    }

    const shape = sceneShape(now, r);
    if (scaleOverride !== null) shape.scale = scaleOverride;
    if (circleFamily(scene)) lastCircleScale = shape.scale;
    const yy = y + shape.yOffset;
    const rr = r * shape.scale;

    ctx.save();
    ctx.globalCompositeOperation = blendMode();

    // The quiet welcome threshold carries the brand mark. The choice screen
    // returns to the concentric-circle language used across the practices.
    if (scene === "resting") {
      drawRestingDoor(x, yy, rr, now);
      ctx.restore();
      ctx.restore();
      scene = savedScene;
      return;
    }

    ring(x, yy, rr, shape.ringAlpha, 6.4, shape.scaleY);
    ring(x, yy, rr * 0.72, Math.min(0.98, shape.ringAlpha + 0.06), 5.8, shape.scaleY);
    ring(x, yy, rr * 0.43, Math.min(1, shape.ringAlpha + 0.08), 5.2, shape.scaleY);
    coreGlow(x, yy, rr * 0.1, scene === "resting" ? 0.72 : scene === "complete" ? 0.82 : 0.98);

    if (shape.pointMode !== "rest") {
      const t = motionMode() === "still" ? 0 : now / 1000;
      glowPoint(x + Math.cos(t * 0.18) * rr * 0.73, yy + Math.sin(t * 0.18) * rr * 0.73, 4.8, 0.98);
      // During breathing the circle owns the screen - one drifting point only.
      // Elsewhere a second point counter-drifts directly on the inner ring so
      // it always reads as part of the visual system.
      if (!scene.startsWith("breath")) {
        glowPoint(
          x + Math.cos(-t * 0.13 + 2.4) * rr * 0.43,
          yy + Math.sin(-t * 0.13 + 2.4) * rr * 0.43,
          4.3,
          0.9,
        );
      }
    }

    ctx.restore();
    ctx.restore();
    scene = savedScene;
  }

  function draw(now) {
    // ~30fps cap: skip alternate frames in animated modes. Still-mode frames
    // are rare and event-driven, so they always paint. (An earlier build
    // dropped to ~20fps during DOM dissolves to spare the glass re-blur;
    // the dirty-box clearing below made that unnecessary, and 20fps
    // visibly stepped the big door mark's fade.)
    if (motionMode() !== "still" && now - lastDrawAt < FRAME_MS) {
      scheduleNext();
      return;
    }
    // Fades advance by PAINTED time, not wall-clock time: if the page stalls
    // (a click rebuilding the screen can block it for hundreds of ms), a
    // wall-clock fade is already mostly over when the next frame appears -
    // the door mark popping in on the v0.25.14 recording was exactly this.
    // Advancing per painted frame makes a stall pause the fade instead.
    // lastDrawAt === 0 marks "no previous painted frame" (startup, or just
    // returned to the tab): that frame credits no painted time at all.
    const paintedDt = lastDrawAt === 0 ? 0 : Math.min(Math.max(now - lastDrawAt, 0), 70);
    lastDrawAt = now;

    // The door must not wander while it slips away: during the exit beat of
    // the door opening (fadeProgress below the 0.32 EXIT split), the anchor
    // glide is paused so the mark fades out exactly where it stood. The
    // rings do the travelling once the door has gone.
    const holdForDoorExit = previousScene === "resting" && motionMode() !== "still" && fadeProgress < 0.32;
    const geo = smoothedGeometry(now, holdForDoorExit);
    // Nothing to draw into: the layout has given the visual no room. Clear
    // whatever was drawn last and stand down.
    if (!geo) {
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
      dirtyBox = null;
      scheduleNext();
      return;
    }

    // Clear - and therefore damage - only the neighbourhood of the drawing,
    // never the full viewport. The glass panel re-blurs whenever anything
    // beneath it changes, so a full-canvas clear billed the panel's blur on
    // every frame of idle drift. Keeping the damage inside the circle's
    // corner of the screen is what lets an expensive blur and a living
    // canvas coexist at full frame rate. The margin covers the widest
    // drawing (release-gaze points at ~1.03r plus a ~33px glow).
    const pad = geo.r * 1.35 + 40;
    const nextBox = {
      left: geo.x - pad,
      top: geo.y - pad,
      right: geo.x + pad,
      bottom: geo.y + pad,
    };
    if (dirtyBox) {
      const left = Math.min(dirtyBox.left, nextBox.left);
      const top = Math.min(dirtyBox.top, nextBox.top);
      ctx.clearRect(
        left,
        top,
        Math.max(dirtyBox.right, nextBox.right) - left,
        Math.max(dirtyBox.bottom, nextBox.bottom) - top,
      );
    } else {
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    }
    dirtyBox = nextBox;

    // Ring-to-ring morphs are quick because the shape barely changes;
    // fades between different drawings take longer so nothing pops; and the
    // door sequence is the slowest of all - it is the threshold moment, and
    // Christin asked for it unhurried. The door has two speeds: opening into
    // the flow keeps a light step, while closing back to rest is the
    // wind-down, so the rings take longer to gather and the mark settles
    // later still.
    const sameCircle = previousScene && circleFamily(previousScene) && circleFamily(scene);
    const doorSide = previousScene && (previousScene === "resting" || scene === "resting");
    const doorClosing = previousScene && scene === "resting";
    const crossfadeMs = doorClosing ? 2000 : doorSide ? 1250 : sameCircle ? 620 : 900;
    let crossfade = 1;
    if (previousScene && motionMode() !== "still") {
      fadeProgress = Math.min(1, fadeProgress + paintedDt / crossfadeMs);
      crossfade = fadeProgress;
    }

    if (previousScene && crossfade < 1) {
      if (previousScene === "resting" || scene === "resting") {
        // The door opens. The door mark and the rings are too different to
        // stack - a crossfade of the two always reads as a double exposure -
        // so they take turns: the outgoing mark slips away first, then the
        // incoming one blooms from the door's own circle edge (scale 0.62,
        // the drawn logo's outer radius). Leaving is quick; arriving is
        // gentle. One mark on screen at any moment. When the door is
        // closing, the rings get a longer share of the time to gather.
        const EXIT = scene === "resting" ? 0.4 : 0.32;
        const DOOR_SCALE = 0.62;
        if (crossfade < EXIT) {
          const exit = ease(crossfade / EXIT);
          let outScale = null;
          if (circleFamily(previousScene) && morphFromScale !== null) {
            // Rings gather back toward the door's edge as they go.
            outScale = morphFromScale + (DOOR_SCALE - morphFromScale) * exit;
          }
          paintScene(previousScene, now, geo, outgoingAlphaStart * (1 - exit), outScale);
          incomingAlpha = 0;
        } else {
          const enter = ease((crossfade - EXIT) / (1 - EXIT));
          let inScale = null;
          if (circleFamily(scene)) {
            const target = sceneShape(now).scale;
            inScale = DOOR_SCALE + (target - DOOR_SCALE) * enter;
          }
          paintScene(scene, now, geo, enter, inScale);
          incomingAlpha = enter;
        }
        scheduleNext();
        return;
      }
      let scaleOverride = null;
      if (sameCircle && morphFromScale !== null) {
        const target = sceneShape(now).scale;
        scaleOverride = morphFromScale + (target - morphFromScale) * ease(crossfade);
      }
      const fadeIn = ease(crossfade);
      paintScene(previousScene, now, geo, outgoingAlphaStart * (1 - fadeIn), scaleOverride);
      paintScene(scene, now, geo, fadeIn, scaleOverride);
      incomingAlpha = fadeIn;
    } else {
      previousScene = null;
      morphFromScale = null;
      paintScene(scene, now, geo, 1);
      incomingAlpha = 1;
    }

    scheduleNext();
  }

  window.addEventListener("resize", () => {
    resize();
    requestFrame();
  });
  window.addEventListener("morningdoor:viewport", () => {
    resize();
    requestFrame();
  });
  window.visualViewport?.addEventListener("resize", () => {
    resize();
    requestFrame();
  });
  window.visualViewport?.addEventListener("scroll", () => {
    resize();
    requestFrame();
	  });
	  window.addEventListener("morningdoor:scene", event => {
	    const nextScene = event.detail.scene || "arrive";
	    // Re-announcing the scene already on screen (a re-render that changed
	    // only the copy) must not restart reveals or snap an in-flight fade.
	    if (nextScene === scene) {
	      if (event.detail.duration) sceneDuration = event.detail.duration;
	      requestFrame();
	      return;
	    }
	    if (event.detail.crossfade !== false && motionMode() !== "still") {
	      if (nextScene === previousScene) {
	        // Reversal mid-fade (into a practice, straight back out): run the
	        // same fade backwards from exactly where it is. ease() is
	        // smoothstep, so ease(1-p) = 1-ease(p) and both layers continue
	        // without a jump.
	        previousScene = scene;
	        scene = nextScene;
	        fadeProgress = 1 - fadeProgress;
	        outgoingAlphaStart = 1;
	        morphFromScale = circleFamily(scene) && circleFamily(previousScene) ? lastCircleScale : null;
	        sceneDuration = event.detail.duration || 4000;
	        sceneStarted = performance.now();
	        requestFrame();
	        return;
	      }
	      // Start the new fade from wherever the circle actually is right now,
	      // in both size and opacity, including partway through an interrupted
	      // transition. The scale is captured whenever the OUTGOING side is a
	      // ring drawing: ring-to-ring morphs blend it toward the next scene,
	      // and the door transition uses it to gather the rings back to the
	      // door's edge.
	      outgoingAlphaStart = incomingAlpha;
	      previousScene = scene;
	      fadeProgress = 0;
	      morphFromScale = circleFamily(scene) ? lastCircleScale : null;
	    } else {
      previousScene = null;
      morphFromScale = null;
    }
    scene = nextScene;
    sceneDuration = event.detail.duration || 4000;
    sceneStarted = performance.now();
    requestFrame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      sceneStarted = performance.now();
      // The gap while hidden must not count as painted time.
      lastDrawAt = 0;
      requestFrame();
    }
  });

  reduceMotion.addEventListener?.("change", requestFrame);

  resize();
  // Let the page paint before the canvas starts: the open feels instant, and
  // the threshold fading in reads as the intended gradual reveal.
  canvas.style.opacity = "0";
  setTimeout(() => {
    started = true;
    canvas.style.transition = "opacity 900ms ease";
    canvas.style.opacity = "1";
    requestFrame();
  }, 250);
})();
