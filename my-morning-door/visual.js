(() => {
  const canvas = document.querySelector("#livingThreshold");
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let scene = "arrive";
  let sceneStarted = performance.now();
  let sceneDuration = 4000;
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
    const target = document.querySelector(".visual-region");
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
    ctx.globalAlpha = opacity;
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
    if (scene === "breath-hold-one") { scale = 1; ringAlpha = 0.92; }
    if (scene === "breath-out") { scale = 1 - ease(elapsed) * 0.22; ringAlpha = 0.92; }
    if (scene === "breath-hold-two" || scene === "breath-ready") { scale = 0.78; ringAlpha = 0.92; }

    if (scene === "complete" || scene === "resting") {
      scale = 0.72 + drift * 0.35;
      ringAlpha = scene === "resting" ? 0.58 : 0.68;
      pointMode = "rest";
    }

    return { scale, yOffset, scaleY, ringAlpha, pointMode };
  }

  function draw(now) {
    // ~30fps cap: skip alternate frames in animated modes. Still-mode frames
    // are rare and event-driven, so they always paint.
    if (motionMode() !== "still" && now - lastDrawAt < FRAME_MS) {
      scheduleNext();
      return;
    }
    lastDrawAt = now;

    const geo = geometry();
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    // Nothing to draw into: the layout has given the visual no room.
    if (!geo) { scheduleNext(); return; }
    const { x, y, r } = geo;

    if (scene.startsWith("ground")) {
      drawGrounding(x, y, r, now);
      scheduleNext();
      return;
    }

    if (scene.startsWith("release")) {
      drawRelease(x, y, r, now);
      scheduleNext();
      return;
    }

    const shape = sceneShape(now, r);
    const yy = y + shape.yOffset;
    const rr = r * shape.scale;

    ctx.save();
    ctx.globalCompositeOperation = blendMode();

    // The quiet welcome threshold carries the brand mark. The choice screen
    // returns to the concentric-circle language used across the practices.
    if (scene === "resting") {
      drawRestingDoor(x, yy, rr, now);
      ctx.restore();
      scheduleNext();
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
    scene = event.detail.scene || "arrive";
    sceneDuration = event.detail.duration || 4000;
    sceneStarted = performance.now();
    requestFrame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      sceneStarted = performance.now();
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
