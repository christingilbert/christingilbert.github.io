import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(path.join(rootDir, 'design-system.html'), 'utf8');
const source = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('System in use:'));
assert.ok(source, 'The three-page comparison has a controller');
new vm.Script(source);
const section = page.slice(page.indexOf('<!-- SYSTEM IN USE -->'), page.indexOf('<section class="block" id="reading-focus"'));
assert.ok(section.length > 0, 'The comparison appears before Reading Focus');
const modes = ['page', 'type', 'colour', 'spacing'];
const buttonMarkup = [...section.matchAll(/<button\b([^>]*data-si-rule="([^"]+)"[^>]*)>([^<]+)<\/button>/g)];
assert.deepEqual(buttonMarkup.map(match => match[2]), modes);
const ids = ['adaptation', 'si-controls', 'si-rule-title', 'si-rule-copy'];

function harness(omit) {
  let externalReads = 0;
  const buttons = buttonMarkup.map(([, markup, mode]) => ({
    attributes: { 'data-si-rule': mode, 'aria-pressed': markup.match(/aria-pressed="([^"]+)"/)[1] },
    events: {},
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { assert.equal(name, 'aria-pressed'); this.attributes[name] = value; },
    addEventListener(event, handler) { assert.equal(event, 'click'); this.events[event] = handler; }
  }));
  const elements = {
    adaptation: { attributes: { 'data-rule': 'type' }, setAttribute(name, value) { assert.equal(name, 'data-rule'); this.attributes[name] = value; } },
    'si-controls': { hidden: true, querySelectorAll(selector) { assert.equal(selector, '[data-si-rule]'); return buttons; } },
    'si-rule-title': { textContent: 'Static title' },
    'si-rule-copy': { textContent: 'Static explanation' }
  };
  const document = { getElementById(id) { assert.ok(ids.includes(id), 'Only local elements are requested'); return id === omit ? null : elements[id]; } };
  const context = { document };
  for (const [object, name] of [[document, 'documentElement'], [document, 'body'], [context, 'localStorage'], [context, 'window']]) {
    Object.defineProperty(object, name, { get() { externalReads++; throw new Error('Unexpected global access: ' + name); } });
  }
  vm.runInNewContext(source, context);
  return { elements, buttons, externalReads: () => externalReads };
}
function currentState(test) {
  return { rule: test.elements.adaptation.attributes['data-rule'], pressed: test.buttons.map(button => button.attributes['aria-pressed']), title: test.elements['si-rule-title'].textContent, copy: test.elements['si-rule-copy'].textContent };
}
function expectMode(test, mode) {
  const state = currentState(test);
  assert.equal(state.rule, mode);
  assert.equal(state.pressed.filter(value => value === 'true').length, 1, 'Exactly one mode is selected');
  assert.deepEqual(state.pressed, modes.map(value => String(value === mode)));
  assert.ok(state.title.length > 8 && state.copy.length > 40, 'Each mode explains its purpose');
  assert.equal(test.elements['si-controls'].hidden, false);
  assert.equal(test.externalReads(), 0, 'No page-wide state or storage access');
  return state;
}
expectMode(harness(), 'type');
const messages = new Map();
for (const from of modes) {
  for (const to of modes) {
    const test = harness();
    test.buttons[modes.indexOf(from)].events.click();
    expectMode(test, from);
    test.buttons[modes.indexOf(to)].events.click();
    const state = expectMode(test, to);
    messages.set(to, state.title + ' ' + state.copy);
    test.buttons[0].events.click();
    expectMode(test, 'page');
  }
}
assert.equal(new Set(messages.values()).size, 4, 'Each mode has a distinct explanation');
assert.match(messages.get('type'), /Fraunces/);
assert.match(messages.get('colour'), /mauve/i);
assert.match(messages.get('spacing'), /group/i);
const invalid = harness();
const beforeInvalid = currentState(invalid);
invalid.buttons[0].attributes['data-si-rule'] = 'unrecognised';
invalid.buttons[0].events.click();
assert.deepEqual(currentState(invalid), beforeInvalid, 'Unknown modes leave the current state intact');
for (const id of ids) {
  let test;
  assert.doesNotThrow(() => { test = harness(id); });
  assert.equal(test.elements['si-controls'].hidden, true, 'Incomplete markup keeps controls hidden');
  assert.equal(test.externalReads(), 0);
}
const articles = [...section.matchAll(/<article class="si-page ([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];
assert.equal(articles.length, 3, 'Three page excerpts remain in static HTML');
for (const [index, href] of ['index.html', 'about.html', 'case-study-himalayan-green-trips.html'].entries()) {
  assert.ok(articles[index][2].includes('href="' + href + '"'));
  for (const label of ['si-type-note', 'si-colour-note', 'si-gap-note']) assert.ok(articles[index][2].includes(label));
}
for (const [, markup] of buttonMarkup) {
  assert.match(markup, /type="button"/);
  assert.match(markup, /aria-controls="si-pages"/);
}
assert.match(section, /id="si-controls"[^>]*role="group"[^>]*aria-label="[^"]+"[^>]*hidden/);
assert.match(section, /id="si-explainer"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
assert.match(section, /id="adaptation" data-rule="type"/);
assert.match(section, /<noscript>[\s\S]*?Typography is highlighted/);
assert.match(section, /Condensed excerpts/);
assert.match(section, /spacing is page-specific/i);
assert.match(page, /\.si-controls\[hidden\]\{display:none\}/);
for (const [mode, label] of [['type', 'type'], ['colour', 'colour'], ['spacing', 'gap']]) {
  assert.ok(page.includes('.si-gallery[data-rule="' + mode + '"] .si-' + label + '-note{display:block'));
}
assert.match(page, /\.si-control:focus-visible/);
assert.match(page, /\.si-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(page, /@media\(max-width:820px\)/);
assert.match(page, /@media\(max-width:560px\)/);
console.log(JSON.stringify({
  result: 'PASS',
  scope: 'Isolated JavaScript controller tests and HTML/CSS source checks; no rendered browser testing',
  checks: [
    'All 16 mode-to-mode transitions update the local highlight, explanation and exactly one pressed button',
    'Page view resets selection; unknown modes do not change it',
    'No document-root, body, window or stored-preference access',
    'Missing required elements safely leave controls hidden',
    'Three static excerpts, real page links, labels and no-JavaScript fallback are present',
    'Native buttons, polite status, focus styles, annotation rules and responsive grid rules are present'
  ],
  pending: ['Rendered layout and browser zoom', 'Keyboard and screen-reader behaviour in browser']
}, null, 2));
