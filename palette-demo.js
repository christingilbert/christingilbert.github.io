/* Palette as a system: a small demonstration on the design-system page.
   Plum & Linen is described as tokens; this rebuilds the family at any hue on
   the slider, with the lightness of every token held, and shows the contrast
   of the main pairings live. Nothing here changes the page itself. */
(function () {
  var root = document.getElementById('palette-demo');
  if (!root) return;

  var DEFAULT_HUE = 351;
  var ARC_START = 220, ARC_LENGTH = 275;         /* Sky through Plum to Sage; the cold greens are left out */
  var HUE_NAMES = [[0, 'Plum'], [12, 'Rose'], [22, 'Terracotta'], [44, 'Burnt orange'], [66, 'Ochre'], [92, 'Olive'], [120, 'Sage'], [215, 'Sky'], [250, 'Blue'], [285, 'Violet'], [320, 'Orchid'], [342, 'Plum']];
  var PLUM = { bg: '#FFFDFA', linen: '#FAF3EF', surface: '#E4DDE3', faint: '#CBB4C3', tint2: '#E6DAE3', tint3: '#C0A5B8', accent: '#6E4658', deep: '#523544', ink: '#1A1423', onbar: '#FAF3EF' };

  function hueToPos(h) { var v = ((h - ARC_START) % 360 + 360) % 360; return Math.min(v, ARC_LENGTH); }
  function posToHue(v) { return (ARC_START + v) % 360; }
  function hueName(h) { var n = 'Plum'; for (var i = 0; i < HUE_NAMES.length; i++) if (h >= HUE_NAMES[i][0]) n = HUE_NAMES[i][1]; return n; }
  function warmth(h) { var d = Math.abs(((h - 38) % 360 + 540) % 360 - 180); return 1 + 0.95 * Math.max(0, Math.cos(Math.min(d, 60) * Math.PI / 120)); }

  function oklchToRgb(L, C, h) {
    var a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    function gam(c) { c = Math.max(0, Math.min(1, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
    return [gam(r), gam(g), gam(bb)];
  }
  function hex(rgb) { return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase(); }
  function lum(hx) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hx.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

  /* the family at a hue: one colour, in light, medium and deep versions, on a warm linen ground */
  function family(h) {
    if (h === DEFAULT_HUE) return PLUM;
    var w = warmth(h), t = 1 + (w - 1) * 0.5;
    var GROUND = 72, g = (h - GROUND + 540) % 360 - 180, gh = GROUND + g * 0.25;
    var c = function (L, C, hh) { return hex(oklchToRgb(L, C, hh)); };
    return {
      bg: c(0.980, 0.008, gh), linen: c(0.950, 0.014, gh), surface: c(0.900, 0.020, gh),
      faint: c(0.800, 0.026 * t, h - 10), tint2: c(0.905, 0.022 * t, h - 12), tint3: c(0.780, 0.036 * t, h - 10),
      accent: c(0.430, 0.062 * w, h), deep: c(0.340, 0.048 * w, h - 4), ink: c(0.220, 0.028, h - 45), onbar: c(0.960, 0.012, gh)
    };
  }

  /* ---------- build ---------- */
  var hue = DEFAULT_HUE;
  try { var q = new URLSearchParams(location.search).get('hue'); if (q !== null && !isNaN(+q)) { hue = ((Math.round(+q) % 360) + 360) % 360; if (hue > 135 && hue < 220) hue = hue < 178 ? 135 : 220; } } catch (e) {}

  root.innerHTML =
    '<div class="pal-controls">' +
    '  <label class="pal-hue"><span class="pal-name" aria-live="polite">Plum &amp; Linen</span><input type="range" min="0" max="' + ARC_LENGTH + '" step="1" aria-label="Hue"></label>' +
    '  <button type="button" class="mo-replay pal-reset" hidden>Back to plum</button>' +
    '</div>' +
    '<div class="pp" aria-hidden="true">' +
    '  <div class="pp-bar"><span class="pp-brand">Christin Gilbert</span><span class="pp-cta">Work with me</span></div>' +
    '  <div class="pp-body">' +
    '    <span class="pp-label">Selected work</span>' +
    '    <div class="pp-h">Making digital experiences more cognitively accessible</div>' +
    '    <p class="pp-p">Body copy in the ink, with <span class="pp-link">a link in the accent</span> and a button below.</p>' +
    '    <span class="pp-btn">View selected work</span>' +
    '  </div>' +
    '  <div class="pp-band"><div class="pp-card"><span class="pp-label">Card</span><div class="pp-h2">A card on the soft band</div><p class="pp-p">Framed in the faint tone.</p></div></div>' +
    '</div>' +
    '<div class="swatches pal-swatches"></div>' +
    '<div class="mo-scroll"><table class="pal-table"><thead><tr><th>Foreground</th><th>Background</th><th>Ratio</th><th>Result</th></tr></thead><tbody></tbody></table></div>';

  var range = root.querySelector('input[type=range]');
  var nameEl = root.querySelector('.pal-name');
  var reset = root.querySelector('.pal-reset');
  var pp = root.querySelector('.pp');
  var swatches = root.querySelector('.pal-swatches');
  var tbody = root.querySelector('tbody');

  var stops = [];
  for (var v = 0; v <= ARC_LENGTH; v += 25) { var hh = posToHue(v); stops.push(hex(oklchToRgb(0.62, 0.06 * warmth(hh), hh)) + ' ' + Math.round(v * 100 / ARC_LENGTH) + '%'); }
  range.style.setProperty('--pal-track', 'linear-gradient(90deg,' + stops.join(',') + ')');

  var SWATCH = [['bg', 'Ground', '--bg'], ['tint2', 'Band', '--tint-2'], ['tint3', 'Band, deep', '--tint-3'], ['accent', 'Accent', '--accent'], ['deep', 'Deep', '--bar'], ['ink', 'Ink', '--dark']];
  var PAIRS = [['ink', 'bg', 'Ink', 'Ground'], ['accent', 'bg', 'Accent · links and labels', 'Ground'], ['onbar', 'accent', 'Linen label', 'Accent button'], ['onbar', 'deep', 'Linen text', 'Deep band'], ['accent', 'tint2', 'Accent · eyebrows', 'Soft band']];

  function render() {
    var f = family(hue);
    pp.style.setProperty('--pp-bg', f.bg); pp.style.setProperty('--pp-linen', f.linen); pp.style.setProperty('--pp-surface', f.surface);
    pp.style.setProperty('--pp-faint', f.faint); pp.style.setProperty('--pp-t2', f.tint2); pp.style.setProperty('--pp-t3', f.tint3);
    pp.style.setProperty('--pp-accent', f.accent); pp.style.setProperty('--pp-deep', f.deep); pp.style.setProperty('--pp-ink', f.ink); pp.style.setProperty('--pp-onbar', f.onbar);
    range.style.setProperty('--pal-thumb', f.accent);
    range.value = hueToPos(hue);
    range.setAttribute('aria-valuetext', hue === DEFAULT_HUE ? 'Plum' : hueName(hue));
    nameEl.textContent = hue === DEFAULT_HUE ? 'Plum & Linen' : hueName(hue) + ' & Linen';
    reset.hidden = hue === DEFAULT_HUE;
    var sw = '';
    SWATCH.forEach(function (s) {
      var col = f[s[0]], txt = ratio(f.ink, col) >= ratio(f.onbar, col) ? f.ink : f.onbar;
      sw += '<div class="swatch"><div class="chip" style="background:' + col + ';color:' + txt + '">Aa</div><div class="meta"><div class="nm">' + s[1] + '</div><div class="hex">' + col + '</div><div class="use"><code class="inl">' + s[2] + '</code></div></div></div>';
    });
    swatches.innerHTML = sw;
    var rows = '';
    PAIRS.forEach(function (p) {
      var r = ratio(f[p[0]], f[p[1]]), ok = r >= 4.5;
      rows += '<tr><td>' + p[2] + '</td><td>' + p[3] + '</td><td class="ratio">' + r.toFixed(1) + ':1</td><td><span class="badge' + (ok ? '' : ' badge--warn') + '">' + (ok ? 'AA' : 'Below 4.5') + '</span></td></tr>';
    });
    tbody.innerHTML = rows;
  }
  range.addEventListener('input', function () { hue = posToHue(+range.value); render(); });
  reset.addEventListener('click', function () { hue = DEFAULT_HUE; render(); range.focus(); });
  render();
})();
