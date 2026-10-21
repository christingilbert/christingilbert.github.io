import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(path.join(rootDir, 'design-system.html'), 'utf8');
const source = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('System in use:'));
assert.ok(source); new vm.Script(source);
const section = page.slice(page.indexOf('<!-- SYSTEM IN USE -->'), page.indexOf('<section class="block" id="reading-focus"'));
const modes = ['type', 'colour', 'spacing'];
const buttonMarkup = [...section.matchAll(/<button\b([^>]*data-si-rule="([^"]+)"[^>]*)>([^<]+)<\/button>/g)];
const panelMarkup = [...section.matchAll(/<div\b([^>]*data-si-panel="([^"]+)"[^>]*)>/g)];
assert.deepEqual(buttonMarkup.map(m => m[2]), modes); assert.deepEqual(panelMarkup.map(m => m[2]), modes);
const ids = ['si-controls', 'si-reference-content', 'si-rule-copy'];
function harness(omit) {
  let externalReads = 0;
  const buttons = buttonMarkup.map(([,markup,mode]) => ({ attributes: {'data-si-rule':mode,'aria-pressed':markup.match(/aria-pressed="([^"]+)"/)[1]}, events:{}, getAttribute(name){assert.equal(name,'data-si-rule');return this.attributes[name];}, setAttribute(name,value){assert.equal(name,'aria-pressed');this.attributes[name]=value;}, addEventListener(event,handler){assert.equal(event,'click');this.events[event]=handler;} }));
  const panels = panelMarkup.map(([,markup,mode]) => ({ mode, hidden:/\bhidden\b/.test(markup), getAttribute(name){assert.equal(name,'data-si-panel');return this.mode;} }));
  const elements = {
    'si-controls':{hidden:true,querySelectorAll(s){assert.equal(s,'[data-si-rule]');return buttons;}},
    'si-reference-content':{querySelectorAll(s){assert.equal(s,'[data-si-panel]');return panels;}},
    'si-rule-copy':{textContent:'Static explanation'}
  };
  const document = {getElementById(id){assert.ok(ids.includes(id),'Controller must not access page excerpts or other content');return id===omit?null:elements[id];}};
  const context = {document};
  for(const [object,name] of [[document,'documentElement'],[document,'body'],[context,'localStorage'],[context,'window']]) Object.defineProperty(object,name,{get(){externalReads++;throw new Error('Unexpected global access: '+name);}});
  vm.runInNewContext(source,context);
  return {elements,buttons,panels,externalReads:()=>externalReads};
}
function state(t){return {pressed:t.buttons.map(b=>b.attributes['aria-pressed']),hidden:t.panels.map(p=>p.hidden),copy:t.elements['si-rule-copy'].textContent};}
function expectMode(t,mode){const s=state(t);assert.deepEqual(s.pressed,modes.map(m=>String(m===mode)));assert.equal(s.pressed.filter(v=>v==='true').length,1);assert.deepEqual(s.hidden,modes.map(m=>m!==mode));assert.equal(s.hidden.filter(v=>!v).length,1);assert.ok(s.copy.length>40);assert.equal(t.elements['si-controls'].hidden,false);assert.equal(t.externalReads(),0);return s;}
expectMode(harness(),'type');
const messages=new Map();
for(const from of modes) for(const to of modes){const t=harness();t.buttons[modes.indexOf(from)].events.click();expectMode(t,from);t.buttons[modes.indexOf(to)].events.click();messages.set(to,expectMode(t,to).copy);}
assert.equal(new Set(messages.values()).size,3);assert.match(messages.get('type'),/Fraunces/);assert.match(messages.get('colour'),/colour/i);assert.match(messages.get('spacing'),/gap/i);
const invalid=harness(),before=state(invalid);invalid.buttons[0].attributes['data-si-rule']='unknown';invalid.buttons[0].events.click();assert.deepEqual(state(invalid),before);
for(const id of ids){let t;assert.doesNotThrow(()=>{t=harness(id);});assert.equal(t.elements['si-controls'].hidden,true);assert.equal(t.externalReads(),0);}
const articles=[...section.matchAll(/<article class="si-page ([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];assert.equal(articles.length,3);
for(const [i,href] of ['index.html','about.html','case-study-himalayan-green-trips.html'].entries()){assert.ok(articles[i][2].includes('href="'+href+'"'));assert.match(articles[i][2],/class="si-title"/);assert.match(articles[i][2],/class="si-body"/);assert.doesNotMatch(articles[i][2],/data-si-(?:panel|rule)/);}
for(const [,markup] of buttonMarkup){assert.match(markup,/type="button"/);assert.match(markup,/aria-controls="si-reference-content"/);}
assert.match(section,/id="si-controls"[^>]*role="group"[^>]*aria-label="[^"]+"[^>]*hidden/);
assert.match(section,/id="si-rule-copy"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
assert.doesNotMatch(section,/data-rule=|data-si-rule="page"/);
assert.match(section,/<noscript>[\s\S]*?font reference is shown above/);assert.match(section,/Short excerpts with sizes adapted/);assert.match(section,/Each page has its own measurements/);
assert.equal(/\bhidden\b/.test(panelMarkup[0][1]),false);assert.ok(panelMarkup.slice(1).every(([,m])=>/\bhidden\b/.test(m)));
for(const unwanted of ['si-type-note','si-colour-note','si-gap-note','si-mini-nav']) assert.ok(!page.includes(unwanted),'Removed inline annotation class: '+unwanted);
const styles=page.slice(page.indexOf('/* System examples:'),page.indexOf('  .ad-dark{'));assert.doesNotMatch(styles,/outline:[^;}]*dashed/i);
assert.match(page,/\.si-controls\[hidden\]\{display:none\}/);assert.match(page,/\.si-panel\[hidden\]\{display:none\}/);assert.match(page,/\.si-control:focus-visible/);
assert.match(page,/\.si-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);assert.match(page,/@media\(max-width:820px\)/);assert.match(page,/@media\(max-width:560px\)/);
console.log(JSON.stringify({result:'PASS',scope:'Isolated controller and HTML/CSS source checks; no rendered browser testing',checks:['All 9 transitions synchronize one pressed button, one visible reference panel and its summary','Unknown modes leave the reference state intact','No access to examples, document-root, body, window or stored preferences','Missing elements safely leave controls hidden','Three clean static excerpts, real links and a no-JavaScript font fallback remain','Inline annotation classes and dashed annotation outlines are absent','Native buttons, polite status, focus and responsive rules are present'],pending:['Rendered layout and zoom','Keyboard and screen-reader behaviour in browser']},null,2));
