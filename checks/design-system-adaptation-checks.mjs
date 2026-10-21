import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(path.join(rootDir, 'design-system.html'), 'utf8');
const source = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('Local layout example:'));
assert.ok(source, 'Layout controller exists');
new vm.Script(source);
const originalTitle = page.match(/id="ad-project-title">([^<]+)</)[1];
const originalFeedback = page.match(/id="ad-feedback"[^>]*>([^<]+)</)[1];
const ids = ['ad-preview', 'ad-controls', 'ad-project-title', 'ad-feedback', 'ad-reset', 'ad-large', 'ad-narrow', 'ad-long'];

function harness(initial = 0, omit) {
  const elements = Object.fromEntries(ids.map(id => [id, {
    checked: false, hidden: id === 'ad-controls', textContent: '', events: {},
    classes: new Set(),
    addEventListener(event, listener) { this.events[event] = listener; }
  }]));
  for (const element of Object.values(elements)) element.classList = {
    toggle(name, force) { if (force) element.classes.add(name); else element.classes.delete(name); }
  };
  elements['ad-project-title'].textContent = originalTitle;
  elements['ad-feedback'].textContent = originalFeedback;
  ['ad-large', 'ad-narrow', 'ad-long'].forEach((id, bit) => {
    elements[id].checked = Boolean(initial & (1 << bit));
  });
  // Only local elements are exposed: accidental global DOM/storage access fails.
  vm.runInNewContext(source, {
    document: {
      getElementById(id) {
        assert.ok(ids.includes(id), 'The demo touches only its own elements');
        return id === omit ? null : elements[id];
      }
    }
  });
  return elements;
}
function expectState(elements, state) {
  assert.equal(elements['ad-preview'].classes.has('ad-large'), Boolean(state & 1));
  assert.equal(elements['ad-preview'].classes.has('ad-narrow'), Boolean(state & 2));
  const heading = elements['ad-project-title'].textContent;
  assert.equal(heading === originalTitle, !(state & 4));
  if (state & 4) assert.ok(heading.length > originalTitle.length);
  const message = elements['ad-feedback'].textContent;
  assert.equal(message === originalFeedback, state === 0);
  assert.equal(message.includes('25% larger'), Boolean(state & 1));
  assert.equal(message.includes('stack'), Boolean(state & 2));
  assert.equal(message.includes('full title wraps'), Boolean(state & 4));
  assert.equal(elements['ad-controls'].hidden, false);
}
for (let state = 0; state < 8; state++) {
  const elements = harness();
  ['ad-large', 'ad-narrow', 'ad-long'].forEach((id, bit) => {
    elements[id].checked = Boolean(state & (1 << bit));
    elements[id].events.change();
  });
  expectState(elements, state);
  elements['ad-reset'].events.click();
  expectState(elements, 0);
  assert.ok(['ad-large', 'ad-narrow', 'ad-long'].every(id => !elements[id].checked));
  // Back/forward restoration may preserve checkbox values before the controller runs.
  expectState(harness(state), state);
}
for (const id of ids) assert.doesNotThrow(() => harness(0, id));

const section = page.slice(page.indexOf('<!-- COMPONENTS -->'), page.indexOf('<!-- MOTION -->'));
for (const id of ['ad-large', 'ad-narrow', 'ad-long']) {
  assert.ok(section.includes('for="'+id+'"'));
  assert.match(section, new RegExp('<input type="checkbox" id="'+id+'" aria-controls="ad-preview">'));
}
assert.match(section, /<fieldset[^>]*id="ad-controls"[^>]*hidden>/);
assert.match(section, /id="ad-feedback" role="status" aria-live="polite" aria-atomic="true"/);
assert.ok(section.includes('href="case-study-himalayan-green-trips.html"'));
assert.ok(section.includes('src="hgt-card-2026.jpg" width="1185" height="790"'));
assert.match(page, /\.ad-controls\[hidden\]\{display:none\}/);
assert.match(page, /\.ad-preview\{[^}]*flex-wrap:wrap/);
assert.match(page, /\.ad-preview\.ad-narrow\{width:360px;max-width:100%\}/);
assert.match(page, /\.ad-card-image\{[^}]*width:100%;height:auto/);
assert.match(page, /\.ad-option input:focus-visible\{outline:2px solid var\(--accent\)/);

console.log(JSON.stringify({
  result: 'PASS',
  scope: 'Isolated controller tests and HTML/CSS source checks; no rendered browser testing',
  checks: [
    'All eight combinations update local classes, heading and explanatory status',
    'Reset restores the original content and clears every checkbox',
    'Restored checkbox values initialise consistently',
    'No document-root or storage access; missing elements safely skip initialisation',
    'Native labelled controls, polite status, focus rule and hidden-control fallback are present',
    'Real case-study link and image remain in the static HTML; wrapping and proportional-image rules are present'
  ],
  pending: ['Rendered layout and browser zoom', 'Keyboard and screen-reader behaviour in browser']
}, null, 2));
