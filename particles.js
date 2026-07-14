/*
 * particles.js — a small success-confirmation burst, tuned to Plum & Silk.
 * A vanilla-JS reinterpretation of a React "particle button": no dependencies,
 * no build step. It fires once, on a genuinely completed action (a sent
 * message), from the button that completed it — feedback, not decoration.
 * Honours prefers-reduced-motion. Remove this one file and the <script> tags
 * that load it to fully revert.
 */
(function () {
  var COLORS = ['#6E4658', '#D98C95']; /* mauve accent + rose, the only chromatic pair in the system */

  var style = document.createElement('style');
  style.textContent =
    '.cg-particle{position:fixed;width:5px;height:5px;border-radius:999px;pointer-events:none;z-index:99999;will-change:transform,opacity}';
  document.head.appendChild(style);

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function burst(el) {
    if (!el || reduced() || typeof el.animate !== 'function') return;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var N = 10;
    for (var i = 0; i < N; i++) {
      var p = document.createElement('span');
      p.className = 'cg-particle';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = COLORS[i % COLORS.length];
      document.body.appendChild(p);

      var angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      var dist = 26 + Math.random() * 44;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - 8; /* slight upward bias */

      p.animate(
        [
          { transform: 'translate(-50%,-50%) scale(0)', opacity: 1 },
          {
            transform:
              'translate(calc(-50% + ' + dx.toFixed(1) + 'px),calc(-50% + ' + dy.toFixed(1) + 'px)) scale(1)',
            opacity: 1,
            offset: 0.6
          },
          {
            transform:
              'translate(calc(-50% + ' +
              (dx * 1.15).toFixed(1) +
              'px),calc(-50% + ' +
              (dy * 1.15).toFixed(1) +
              'px)) scale(0)',
            opacity: 0
          }
        ],
        { duration: 700, delay: i * 25, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' }
      );

      (function (node) {
        setTimeout(function () {
          node.remove();
        }, 1000);
      })(p);
    }

    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.96)', offset: 0.3 }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'ease-out' }
    );
  }

  /* The contact form's own submit handler calls this on a successful send:
     window.cgBurst(theSubmitButton). Kept as a plain global so no framework or
     wiring is needed and any element can be passed. */
  window.cgBurst = burst;
})();
