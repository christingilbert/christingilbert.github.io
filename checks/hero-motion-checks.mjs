import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(site, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
for (const script of scripts) new vm.Script(script);
const source = scripts.find(script => script.includes('/* Hero illustration: draws the rays'));
assert.ok(source, 'Homepage hero controller exists');
assert.ok(html.includes('hero-place-surface'), 'Direct point placement is present');
assert.ok(!html.includes('id="curve-editor"'), 'Numeric editor no longer interrupts the page');

function harness({ reduced = false, paused = false, blockedStorage = false } = {}) {
  const ids = new Map();
  const frames = new Map();
  const timers = new Map();
  const observers = [];
  let nextId = 0;
  let now = 0;
  let document;
  function element(name, rect = { left: 0, top: 0, width: 0, height: 0 }) {
    const attributes = new Map();
    const classes = new Set(name.split(' '));
    const events = new Map();
    const singles = new Map();
    const multiples = new Map();
    const children = [];
    const el = {
      name, attributes, events, singles, multiples, children,
      style: { setProperty(key, value) { this[key] = value; } },
      hidden: false, value: '', textContent: '', parentElement: null,
      clientWidth: rect.width, clientHeight: rect.height,
      offsetWidth: rect.width, offsetHeight: rect.height,
      offsetLeft: rect.left, offsetTop: rect.top,
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const present = force === undefined ? !classes.has(name) : force; if (present) classes.add(name); else classes.delete(name); return present; }
      },
      setAttribute(key, value) { attributes.set(key, String(value)); },
      getAttribute(key) { return attributes.has(key) ? attributes.get(key) : null; },
      removeAttribute(key) { attributes.delete(key); },
      addEventListener(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); },
      dispatch(type, detail = {}) {
        const event = { target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...detail };
        for (const callback of events.get(type) || []) callback(event);
        return event;
      },
      focus(options) { document.activeElement = el; el.focusOptions = options; },
      contains(other) { return other === el || children.some(child => child.contains(other)); },
      querySelector(selector) {
        if (singles.has(selector)) return singles.get(selector);
        if (selector.startsWith('#')) return ids.get(selector.slice(1)) || null;
        return null;
      },
      querySelectorAll(selector) { return multiples.get(selector) || (singles.has(selector) ? [singles.get(selector)] : []); },
      getBoundingClientRect() { return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }; },
      getClientRects() { return rect.width && rect.height ? [el.getBoundingClientRect()] : []; },
      scrollIntoView() {}, setPointerCapture() {}, releasePointerCapture() {},
      checkValidity() { const number = Number(el.value); return el.value !== '' && Number.isFinite(number) && number >= 0 && number <= 100; },
      reportValidity() { return el.checkValidity(); }
    };
    Object.defineProperty(el, 'valueAsNumber', { get() { return el.value === '' ? NaN : Number(el.value); }, set(value) { el.value = String(value); } });
    el.add = (selector, child) => { singles.set(selector, child); children.push(child); child.parentElement = el; return child; };
    el.addMany = (selector, list) => { multiples.set(selector, list); for (const child of list) { children.push(child); child.parentElement = el; } return list; };
    return el;
  }
  function byId(id, el) { ids.set(id, el); el.setAttribute('id', id); return el; }
  const root = element('root', { left: 0, top: 0, width: 1440, height: 900 });
  const hero = element('hero', { left: 0, top: 0, width: 1440, height: 900 });
  const art = hero.add('.hero-art', element('hero-art', { left: 0, top: 0, width: 1440, height: 900 }));
  const rays = art.add('.art-rays', element('art-rays'));
  const curve = rays.add('.art-curve', element('art-curve'));
  rays.add('circle', element('circle'));
  rays.addMany('line', [element('line'), element('line')]);
  art.add('.art-M', element('art-M', { left: 850, top: 200, width: 300, height: 300 }));
  art.add('.art-R', element('art-R', { left: 1300, top: 650, width: 500, height: 500 }));
  art.add('.art-ripple', element('art-ripple'));
  const light = hero.add('.art-light', element('art-light'));
  const play = hero.add('.hero-play', element('hero-play'));
  play.addMany('.play-arm', [element('play-arm'), element('play-arm')]);
  play.addMany('.play-anchor', [element('play-anchor'), element('play-anchor')]);
  const knobs = play.addMany('.play-knob', [element('play-knob'), element('play-knob')]);
  play.add('.play-hint', element('play-hint', { left: 0, top: 0, width: 150, height: 34 }));
  const motion = hero.add('.hero-motion-toggle', element('hero-motion-toggle'));
  const motionLabel = motion.add('.hero-motion-label', element('hero-motion-label'));
  const reset = hero.add('.hero-curve-reset', element('hero-curve-reset')); reset.hidden = true;
  const surface = hero.add('.hero-place-surface', element('hero-place-surface')); surface.hidden = true;
  const guide = hero.add('.hero-path-guide', element('hero-path-guide'));
  const instruction = guide.add('.hero-path-instruction', element('hero-path-instruction'));
  const cancel = guide.add('.hero-place-cancel', element('hero-place-cancel')); cancel.hidden = true;
  hero.singles.set('.hero-path-instruction', instruction);
  hero.singles.set('.hero-place-cancel', cancel);
  for (const [selector, top, height] of [['.hero-eyebrow', 200, 20], ['.hero-name', 240, 100], ['.hero-tagline', 380, 150], ['.hero-cta a', 570, 50]]) {
    hero.add(selector, element(selector.slice(1), { left: 72, top, width: 550, height }));
  }
  const status = byId('hero-curve-status', element('hero-curve-status'));
  curve.getTotalLength = () => 640;
  curve.getPointAtLength = length => ({ x: 850 + length * 450 / 640, y: 200 + length * 450 / 640 });
  const nav = element('nav', { left: 24, top: 13, width: 1392, height: 60 });
  const media = element('media'); media.matches = reduced;
  const widthMedia = element('width-media'); widthMedia.matches = false;
  const documentEvents = new Map();
  document = {
    documentElement: root, activeElement: null, hidden: false,
    querySelector(selector) { if (selector === '.hero') return hero; if (selector === 'nav') return nav; return null; },
    getElementById(id) { return ids.get(id) || null; },
    createRange() { let selected; return { selectNodeContents(el) { selected = el; }, getClientRects() { return selected.getClientRects(); } }; },
    addEventListener(type, callback) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(callback); },
    dispatch(type, detail = {}) {
      const event = { target:document.activeElement, defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, ...detail };
      for (const callback of documentEvents.get(type) || []) callback(event);
      return event;
    }
  };
  const saved = new Map([['cg-point-hint', 'seen'], ['cg-hero-motion', paused ? 'paused' : 'playing']]);
  const context = {
    document,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Blocked storage'); return saved.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Blocked storage'); saved.set(key, value); }
    },
    getComputedStyle(el) {
      return {
        display: el.hidden || (el === motion && (media.matches || root.classList.contains('reading-focus'))) || ((el === play || el === curve || el === guide || el === surface || el === cancel || el === reset) && (root.classList.contains('reading-focus') || widthMedia.matches)) ? 'none' : (el.style.display || 'block'),
        position: el === nav ? 'fixed' : 'static', visibility: 'visible'
      };
    },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay = 0) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class { constructor(callback) { this.kind = 'resize'; this.callback = callback; observers.push(this); } observe() {} },
    MutationObserver: class { constructor(callback) { this.kind = 'mutation'; this.callback = callback; observers.push(this); } observe() {} },
    IntersectionObserver: class { constructor(callback) { this.kind = 'intersection'; this.callback = callback; observers.push(this); } observe() {} },
    Set, Math
  };
  context.window = context;
  context.window.pageYOffset = 0;
  context.window.matchMedia = query => query.includes('prefers-reduced-motion') ? media : widthMedia;
  context.window.addEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(source, context);
  function frame(time = now + 16) { now = time; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(now); }
  function advance(milliseconds) {
    now += milliseconds;
    let due;
    while ((due = [...timers].find(([, timer]) => timer.at <= now))) { timers.delete(due[0]); due[1].callback(); }
  }
  function position(index) {
    const numbers = knobs[index].style.transform.match(/[-\d.]+/g).map(Number);
    return { x: numbers[0], y: numbers[1] };
  }
  return { document, root, hero, art, curve, light, play, knobs, motion, motionLabel, reset, surface, guide, instruction, cancel, status, media, widthMedia, frames, saved, advance, frame, position,
    choose(index) { knobs[index].focus(); knobs[index].dispatch('click', {detail:1}); },
    reduce(value) { media.matches = value; media.dispatch('change', { matches: value }); },
    notifyResize() { observers.filter(observer => observer.kind === 'resize').forEach(observer => observer.callback()); },
    notifyMutations() { observers.filter(observer => observer.kind === 'mutation').forEach(observer => observer.callback()); }
  };
}

const checks = [];
const placed = harness({ paused:true });
const original = placed.position(1);
placed.choose(1);
assert.equal(placed.hero.classList.contains('is-placing'), true, 'Choosing a point enters explicit placement mode');
assert.equal(placed.surface.hidden, false, 'The artwork accepts a one-shot placement click');
assert.equal(placed.cancel.hidden, false, 'Cancel remains available during placement');
assert.equal(placed.knobs[1].getAttribute('aria-pressed'), 'true', 'The selected point is exposed');
placed.surface.dispatch('click', {detail:0, clientX:0, clientY:0});
assert.deepEqual(placed.position(1), original, 'Synthetic keyboard clicks cannot move a point to zero coordinates');
assert.equal(placed.surface.hidden, false, 'Ignoring a synthetic click preserves the intended next action');
placed.surface.dispatch('click', {detail:1, clientX:600, clientY:400});
assert.deepEqual(placed.position(1), {x:600,y:400}, 'The click moves the chosen point immediately to its requested position');
assert.equal(placed.surface.hidden, true, 'A completed placement exits the mode immediately');
assert.equal(placed.hero.classList.contains('is-placing'), false);
assert.equal(placed.document.activeElement, placed.knobs[1], 'Focus returns to the moved point');
assert.equal(placed.knobs[1].focusOptions?.preventScroll, true, 'Pointer completion does not jump the page');
assert.match(placed.status.textContent, /(?:2|two)/i, 'The changed point is confirmed');
assert.equal(placed.frames.size, 0, 'Placement does not override a saved pause');
placed.choose(0);
placed.surface.dispatch('click', {detail:1, clientX:-100, clientY:2000});
assert.deepEqual(placed.position(0), {x:22,y:878}, 'Placement uses the same horizontal and vertical bounds as dragging');
checks.push('One-shot placement, boundary clamping, synthetic-click protection and non-scrolling focus return');

const cancelled = harness();
const cancelOriginal = cancelled.position(0);
cancelled.choose(0); cancelled.cancel.dispatch('click');
assert.equal(cancelled.surface.hidden, true, 'Cancel exits placement mode');
assert.deepEqual(cancelled.position(0), cancelOriginal, 'Cancel does not change the point');
assert.equal(cancelled.document.activeElement, cancelled.knobs[0]);
assert.notEqual(cancelled.knobs[0].focusOptions?.preventScroll, true, 'Cancel lets the browser bring an off-screen point back into view');
cancelled.choose(0);
const escaped = cancelled.document.dispatch('keydown', {key:'Escape'});
assert.equal(escaped.defaultPrevented, true, 'Escape handles the active placement action');
assert.equal(cancelled.surface.hidden, true);
assert.deepEqual(cancelled.position(0), cancelOriginal);
assert.equal(cancelled.document.activeElement, cancelled.knobs[0]);
cancelled.choose(0);
const outside = cancelled.hero.querySelector('.hero-cta a'); outside.focus();
cancelled.hero.dispatch('focusout', {relatedTarget:outside});
assert.equal(cancelled.surface.hidden, true, 'Leaving the point controls cancels a pending placement');
assert.equal(cancelled.document.activeElement, outside, 'Focus departure is not pulled back into the artwork');
checks.push('Cancel, Escape and focus departure safely end placement');

const keyboard = harness({ paused: true });
assert.equal(keyboard.art.classList.contains('is-paused'), true, 'A saved pause is restored on load');
assert.equal(keyboard.motionLabel.textContent, 'Play motion');
const before = keyboard.position(0);
keyboard.knobs[0].dispatch('keydown', { key: 'ArrowRight', shiftKey: false });
assert.equal(keyboard.position(0).x, before.x + 8, 'Arrow keys retain ordinary movement');
keyboard.knobs[0].dispatch('keydown', { key: 'ArrowRight', shiftKey: true });
assert.equal(keyboard.position(0).x, before.x + 40, 'Shift retains larger movement');
keyboard.advance(500);
assert.ok(keyboard.status.textContent.length, 'Keyboard changes provide status feedback');
keyboard.reset.dispatch('click');
assert.deepEqual(keyboard.position(0), before, 'Reset restores the original handle position');
assert.equal(keyboard.reset.hidden, true);
checks.push('Existing arrow keys, larger steps and reset remain available');

const selectedKeyboard = harness({paused:true});
selectedKeyboard.knobs[0].focus();
selectedKeyboard.knobs[0].dispatch('click', {detail:0});
assert.equal(selectedKeyboard.surface.hidden, false, 'Native keyboard activation can select a point');
const selectedBefore = selectedKeyboard.position(0);
selectedKeyboard.knobs[0].dispatch('keydown', {key:'ArrowLeft',shiftKey:false});
assert.equal(selectedKeyboard.position(0).x, selectedBefore.x - 8);
assert.equal(selectedKeyboard.surface.hidden, true, 'Direct keyboard movement ends the pending pointer-placement mode');
const drag = harness({paused:true});
const dragFrom = drag.position(0);
drag.knobs[0].dispatch('pointerdown', {button:0,pointerId:1,clientX:dragFrom.x,clientY:dragFrom.y});
drag.knobs[0].dispatch('pointermove', {pointerId:1,clientX:dragFrom.x + 64,clientY:dragFrom.y + 32});
drag.knobs[0].dispatch('pointerup', {pointerId:1});
assert.deepEqual(drag.position(0), {x:dragFrom.x+64,y:dragFrom.y+32}, 'Dragging still moves the point directly');
drag.knobs[0].dispatch('click', {detail:1});
assert.equal(drag.surface.hidden, true, 'The click after a drag does not accidentally arm placement');
checks.push('Dragging and direct keyboard movement remain available without conflicting modes');

const paused = harness();
paused.advance(1800); paused.frame(2000); paused.frame(2400);
assert.ok(paused.frames.size > 0, 'A running motion has queued frames');
paused.motion.dispatch('click');
assert.equal(paused.art.classList.contains('is-paused'), true);
assert.equal(paused.frames.size, 0, 'Pause cancels queued travelling-light frames immediately');
assert.equal(Number(paused.light.style.opacity), 0);
assert.equal(paused.saved.get('cg-hero-motion'), 'paused');
const pausedPosition = paused.position(0);
paused.frame(2600);
assert.deepEqual(paused.position(0), pausedPosition, 'Paused artwork keeps its point positions');
paused.choose(0);
paused.surface.dispatch('click', {detail:1,clientX:700,clientY:450});
assert.equal(paused.frames.size, 0, 'Direct changes do not resume a manually paused artwork');
paused.motion.dispatch('click');
assert.equal(paused.art.classList.contains('is-paused'), false, 'Play can resume after cancelling queued motion');
assert.ok(paused.frames.size > 0);
assert.equal(paused.saved.get('cg-hero-motion'), 'playing');
checks.push('Pause immediately stops running motion and preserves the choice');

const reduced = harness({ reduced: true });
reduced.advance(2000);
assert.equal(reduced.frames.size, 0, 'Reduced-motion load never starts the travelling light');
const initial = reduced.position(0);
reduced.choose(0);
reduced.surface.dispatch('click', {detail:1,clientX:600,clientY:450});
assert.notDeepEqual(reduced.position(0), initial, 'Reduced-motion users can still change a curve');
assert.equal(reduced.frames.size, 0, 'Reduced-motion position changes do not start animation');
reduced.reset.dispatch('click');
assert.ok(reduced.document.activeElement !== reduced.motion, 'Reset must not send focus to the reduced-motion-hidden play button');
assert.ok(reduced.document.activeElement === reduced.knobs[0], 'Reset returns reduced-motion users to an available handle');
const switched = harness();
switched.advance(1800);
assert.ok(switched.frames.size > 0);
switched.reduce(true);
assert.equal(switched.frames.size, 0, 'Enabling Reduced Motion cancels motion already queued');
assert.equal(Number(switched.light.style.opacity), 0);
checks.push('Reduced Motion suppresses automatic start-up and running motion while preserving direct editing');

const editingMotion = harness();
editingMotion.advance(1800);
assert.ok(editingMotion.frames.size > 0);
editingMotion.choose(0);
assert.equal(editingMotion.frames.size, 0, 'Selecting a point temporarily stills the artwork');
editingMotion.cancel.dispatch('click');
assert.ok(editingMotion.frames.size > 0, 'Leaving placement restores an otherwise playing artwork');

const resized = harness();
resized.choose(0);
resized.widthMedia.matches = true;
resized.notifyResize();
assert.equal(resized.surface.hidden, true, 'Placement closes when the artwork is hidden by a narrow layout');
assert.equal(resized.document.activeElement, resized.motion, 'Focus returns to a visible control after narrow-layout hiding');
for (const control of ['cancel', 'reset']) {
  const hiddenControl = harness();
  hiddenControl[control].focus();
  hiddenControl.widthMedia.matches = true;
  hiddenControl.notifyResize();
  assert.ok(hiddenControl.document.activeElement === hiddenControl.motion, 'A newly hidden ' + control + ' control restores focus to available motion control');
}
const reading = harness();
reading.choose(0);
reading.root.classList.add('reading-focus'); reading.notifyMutations();
assert.equal(reading.frames.size, 0, 'Reading Focus cancels pending movement');
assert.equal(reading.document.activeElement, reading.document.querySelector('.hero').querySelector('.hero-cta a'), 'Reading Focus moves hidden-artwork focus to the visible main action');
const hiddenPause = harness();
hiddenPause.motion.focus(); hiddenPause.reduce(true);
assert.ok(hiddenPause.document.activeElement !== hiddenPause.motion, 'An OS preference change moves focus away from a newly hidden motion button');
checks.push('Resize and Reading Focus keep focus on available controls');

const storage = harness({ blockedStorage: true });
storage.motion.dispatch('click');
assert.equal(storage.art.classList.contains('is-paused'), true, 'Pause works when preference storage is unavailable');
storage.knobs[0].dispatch('keydown', { key: 'ArrowLeft', shiftKey: false });
assert.equal(storage.frames.size, 0, 'Storage failure does not bypass pause');
checks.push('Blocked storage leaves the controls operational');

console.log(JSON.stringify({
  result: 'PASS',
  scope: 'Inline-script syntax and isolated hero-controller logic using simulated DOM, geometry and frame scheduling; no rendered browser, zoom, flashing or screen-reader verification',
  checks
}, null, 2));
