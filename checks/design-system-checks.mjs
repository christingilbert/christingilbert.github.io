import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['design-system.html', 'index.html', 'about.html', 'palette-demo.js'];
const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(rootDir, name), 'utf8')])));
const page = files['design-system.html'];
const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
for (const source of scripts) new vm.Script(source);
const bootstrap = scripts.find(source => source.includes("getItem('cg-reading-focus')"));
const controller = scripts.find(source => source.includes("var KEY = 'cg-reading-focus';"));
assert.ok(bootstrap && controller, 'Reading Focus initialisation and controller exist');

function classList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    contains(name) { return values.has(name); },
    toggle(name, force) { const next = force === undefined ? !values.has(name) : force; if (next) values.add(name); else values.delete(name); return next; }
  };
}
function control() {
  const label = { textContent: 'Off' };
  const attributes = {};
  const events = {};
  return {
    hidden: true, classList: classList(), label, attributes, events,
    setAttribute(name, value) { attributes[name] = value; },
    querySelector(selector) { assert.equal(selector, '.reading-toggle-state'); return label; },
    addEventListener(name, listener) { events[name] = listener; }
  };
}
function harness(saved, blocked = false) {
  let value = saved;
  const root = { classList: classList() };
  const controls = [control(), control()];
  const footer = {};
  let intersect;
  const context = {
    document: {
      documentElement: root,
      querySelectorAll(selector) {
        if (selector === '[data-reading-focus], #reading-focus-toggle') return controls;
        if (selector === 'footer, .contact-strip') return [footer];
        throw new Error('Unexpected selector: ' + selector);
      },
      getElementById(id) { assert.equal(id, 'reading-focus-toggle'); return controls[1]; }
    },
    localStorage: {
      getItem(key) { assert.equal(key, 'cg-reading-focus'); if (blocked) throw new Error('Storage blocked'); return value; },
      setItem(key, next) { assert.equal(key, 'cg-reading-focus'); if (blocked) throw new Error('Storage blocked'); value = next; }
    },
    IntersectionObserver: class {
      constructor(callback) { intersect = callback; }
      observe(element) { assert.equal(element, footer); }
    },
    Set
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(bootstrap, context);
  vm.runInContext(controller, context);
  function expectState(enabled) {
    assert.equal(root.classList.contains('reading-focus'), enabled);
    for (const button of controls) {
      assert.equal(button.attributes['aria-pressed'], String(enabled));
      assert.equal(button.label.textContent, enabled ? 'On' : 'Off');
      assert.equal(button.hidden, false);
    }
  }
  return { controls, expectState, saved: () => value, footer, intersect: entries => intersect(entries) };
}

let assertions = [];
for (const saved of [null, '0', '1']) {
  const test = harness(saved);
  test.expectState(saved === '1');
}
assertions.push('No saved value / saved Off / saved On initialise correctly');
const test = harness(null);
test.controls[0].events.click();
test.expectState(true);
assert.equal(test.saved(), '1');
harness(test.saved()).expectState(true);
test.controls[1].events.click();
test.expectState(false);
assert.equal(test.saved(), '0');
harness(test.saved()).expectState(false);
assertions.push('Both controls toggle and stay in sync; On and Off restore on a later load');
const blocked = harness(null, true);
blocked.expectState(false);
blocked.controls[0].events.click();
blocked.expectState(true);
blocked.controls[1].events.click();
blocked.expectState(false);
assertions.push('Blocked storage does not prevent toggling');
test.intersect([{ target: test.footer, isIntersecting: true }]);
assert.equal(test.controls[1].classList.contains('is-tucked'), true);
test.intersect([{ target: test.footer, isIntersecting: false }]);
assert.equal(test.controls[1].classList.contains('is-tucked'), false);
assert.ok(/\.reading-toggle\.is-tucked:focus-visible\s*\{[^}]*opacity:1;[^}]*transform:none;/.test(page));
assertions.push('Footer visibility updates tuck state; CSS restores the focused floating control');

for (const name of ['design-system.html', 'index.html', 'about.html']) {
  const source = files[name];
  assert.match(source, /html\.reading-focus\s*\{\s*font-size:\s*112%;/);
  assert.match(source, /\.reading-focus body::after\s*\{opacity:0;/);
  assert.match(source, /filter:saturate\(0\.45\) contrast\(0\.97\)/);
  assert.match(source, /word-spacing:0\.03em/);
}
assert.match(files['index.html'], /\.reading-focus \.hero-art \*\s*\{\s*animation:\s*none !important/);
assert.ok(files['index.html'].includes("reduce.matches || root.classList.contains('reading-focus')"));
assert.ok(page.includes('.mo-dot.run{animation-name:mo-fade}'));
assert.ok(page.includes('html{scroll-behavior:auto}'));
assertions.push('Source contains the documented Reading Focus and reduced-motion rules');

const expected = { bg:'#FFFDFA', linen:'#FAF3EF', surface:'#E4DDE3', dark:'#1A1423', accent:'#6E4658', 'accent-h':'#523544', bar:'#523544', 'on-bar':'#FAF3EF', 'tint-1':'#F5EEF3', 'tint-2':'#E6DAE3', 'tint-3':'#C0A5B8' };
for (const [token, value] of Object.entries(expected)) {
  for (const name of ['design-system.html', 'index.html']) {
    const declared = files[name].match(new RegExp('--' + token + ':\\s*(#[0-9A-Fa-f]{6})'))?.[1].toUpperCase();
    assert.equal(declared, value, name + ' ' + token);
  }
}
assertions.push('Documented core colours match the homepage token values');

function luminance(hex) {
  const [r,g,b] = hex.slice(1).match(/../g).map(part => parseInt(part,16)/255).map(c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
const contrastSection = page.slice(page.indexOf('id="contrast"'), page.indexOf('<!-- TYPE -->'));
const contrastRows = [...contrastSection.matchAll(/<tr><th scope="row">[\s\S]*?<code class="inl">(#[0-9A-F]{6})<\/code>[\s\S]*?<code class="inl">(#[0-9A-F]{6})<\/code>[\s\S]*?<td class="ratio">([\d.]+):1<\/td>/g)];
assert.equal(contrastRows.length, 9);
const ratios = contrastRows.map(([,fg,bg,label]) => {
  const value = contrast(fg,bg);
  assert.equal(value.toFixed(2), label);
  assert.ok(value >= 4.5);
  return { foreground:fg, background:bg, ratio:value.toFixed(2) };
});
assertions.push('All nine published contrast ratios match independent calculations');

const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Unique HTML IDs');
for (const [,id] of page.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), 'Anchor target ' + id);
for (const [,id] of page.matchAll(/data-replay="([^"]+)"/g)) assert.ok(ids.includes(id), 'Motion target ' + id);
assert.ok(page.includes('id="palette-demo"') && page.includes('src="palette-demo.js"'));
assert.equal((page.match(/data-replay="/g)||[]).length, 7);
assertions.push('Anchor and replay targets exist; existing palette and seven motion demos remain');

console.log(JSON.stringify({
  reviewed:'2026-10-20',
  scope:'Source review and isolated JavaScript logic tests, not browser interaction or user research',
  result:'PASS',
  assertions,
  ratios,
  pending:['Keyboard and screen reader in browser', 'Zoom and narrow-screen layouts', 'Rendered gradients and image contrast', 'Reader feedback']
}, null, 2));
