import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['design-system.html', 'about.html'];
const marker = '/* Mobile navigation: keep keyboard focus inside the open menu. */';

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, properties = {}) {
      const event = {
        type, defaultPrevented: false, shiftKey: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}, ...properties
      };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    }
  };
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : force;
      if (next) values.add(name); else values.delete(name);
      return next;
    }
  };
}

function harness(source) {
  const document = { ...eventTarget(), activeElement: null };
  function element(name) {
    const attributes = new Map();
    return {
      ...eventTarget(), name, classList: classList(), style: {}, children: [],
      setAttribute(key, value) { attributes.set(key, String(value)); },
      getAttribute(key) { return attributes.get(key) ?? null; },
      removeAttribute(key) { attributes.delete(key); },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      focus() {
        document.activeElement = this;
        document.dispatch('focusin', { target: this });
      },
      querySelector(selector) {
        if (selector === '.nav-name') return navName;
        return null;
      },
      querySelectorAll(selector) {
        assert.equal(selector, 'a');
        return this === overlay ? links : [];
      }
    };
  }
  const button = element('menu trigger');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Open menu');
  const links = [element('Home'), element('Work'), element('About'), element('Work with me')];
  const overlay = element('menu overlay');
  overlay.children = links;
  const navName = element('site name');
  const siteNav = element('site navigation');
  siteNav.children = [navName, button];
  const outside = element('background content');
  const body = element('body');
  body.style.overflow = '';
  body.children = [siteNav, overlay, outside];
  document.body = body;
  document.querySelector = selector => {
    const found = { '.nav-hamburger': button, '.nav-overlay': overlay, 'body > nav': siteNav, '.nav-name': navName }[selector];
    assert.ok(found, 'Known menu selector: ' + selector);
    return found;
  };
  const desktop = { ...eventTarget(), matches: false };
  desktop.addListener = listener => desktop.addEventListener('change', listener);
  const window = {
    ...eventTarget(),
    matchMedia(query) { assert.equal(query, '(min-width: 769px)'); return desktop; }
  };
  vm.runInNewContext(source, { document, window });
  function click(target) { target.dispatch('click', { target }); }
  function key(key, shiftKey = false) {
    return document.dispatch('keydown', { key, shiftKey, target: document.activeElement });
  }
  function expectOpen(open) {
    assert.equal(button.classList.contains('open'), open, 'Trigger visual state');
    assert.equal(overlay.classList.contains('open'), open, 'Overlay visibility state');
    assert.equal(button.getAttribute('aria-expanded'), String(open), 'Trigger expanded state');
    assert.equal(body.style.overflow, open ? 'hidden' : '', 'Page scroll lock');
    assert.equal(body.classList.contains('nav-menu-open'), open, 'Open-menu body state');
  }
  function open() { button.focus(); click(button); expectOpen(true); }
  return { document, button, links, overlay, navName, outside, desktop, click, key, open, expectOpen };
}

const checked = [];
for (const name of pages) {
  const html = await readFile(path.join(rootDir, name), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
  scripts.forEach(source => new vm.Script(source, { filename: name }));
  const controller = scripts.find(source => source.includes(marker));
  assert.ok(controller, name + ': mobile navigation controller exists');
  const test = harness(controller);
  test.expectOpen(false);
  test.open();
  assert.equal(test.document.activeElement, test.links[0], 'Opening focuses first menu link');
  assert.match(test.button.getAttribute('aria-label'), /close/i, 'Open trigger names its close action');

  let event = test.key('Tab', true);
  assert.equal(event.defaultPrevented, true, 'Reverse Tab at first link is handled');
  assert.equal(test.document.activeElement, test.button);
  event = test.key('Tab', true);
  assert.equal(event.defaultPrevented, true, 'Reverse Tab at trigger is handled');
  assert.equal(test.document.activeElement, test.links.at(-1));
  event = test.key('Tab');
  assert.equal(event.defaultPrevented, true, 'Forward Tab at last link is handled');
  assert.equal(test.document.activeElement, test.button);
  event = test.key('Tab');
  assert.equal(event.defaultPrevented, true, 'Forward Tab at trigger is handled');
  assert.equal(test.document.activeElement, test.links[0]);

  test.outside.focus();
  assert.equal(test.document.activeElement, test.links[0], 'Background focus is redirected into open menu');
  test.key('Escape');
  test.expectOpen(false);
  assert.equal(test.document.activeElement, test.button, 'Escape returns focus to trigger');
  assert.match(test.button.getAttribute('aria-label'), /open/i, 'Closed trigger names its open action');
  test.outside.focus();
  assert.equal(test.document.activeElement, test.outside, 'Closed menu permits ordinary page focus');
  assert.equal(test.key('Tab').defaultPrevented, false, 'Closed menu does not intercept Tab');

  test.open();
  test.button.focus();
  test.click(test.button);
  test.expectOpen(false);
  test.open();
  test.click(test.links[1]);
  test.expectOpen(false);
  test.open();
  test.desktop.matches = true;
  test.desktop.dispatch('change', { matches: true });
  test.expectOpen(false);
  assert.equal(test.document.activeElement, test.navName, 'Desktop transition moves focus to visible site link');
  checked.push(name);
}

console.log(JSON.stringify({
  result: 'PASS',
  scope: 'Inline script syntax and isolated menu-controller logic; no browser rendering, actual zoom or screen-reader verification',
  pages: checked,
  checks: ['Initial link focus and ARIA state', 'Forward and reverse Tab boundaries', 'Background focus recovery', 'Escape and focus return', 'Trigger and link closure', 'Desktop breakpoint closes menu and releases page scroll']
}, null, 2));
