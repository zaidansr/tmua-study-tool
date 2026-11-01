'use strict';

// Runs the shipped event handlers in a small DOM/storage harness. This exercises
// state transitions without downloading a browser or depending on test packages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'web','index.html'),'utf8');
const production = fs.readFileSync(path.join(root,'web','app.js'),'utf8').replace(/\r\n/g,'\n');
const memoryScript = fs.readFileSync(path.join(root,'web','memory.js'),'utf8');
const STORAGE = 'tmua-question-bank-progress-v1', LAST = 'tmua-question-bank-last-question-v1', RESET = 'tmua-question-bank-reset-v2';
const ATTEMPT = 'tmua-question-bank-attempt-v2:', BOOKMARK = 'tmua-question-bank-bookmark-v2:';

class Element {
  constructor(document,tag = 'div',attributes = {}) {
    this.document = document; this.tagName = tag.toUpperCase(); this.attributes = {...attributes}; this.id = attributes.id || ''; this.dataset = {}; this.children = []; this.parentNode = null; this.handlers = {}; this.disabled = 'disabled' in attributes; this.hidden = 'hidden' in attributes; this.value = attributes.value || ''; this.textContent = ''; this._html = '';
    for (const [name,value] of Object.entries(attributes)) if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c) => c.toUpperCase())] = value;
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    this.classList = {contains:(c) => classes.has(c),toggle:(c,force) => { const on = force === undefined ? !classes.has(c) : force; if (on) classes.add(c); else classes.delete(c); return on; }};
  }
  set innerHTML(value) {
    if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body;
    for (const child of this.children) if (child.id && this.document.ids.get(child.id) === child) this.document.ids.delete(child.id);
    this._html = value; this.children = this.document.parse(value,this);
  }
  get innerHTML() { return this._html; }
  setAttribute(name,value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type,fn) { (this.handlers[type] ||= []).push(fn); }
  fire(type,event = {}) { for (const fn of this.handlers[type] || []) fn({currentTarget:this,target:this,preventDefault(){},...event}); }
  focus() { if (!this.disabled) this.document.activeElement = this; }
  contains(other) { return Boolean(other && (other === this || this.children.includes(other))); }
  matches(selector) {
    if (selector === 'button') return this.tagName === 'BUTTON';
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (data) { const value = this.dataset[data[1].replace(/-([a-z])/g,(_,c) => c.toUpperCase())]; return value !== undefined && (data[2] === undefined || value === data[2]); }
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.filter((child) => child.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  insertAdjacentHTML(_where,value) { this.children.push(...this.document.parse(value,this)); }
  scrollIntoView() {}
  after() {}
}
class Document {
  constructor() { this.ids = new Map(); this.handlers = {}; this.hidden = false; this.body = new Element(this,'body'); this.activeElement = this.body; this.nodes = this.parse(html,null); }
  parse(markup,parent) {
    const nodes = [];
    for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)) {
      const attributes = {};
      for (const attribute of match[2].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) attributes[attribute[1]] = attribute[2] ?? attribute[3] ?? '';
      const element = new Element(this,match[1],attributes); element.parentNode = parent;
      if (element.id) this.ids.set(element.id,element);
      nodes.push(element);
    }
    return nodes;
  }
  getElementById(id) { return this.ids.get(id) || null; }
  querySelectorAll(selector) { return [...this.nodes,...[...this.ids.values()].flatMap((element) => element.children)].filter((element,index,all) => all.indexOf(element) === index && element.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type,fn) { (this.handlers[type] ||= []).push(fn); }
  fire(type,event = {}) { for (const fn of this.handlers[type] || []) fn(event); }
  createElement(tag) { return new Element(this,tag); }
}
function fixture() {
  return {meta:{},papers:[{id:'2023-p1',year:'2023',paper:1,questionPdf:'papers/question.pdf',solutionPdf:'papers/solution.pdf'}],questions:Array.from({length:8},(_,i) => ({id:`q${i + 1}`,year:'2023',paper:1,number:i + 1,paperId:'2023-p1',topic:i < 4 ? 'Algebra' : 'Logic',text:`Question ${i + 1}`,options:['A','B','C','D'],answer:'A',images:[],solutionImages:[]}))};
}
function createApp({progress,storage = {},hash = '',historyThrows = false,storageThrows = false,storageReadThrows = false,data = fixture(),allowError = false,random = Math.random,contentReady = true,browser} = {}) {
  const document = new Document(), handlers = {}, entries = storage instanceof Map ? storage : new Map(Object.entries(storage)), intervals = [];
  if (progress !== undefined) entries.set(STORAGE,typeof progress === 'string' ? progress : JSON.stringify(progress));
  let now = 100000;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const messages = [];
  const window = {TMUA_CONTENT_READY:contentReady,TMUA_DATA:data,chrome:{webview:{postMessage:(message) => messages.push(message)}},innerWidth:1200,confirm:() => true,addEventListener:(type,fn) => { (handlers[type] ||= []).push(fn); }};
  if (browser) window.TMUA_BROWSER = browser;
  const location = {hash,protocol:'https:',reloads:0,reload(){this.reloads++;}};
  const fails = (setting) => typeof setting === 'function' ? setting() : setting;
  let enumeratedKeys = [];
  const localStorage = {
    get length() { if (fails(storageReadThrows)) throw new Error('Storage reads unavailable'); enumeratedKeys = [...entries.keys()]; return enumeratedKeys.length; },
    key:(index) => { if (fails(storageReadThrows)) throw new Error('Storage reads unavailable'); return enumeratedKeys[index] ?? null; },
    getItem:(key) => { if (fails(storageReadThrows)) throw new Error('Storage reads unavailable'); return entries.get(key) ?? null; },
    setItem:(key,value) => { if (fails(storageThrows)) throw new Error('Storage unavailable'); entries.set(key,String(value)); },
    removeItem:(key) => { if (fails(storageThrows)) throw new Error('Storage unavailable'); entries.delete(key); },
  };
  window.localStorage = localStorage;
  const math = Object.create(Math); math.random = random;
  const context = vm.createContext({window,document,location,localStorage,history:{replaceState(_a,_b,fragment) { if (historyThrows) throw new Error('History unavailable'); location.hash = fragment; }},CSS:{escape:String},Date:ClockDate,Math:math,setTimeout:() => 1,clearTimeout(){},setInterval(fn){intervals.push(fn);},console});
  const script = production.replace(/\n  initialize\(\);\n\}\)\(\);\s*$/, '\n  globalThis.testApp = {state,selectQuestion,filteredQuestions,applyFilters,clearFilters,elapsedSeconds,switchView,getMemory:() => memory};\n  initialize();\n})();');
  assert.ok(script !== production,'Harness must expose the current shipped app entry point');
  vm.runInContext(memoryScript,context,{filename:'web/memory.js'});
  vm.runInContext(script,context,{filename:'frontend/app.js'});
  if (!allowError) assert.equal(document.getElementById('error').hidden,true,document.getElementById('error-detail').textContent);
  const get = (id) => document.getElementById(id);
  function saved() {
    const generation = entries.get(RESET) || 'legacy', result = generation === 'legacy' ? JSON.parse(entries.get(STORAGE) || '{}') : {};
    for (const [key,value] of entries) {
      if (key.startsWith(`${ATTEMPT}${generation}:`)) { const id = key.slice(`${ATTEMPT}${generation}:`.length); result[id] = {...result[id],...JSON.parse(value)}; }
      if (key.startsWith(`${BOOKMARK}${generation}:`)) { const id = key.slice(`${BOOKMARK}${generation}:`.length); result[id] = {...result[id],bookmarked:JSON.parse(value)}; }
    }
    return result;
  }
  const memory = context.testApp.getMemory();
  return {app:context.testApp,document,window,location,entries,get,messages,memory,advance:(ms) => { now += ms; for (const fn of intervals) fn(); },filter:(name,value) => { get(`${name}-filter`).value = value; get(`${name}-filter`).fire('change',{target:get(`${name}-filter`)}); },paper(value) { const button = get('paper-filter').querySelector(`[data-paper="${value}"]`) || document.querySelector(`[data-paper="${value}"]`); get('paper-filter').fire('click',{target:button}); },search(value) { get('search').value = value; get('search').fire('input',{target:get('search')}); },click(id) { const button = get(id); assert.ok(button,`Missing control ${id}`); assert.equal(button.disabled,false,`${id} must be enabled`); button.focus(); if (get('question-workspace').contains(button)) get('question-workspace').fire('click',{target:button}); else button.fire('click'); },choose(letter) { const button = get('question-workspace').querySelector(`[data-option="${letter}"]`); assert.ok(button); button.focus(); get('question-workspace').fire('click',{target:button}); },hash(fragment) { location.hash = fragment; for (const fn of handlers.hashchange || []) fn(); },fireWindow(type,event = {}) { for (const fn of handlers[type] || []) fn(event); },saved};
}
const marked = (selected = 'A',bookmarked = false) => ({selected,marked:true,correct:true,bookmarked});
const history = (h,id) => JSON.parse(JSON.stringify(id ? h.memory.list(id) : h.memory.all()));

test('practice history records every completed wrong and correct try with separate durations',() => {
  const h = createApp();
  assert.equal(history(h,'q1').length,0); h.choose('B'); h.click('bookmark-question');
  assert.equal(history(h,'q1').length,0,'choosing and bookmarking do not finish a try');
  h.advance(9000); h.click('mark-answer');
  const first = history(h,'q1')[0];
  assert.deepEqual([first.selected,first.outcome,first.correct,first.elapsedSeconds],['B','wrong',false,9]);
  assert.equal(h.saved().q1.attemptId,first.id); assert.ok(h.get('attempt-history-table'));
  assert.match(h.get('question-workspace').innerHTML,/<td>Wrong<\/td>|class="history-wrong">Wrong/);
  assert.match(h.get('question-workspace').innerHTML,/<td>00:09<\/td>/);
  h.get('question-workspace').fire('click',{target:h.get('mark-answer')}); h.fireWindow('focus');
  assert.equal(history(h,'q1').length,1,'duplicate handlers and focus refresh cannot add another completed try');
  h.click('retry-question'); assert.equal(history(h,'q1').length,1);
  h.advance(4000); h.choose('A'); h.click('mark-answer');
  const records = history(h,'q1'); assert.equal(records.length,2); assert.notEqual(records[0].id,records[1].id);
  assert.deepEqual(records.map((entry) => [entry.selected,entry.outcome,entry.elapsedSeconds]),[['B','wrong',9],['A','correct',4]]);
  assert.equal(h.saved().q1.attemptId,records[1].id);
  assert.equal(h.get('question-workspace').querySelectorAll('[data-attempt-id]').length,2);
  const reopened = createApp({storage:h.entries});
  assert.deepEqual(history(reopened,'q1'),records); reopened.fireWindow('focus'); assert.equal(history(reopened,'q1').length,2);
  assert.equal(reopened.get('question-workspace').querySelectorAll('[data-attempt-id]').length,2);
});

test('question navigation retains fractional draft time and excludes time spent on other questions',() => {
  const h = createApp(); h.advance(1250); h.choose('B'); h.app.selectQuestion('q2');
  assert.equal(JSON.parse(h.entries.get('tmua-question-bank-draft-v1:legacy:q1')).elapsedMs,1250);
  h.advance(700); h.app.selectQuestion('q1'); h.advance(850); h.click('mark-answer');
  assert.equal(history(h,'q1')[0].elapsedSeconds,2,'1250ms + 850ms remains one 2100ms try');
  assert.equal(history(h,'q2').length,0);
  h.app.selectQuestion('q2'); h.advance(350); h.fireWindow('pagehide');
  const draft = JSON.parse(h.entries.get('tmua-question-bank-draft-v1:legacy:q2'));
  assert.equal(draft.elapsedMs,1050,'700ms before navigation + 350ms after return');
  const reopened = createApp({storage:h.entries}); assert.equal(reopened.app.state.currentId,'q2'); assert.equal(reopened.app.state.elapsedMs,1050);
  reopened.advance(950); reopened.choose('A'); reopened.click('mark-answer');
  assert.equal(history(reopened,'q2')[0].elapsedSeconds,2,'fractional milliseconds survive reload without rounding each visit');
  assert.equal(history(reopened,'q2')[0].id,draft.id);
});

test('periodic and pagehide draft checkpoints resume the same try without recording incomplete work',() => {
  const h = createApp(); h.advance(5700);
  const checkpoint = JSON.parse(h.entries.get('tmua-question-bank-draft-v1:legacy:q1'));
  assert.equal(checkpoint.elapsedMs,5700); assert.equal(history(h).length,0);
  h.advance(300); h.fireWindow('pagehide');
  assert.equal(JSON.parse(h.entries.get('tmua-question-bank-draft-v1:legacy:q1')).elapsedMs,6000);
  const reopened = createApp({storage:h.entries}); assert.equal(reopened.app.elapsedSeconds(),6);
  reopened.advance(1500); reopened.choose('A'); reopened.click('mark-answer');
  assert.equal(history(reopened,'q1')[0].id,checkpoint.id); assert.equal(history(reopened,'q1')[0].elapsedSeconds,7);
  const again = createApp({storage:h.entries}); assert.equal(history(again,'q1').length,1); assert.equal(again.app.elapsedSeconds(),7);
});

test('existing marked progress migrates once with unknown historic times shown honestly',() => {
  const h = createApp({progress:{q1:marked('B'),q2:{...marked('A'),elapsedSeconds:23,updatedAt:'2026-10-31T10:00:00Z'}}});
  assert.equal(history(h,'q1').length,1); assert.equal(history(h,'q1')[0].elapsedSeconds,null); assert.equal(history(h,'q1')[0].completedAt,null);
  assert.match(h.get('question-workspace').innerHTML,/Earlier saved attempt/); assert.match(h.get('question-workspace').innerHTML,/Not recorded/);
  assert.equal(history(h,'q1')[0].correct,false,'migration recalculates the official key rather than trusting saved correctness');
  assert.equal(history(h,'q2')[0].elapsedSeconds,23); assert.equal(history(h,'q2')[0].completedAt,'2026-10-31T10:00:00.000Z');
  const reopened = createApp({storage:h.entries}); assert.equal(history(reopened).length,2); assert.equal(history(reopened,'q1').length,1);
  reopened.click('retry-question'); reopened.advance(2000); reopened.choose('A'); reopened.click('mark-answer');
  const onceMore = createApp({storage:h.entries}); assert.equal(history(onceMore,'q1').length,2,'new marked records with attempt IDs must not migrate again');
});

test('reset clears current history and stale windows cannot restore completed tries or old draft time',() => {
  const shared = new Map(), a = createApp({storage:shared}), b = createApp({storage:shared});
  a.advance(9000); a.choose('B'); a.click('mark-answer'); assert.equal(history(a).length,1);
  a.click('reset-progress'); assert.equal(history(a).length,0); assert.equal(a.app.elapsedSeconds(),0);
  b.advance(8000); b.fireWindow('storage',{key:RESET}); assert.equal(history(b).length,0); assert.equal(b.app.elapsedSeconds(),0);
  assert.equal(b.get('question-workspace').querySelectorAll('[data-attempt-id]').length,0);
  b.app.selectQuestion('q2'); b.advance(3000); b.choose('A'); b.click('mark-answer');
  assert.equal(history(b).length,1); assert.equal(history(b,'q2')[0].elapsedSeconds,3);
  a.fireWindow('storage',{key:RESET}); assert.equal(history(a).length,1); assert.equal(history(a,'q1').length,0);
  const reopened = createApp({storage:shared}); assert.equal(history(reopened).length,1); assert.equal(history(reopened,'q1').length,0);
});

test('temporarily denied writes retain visible session history and recover without duplicate attempts',() => {
  let unavailable = true; const h = createApp({storageThrows:() => unavailable});
  h.advance(5000); h.choose('B'); h.click('mark-answer');
  assert.equal(history(h,'q1').length,1); assert.equal(history(h,'q1')[0].elapsedSeconds,5);
  assert.match(h.get('question-workspace').innerHTML,/class="history-wrong">Wrong/);
  unavailable = false; h.fireWindow('focus');
  const reopened = createApp({storage:h.entries}); assert.equal(history(reopened,'q1').length,1);
  assert.equal(history(reopened,'q1')[0].elapsedSeconds,5); assert.equal(history(reopened,'q1')[0].correct,false);
});

test('stale mark, answer and retry clicks after another tab resets cannot restore old progress',() => {
  for (const action of ['mark','answer','retry']) {
    const shared = new Map();
    if (action === 'retry') shared.set(STORAGE,JSON.stringify({q1:{...marked('B'),elapsedSeconds:23}}));
    const resetter = createApp({storage:shared}), stale = createApp({storage:shared});
    if (action !== 'retry') { stale.advance(3000); stale.choose('B'); }
    resetter.click('reset-progress');
    if (action === 'mark') stale.click('mark-answer');
    if (action === 'answer') stale.choose('A');
    if (action === 'retry') stale.click('retry-question');
    assert.equal(stale.saved().q1,undefined,`${action}: discard the stale action instead of saving it in the new generation`);
    assert.equal(history(stale).length,0,`${action}: no old completed try enters new history`);
    assert.equal(stale.app.elapsedSeconds(),0,`${action}: old draft time is discarded`);
    assert.match(stale.get('toast').textContent,/reset in another tab/);
    const reopened = createApp({storage:shared});
    assert.equal(reopened.saved().q1,undefined); assert.equal(reopened.get('attempted-count').textContent,0); assert.equal(history(reopened).length,0);
  }
  const shared = new Map(), a = createApp({storage:shared}), b = createApp({storage:shared});
  b.advance(4500); b.choose('B'); a.click('reset-progress');
  b.app.selectQuestion('q2'); b.click('bookmark-question');
  assert.equal(b.saved().q1,undefined,'explicit fresh navigation may continue after synchronizing the reset');
  assert.equal(b.saved().q2.bookmarked,true); assert.equal(history(b).length,0);
  b.advance(2000); b.choose('A'); b.click('mark-answer');
  const reopened = createApp({storage:shared}); assert.equal(reopened.saved().q1,undefined); assert.equal(reopened.saved().q2.marked,true); assert.equal(reopened.app.state.progress.q2.correct,true);
  assert.equal(history(reopened).length,1); assert.equal(history(reopened,'q2')[0].elapsedSeconds,2);
});

test('focus-only storage recovery persists latest progress alongside history and saves pending reset first',() => {
  let blocked = true; const h = createApp({storageThrows:() => blocked});
  h.advance(5000); h.choose('B'); h.click('mark-answer'); blocked = false; h.fireWindow('focus');
  let reopened = createApp({storage:h.entries});
  assert.equal(reopened.saved().q1.marked,true); assert.equal(reopened.saved().q1.selected,'B'); assert.equal(reopened.app.state.progress.q1.correct,false); assert.equal(reopened.saved().q1.elapsedSeconds,5);
  assert.equal(reopened.get('attempted-count').textContent,1); assert.equal(history(reopened,'q1').length,1);
  assert.equal(reopened.saved().q1.attemptId,history(reopened,'q1')[0].id);
  blocked = true; h.click('reset-progress'); h.advance(2000); h.choose('A'); h.click('mark-answer');
  blocked = false; h.fireWindow('focus'); reopened = createApp({storage:h.entries});
  assert.notEqual(h.entries.get(RESET),'legacy'); assert.equal(reopened.saved().q1.selected,'A'); assert.equal(reopened.app.state.progress.q1.correct,true); assert.equal(reopened.saved().q1.elapsedSeconds,2);
  assert.equal(reopened.get('attempted-count').textContent,1); assert.equal(history(reopened).length,1);
  assert.equal(history(reopened,'q1')[0].outcome,'correct'); assert.equal(history(reopened,'q1')[0].elapsedSeconds,2);
});

test('active Practice and hash-route navigation preserve uncheckpointed fractional question time',() => {
  const h = createApp(); h.advance(2500); h.click('practice-tab');
  assert.equal(h.app.elapsedSeconds(),2); assert.equal(h.app.state.elapsedMs,2500);
  const firstId = JSON.parse(h.entries.get('tmua-question-bank-draft-v1:legacy:q1')).id;
  h.advance(500); h.click('practice-tab'); assert.equal(h.app.state.elapsedMs,3000);
  h.advance(1500); h.choose('A'); h.click('mark-answer');
  assert.equal(history(h,'q1')[0].elapsedSeconds,4); assert.equal(history(h,'q1')[0].id,firstId);
  const routes = createApp(); routes.advance(2700); routes.hash('#q2');
  assert.equal(JSON.parse(routes.entries.get('tmua-question-bank-draft-v1:legacy:q1')).elapsedMs,2700);
  routes.advance(650); routes.hash('#q1'); assert.equal(routes.app.state.elapsedMs,2700);
  assert.equal(JSON.parse(routes.entries.get('tmua-question-bank-draft-v1:legacy:q2')).elapsedMs,650);
  routes.advance(400); routes.choose('B'); routes.click('mark-answer');
  assert.equal(history(routes,'q1')[0].elapsedSeconds,3); assert.equal(history(routes,'q2').length,0);
});

test('marking inside Not attempted keeps feedback and navigates from the reviewed position',() => {
  const h = createApp(); h.filter('status','unattempted'); h.app.selectQuestion('q4'); h.choose('A'); h.click('mark-answer');
  assert.equal(h.app.state.currentId,'q4'); assert.equal(h.get('result-count').textContent,7); assert.match(h.get('question-workspace').innerHTML,/Correct\./);
  h.click('next-question'); assert.equal(h.app.state.currentId,'q5');
  h.click('previous-question'); assert.equal(h.app.state.currentId,'q3');
  h.app.selectQuestion('q8'); h.choose('A'); h.click('mark-answer');
  assert.equal(h.get('next-question').disabled,true); assert.equal(h.get('previous-question').disabled,false);
});
test('retrying and unbookmarking under active progress filters preserve ordered navigation',() => {
  const h = createApp({progress:{q2:marked(),q4:marked(),q6:marked()}}); h.filter('status','correct'); h.app.selectQuestion('q4'); h.click('retry-question');
  assert.equal(h.app.state.currentId,'q4'); h.click('next-question'); assert.equal(h.app.state.currentId,'q6'); h.click('previous-question'); assert.equal(h.app.state.currentId,'q2');
  const b = createApp({progress:{q2:{bookmarked:true},q4:{bookmarked:true},q6:{bookmarked:true}}}); b.filter('status','bookmarked'); b.app.selectQuestion('q4'); b.click('bookmark-question');
  b.click('previous-question'); assert.equal(b.app.state.currentId,'q2'); b.app.selectQuestion('q4'); b.click('next-question'); assert.equal(b.app.state.currentId,'q6');
  const one = createApp({progress:{q4:{bookmarked:true},q6:{bookmarked:true}}}); one.filter('status','bookmarked'); one.app.selectQuestion('q4'); one.click('bookmark-question'); one.click('random-question'); assert.equal(one.app.state.currentId,'q6');
});
test('malformed saved records cannot create false attempts, invalid answers or wrong correctness',() => {
  const h = createApp({progress:{q1:'broken',q2:{selected:'A',marked:'false',correct:true,bookmarked:'true'},q3:{selected:'Z',marked:true},q4:{selected:' a ',marked:true,correct:false,elapsedSeconds:-3},q5:marked('B'),q6:[marked()],unknown:marked()}});
  assert.equal(h.app.state.progress.q1,undefined); assert.equal(h.app.state.progress.q2.marked,false); assert.equal(h.app.state.progress.q2.bookmarked,false); assert.equal(h.app.state.progress.q3.marked,false);
  assert.equal(h.app.state.progress.q4.correct,true); assert.equal(h.app.state.progress.q4.elapsedSeconds,undefined); assert.equal(h.app.state.progress.q5.correct,false); assert.equal(h.app.state.progress.q6,undefined); assert.equal(h.app.state.progress.unknown,undefined); assert.equal(h.get('attempted-count').textContent,2);
  const broken = createApp({progress:'{not json'}); assert.equal(broken.get('attempted-count').textContent,0);
});
test('resume survives denied history updates and hash navigation updates the last question',() => {
  const denied = createApp({storage:{[LAST]:'q3'},historyThrows:true}); assert.equal(denied.app.state.currentId,'q3'); denied.app.selectQuestion('q5'); assert.equal(denied.entries.get(LAST),'q5');
  const restarted = createApp({storage:Object.fromEntries(denied.entries)}); assert.equal(restarted.app.state.currentId,'q5');
  restarted.filter('topic','Algebra'); restarted.hash('#q7'); assert.equal(restarted.app.state.currentId,'q7'); assert.equal(restarted.app.state.filters.topic,'all'); assert.equal(restarted.entries.get(LAST),'q7'); assert.equal(restarted.location.hash,'#q7');
  restarted.hash('#%broken'); assert.equal(restarted.app.state.currentId,'q7');
  assert.equal(createApp({storage:{[LAST]:'q5'},hash:'#q2'}).app.state.currentId,'q2'); assert.equal(createApp({storage:{[LAST]:'deleted'}}).app.state.currentId,'q1');
});
test('attempt timer stops on marking, pauses outside practice and resets on retry',() => {
  const h = createApp(); h.advance(12000); h.choose('A'); h.click('mark-answer'); assert.equal(h.saved().q1.elapsedSeconds,12); h.advance(30000); assert.equal(h.app.elapsedSeconds(),12);
  h.click('retry-question'); assert.equal(h.app.elapsedSeconds(),0); h.advance(5000); h.app.switchView('sources'); h.advance(60000); assert.equal(h.app.elapsedSeconds(),5); h.app.switchView('practice'); h.advance(4000); assert.equal(h.app.elapsedSeconds(),9);
  h.document.hidden = true; h.document.fire('visibilitychange'); h.advance(30000); assert.equal(h.app.elapsedSeconds(),9); h.document.hidden = false; h.document.fire('visibilitychange'); h.advance(3000); assert.equal(h.app.elapsedSeconds(),12);
  h.choose('A'); h.click('mark-answer'); const resumed = createApp({storage:Object.fromEntries(h.entries)}); assert.equal(resumed.app.elapsedSeconds(),12); resumed.advance(10000); assert.equal(resumed.app.elapsedSeconds(),12);
});
test('keyboard focus survives answer/card rerenders and moves to a usable control after checking',() => {
  const h = createApp(); h.choose('B'); assert.equal(h.document.activeElement.dataset.option,'B'); h.click('mark-answer'); assert.equal(h.document.activeElement.id,'reveal-solution');
  h.click('reveal-solution'); assert.equal(h.document.activeElement.id,'reveal-solution'); h.click('retry-question'); assert.equal(h.document.activeElement.dataset.option,'A');
  h.app.selectQuestion('q7'); h.click('next-question'); assert.equal(h.app.state.currentId,'q8'); assert.equal(h.document.activeElement.id,'question-workspace');
  assert.equal(h.get('question-workspace').getAttribute('tabindex'),'-1');
});
test('reset cancellation preserves progress and confirmation clears the attempt and timer',() => {
  const h = createApp(); h.advance(7000); h.choose('A'); h.click('mark-answer'); h.window.confirm = () => false; h.click('reset-progress'); assert.equal(h.get('attempted-count').textContent,1);
  h.window.confirm = () => true; h.click('reset-progress'); assert.equal(h.get('attempted-count').textContent,0); assert.equal(h.app.elapsedSeconds(),0); assert.equal(Object.keys(h.saved()).length,0);
});
test('all available option letters work and denied storage leaves the session usable',() => {
  const data = fixture(); data.questions[0].options = ['A','B','C','D','E','F','G','H']; data.questions[0].answer = 'H';
  const h = createApp({data,storageThrows:true}); h.choose('H'); h.click('mark-answer');
  assert.equal(h.app.state.progress.q1.correct,true); assert.match(h.get('toast').textContent,/could not save progress/); assert.equal(h.get('attempted-count').textContent,1);
  h.click('next-question'); assert.equal(h.app.state.currentId,'q2');
});

const realDataPath = path.join(root,'web','data','questions.json');
function realData() { return JSON.parse(fs.readFileSync(realDataPath,'utf8')); }
function archiveOrder(questions) { const years = ['2023','2022','2021','2020','2019','2018','2017','2016','Specimen']; const rank = (q) => years.indexOf(String(q.year)) * 100 + Number(q.paper) * 25 + Number(q.number); return [...questions].sort((a,b) => rank(a) - rank(b)); }
function expectedMatches(questions,model,filters) {
  return questions.filter((q) => {
    const r = model[q.id] || {}, status = r.marked ? r.selected === q.answer ? 'correct' : 'incorrect' : 'unattempted';
    if (filters.paper !== 'all' && String(q.paper) !== filters.paper || filters.year !== 'all' && String(q.year) !== filters.year || filters.topic !== 'all' && q.topic !== filters.topic) return false;
    if (filters.status === 'bookmarked' ? !r.bookmarked : filters.status !== 'all' && status !== filters.status) return false;
    const query = filters.search.trim().toLowerCase();
    return !query || [q.text,q.id,q.year,`paper ${q.paper}`,`question ${q.number}`,q.topic,...(q.tags || [])].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}
function ids(questions) { return [...questions].map((q) => q.id).join('|'); }
function seeded(seed) { let state = seed >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; }

test('REAL archive: every option on all 360 questions is marked against its answer key',() => {
  const data = realData(), ordered = archiveOrder(data.questions), h = createApp({data});
  assert.equal(ordered.length,360); assert.equal(data.papers.length,18);
  let checks = 0, correct = 0, incorrect = 0;
  for (const q of ordered) {
    h.app.selectQuestion(q.id);
    const rendered = h.get('question-workspace').querySelectorAll('[data-option]').map((element) => element.dataset.option);
    assert.deepEqual(rendered,q.options,`${q.id}: option buttons must match the actual archive`);
    for (const option of q.options) {
      if (h.app.state.progress[q.id]?.marked) h.click('retry-question');
      h.choose(option); h.click('mark-answer'); checks++;
      const expectedCorrect = option === q.answer, record = h.app.state.progress[q.id];
      assert.equal(record.selected,option,`${q.id} option ${option}`); assert.equal(record.marked,true); assert.equal(record.correct,expectedCorrect,`${q.id} option ${option}`);
      assert.match(h.get('question-workspace').innerHTML,expectedCorrect ? /<strong>Correct\.<\/strong>/ : /<strong>Incorrect\.<\/strong>/);
      const right = h.get('question-workspace').querySelectorAll('[data-option]').filter((element) => element.classList.contains('right'));
      assert.equal(right.length,1); assert.equal(right[0].dataset.option,q.answer);
      for (const button of h.get('question-workspace').querySelectorAll('[data-option]')) assert.equal(button.disabled,true);
      expectedCorrect ? correct++ : incorrect++;
    }
    h.click('reveal-solution');
    for (const region of q.images.concat(q.solutionImages)) assert.ok(h.get('question-workspace').innerHTML.includes(`${region.pdf}#page=${region.page}`),`${q.id}: missing original PDF region reference`);
    assert.match(h.get('question-workspace').innerHTML,/Worked solution/);
  }
  assert.equal(checks,2285); assert.equal(correct,360); assert.equal(incorrect,1925); assert.equal(h.get('attempted-count').textContent,360);
  const restarted = createApp({data:realData(),storage:h.entries});
  for (const q of ordered) { const r = restarted.app.state.progress[q.id]; assert.equal(r.selected,q.options.at(-1)); assert.equal(r.marked,true); assert.equal(r.correct,q.options.at(-1) === q.answer); }
});
test('REAL archive: all 1,950 paper/year/topic/status combinations match an independent model',() => {
  const data = realData(), ordered = archiveOrder(data.questions), model = {};
  ordered.forEach((q,i) => { model[q.id] = {selected:i % 3 === 0 ? q.answer : q.options.find((o) => o !== q.answer),marked:i % 3 !== 2,bookmarked:i % 5 === 0}; });
  const h = createApp({data,progress:model}), years = ['all',...[...new Set(ordered.map((q) => q.year))]], topics = ['all',...[...new Set(ordered.map((q) => q.topic))]];
  let combinations = 0;
  for (const paper of ['all','1','2']) for (const year of years) for (const topic of topics) for (const status of ['all','unattempted','correct','incorrect','bookmarked']) {
    h.app.state.filters = {paper,year,topic,status,search:''}; h.app.applyFilters();
    const expected = expectedMatches(ordered,model,h.app.state.filters);
    assert.equal(ids(h.app.filteredQuestions()),ids(expected),JSON.stringify(h.app.state.filters)); assert.equal(h.get('result-count').textContent,expected.length);
    if (!expected.length) { assert.equal(h.app.state.currentId,null); assert.equal(h.get('empty-state').hidden,false); }
    else assert.ok(expected.some((q) => q.id === h.app.state.currentId));
    combinations++;
  }
  assert.equal(combinations,1950);
});
test('REAL archive: seeded 600-action practice/filter/search/bookmark/navigation sequence',() => {
  const random = seeded(0x5eed0029), data = realData(), ordered = archiveOrder(data.questions), model = {}, h = createApp({data,random});
  const choose = (values) => values[Math.floor(random() * values.length)], statuses = ['all','unattempted','correct','incorrect','bookmarked'];
  const used = new Set();
  for (let step = 0; step < 600; step++) {
    const action = Math.floor(random() * 10); used.add(action);
    let q = ordered.find((item) => item.id === h.app.state.currentId);
    if (!q && action < 6) { h.click('clear-filters'); q = ordered[0]; h.app.selectQuestion(q.id); }
    if (action === 0 && !model[q.id]?.marked) { const selected = choose(q.options); h.choose(selected); model[q.id] = {...model[q.id],selected,marked:false}; }
    if (action === 1 && model[q.id]?.selected && !model[q.id]?.marked) { h.click('mark-answer'); model[q.id].marked = true; }
    if (action === 2 && model[q.id]?.marked) { h.click('retry-question'); model[q.id] = {...model[q.id],selected:'',marked:false}; }
    if (action === 3) { h.click('bookmark-question'); model[q.id] = {...model[q.id],bookmarked:!model[q.id]?.bookmarked}; }
    if (action === 4 || action === 5) {
      const direction = action === 4 ? 1 : -1, position = ordered.findIndex((item) => item.id === q.id), matching = expectedMatches(ordered,model,h.app.state.filters), adjacent = direction > 0 ? matching.find((item) => ordered.indexOf(item) > position) : matching.filter((item) => ordered.indexOf(item) < position).at(-1), id = direction > 0 ? 'next-question' : 'previous-question';
      assert.equal(h.get(id).disabled,!adjacent,`seed 0x5eed0029 step ${step}`); if (adjacent) { h.click(id); assert.equal(h.app.state.currentId,adjacent.id); }
    }
    if (action === 6) h.paper(choose(['all','1','2']));
    if (action === 7) h.filter('year',choose(['all',...new Set(ordered.map((item) => item.year))]));
    if (action === 8) { h.filter('topic',choose(['all',...new Set(ordered.map((item) => item.topic))])); h.filter('status',choose(statuses)); }
    if (action === 9) h.search(choose(['', '  PAPER 2 ', '2019', 'question 20', 'polynomial', 'impossible-search-zz', ordered[Math.floor(random() * ordered.length)].id]));
    const expected = expectedMatches(ordered,model,h.app.state.filters);
    assert.equal(ids(h.app.filteredQuestions()),ids(expected),`seed 0x5eed0029 step ${step}, action ${action}`);
    assert.equal(h.get('attempted-count').textContent,Object.values(model).filter((r) => r.marked).length);
    for (const [id,r] of Object.entries(model)) { const actual = h.app.state.progress[id]; assert.equal(Boolean(actual?.marked),Boolean(r.marked)); assert.equal(Boolean(actual?.bookmarked),Boolean(r.bookmarked)); assert.equal(actual?.selected || '',r.selected || ''); }
  }
  assert.equal(used.size,10);
  const restarted = createApp({data:realData(),storage:h.entries});
  for (const [id,r] of Object.entries(model)) { assert.equal(Boolean(restarted.app.state.progress[id]?.marked),Boolean(r.marked)); assert.equal(Boolean(restarted.app.state.progress[id]?.bookmarked),Boolean(r.bookmarked)); }
});
test('two stale windows retain independent questions and same-question attempt/bookmark edits',() => {
  const shared = new Map(), a = createApp({storage:shared}), b = createApp({storage:shared});
  a.choose('A'); a.click('mark-answer'); b.app.selectQuestion('q2'); b.choose('B'); b.click('mark-answer');
  let reopened = createApp({storage:shared}); assert.equal(reopened.app.state.progress.q1.correct,true); assert.equal(reopened.app.state.progress.q2.correct,false);
  a.app.selectQuestion('q3'); b.app.selectQuestion('q3'); a.choose('A'); b.click('bookmark-question'); a.click('mark-answer');
  reopened = createApp({storage:shared}); assert.equal(reopened.app.state.progress.q3.marked,true); assert.equal(reopened.app.state.progress.q3.bookmarked,true);
  b.fireWindow('storage',{key:`${ATTEMPT}legacy:q3`}); assert.equal(b.app.state.progress.q3.correct,true); assert.equal(b.get('attempted-count').textContent,3); b.advance(5000); assert.equal(b.app.elapsedSeconds(),0);
});
test('reset generation prevents stale windows from resurrecting old attempts or bookmarks',() => {
  const shared = new Map([[STORAGE,JSON.stringify({q1:marked('A',true),q2:marked('B',true)})]]), a = createApp({storage:shared}), b = createApp({storage:shared});
  a.click('reset-progress'); b.app.selectQuestion('q3'); b.click('bookmark-question');
  const reopened = createApp({storage:shared}); assert.equal(reopened.app.state.progress.q1,undefined); assert.equal(reopened.app.state.progress.q2,undefined); assert.equal(reopened.app.state.progress.q3.bookmarked,true); assert.equal(reopened.app.state.progress.q3.marked,false);
  a.fireWindow('storage',{key:RESET}); assert.equal(a.app.state.progress.q3.bookmarked,true);
  shared.clear(); b.fireWindow('storage',{key:null}); assert.equal(Object.keys(b.app.state.progress).length,0); assert.equal(b.get('attempted-count').textContent,0);
});
test('pending writes survive temporary storage errors and recover without restoring a reset generation',() => {
  let unavailable = true;
  const h = createApp({progress:{q4:marked()},storageThrows:() => unavailable}); h.choose('A'); h.click('mark-answer'); h.click('bookmark-question'); h.app.selectQuestion('q2'); h.choose('B');
  unavailable = false; h.app.selectQuestion('q3'); h.choose('C');
  let reopened = createApp({storage:h.entries}); assert.equal(reopened.app.state.progress.q1.correct,true); assert.equal(reopened.app.state.progress.q1.bookmarked,true); assert.equal(reopened.app.state.progress.q2.selected,'B');
  unavailable = true; h.click('reset-progress'); h.choose('D'); unavailable = false; h.click('bookmark-question');
  reopened = createApp({storage:h.entries}); assert.equal(reopened.app.state.progress.q1,undefined); assert.equal(reopened.app.state.progress.q4,undefined); assert.equal(reopened.app.state.progress.q3.selected,'D'); assert.equal(reopened.app.state.progress.q3.bookmarked,true);
  const readsDenied = createApp({storageReadThrows:true}); readsDenied.choose('A'); readsDenied.click('mark-answer'); assert.equal(readsDenied.app.state.progress.q1.correct,true);
});
test('corrupted v2 entries are isolated and startup errors show a recoverable error view',() => {
  const shared = new Map([[STORAGE,JSON.stringify({q1:marked(),q2:marked()})],[`${ATTEMPT}legacy:q1`,'{broken'],[`${BOOKMARK}legacy:q2`,'"true"']]);
  const h = createApp({storage:shared}); assert.equal(h.app.state.progress.q1.marked,false); assert.equal(h.app.state.progress.q2.marked,true); assert.equal(h.app.state.progress.q2.bookmarked,false);
  for (const data of [{papers:[],questions:[]},{papers:[],questions:[{id:'duplicate'},{id:'duplicate'}]},null]) {
    const invalid = createApp({data,allowError:true}); assert.equal(invalid.get('error').hidden,false); assert.equal(invalid.get('loading').hidden,true); assert.ok(invalid.get('error-detail').textContent.length > 0);
  }
});


test('first-run download is explicit, progress updates, failure retries and success reloads',() => {
  const h = createApp({contentReady:false});
  assert.equal(h.get('setup').hidden,false); assert.equal(h.get('loading').hidden,true); assert.equal(h.get('app').hidden,true); assert.equal(h.messages.length,0);
  h.click('download-papers'); assert.equal(h.messages.length,1); assert.equal(h.messages[0].type,'download-papers'); assert.equal(h.get('download-papers').disabled,true);
  h.window.tmuaDownloadProgress({state:'downloading',completed:12,total:45,message:'Downloaded 12 of 45'});
  assert.equal(h.get('download-progress').value,12); assert.equal(h.get('download-progress').max,45); assert.equal(h.get('download-status').textContent,'Downloaded 12 of 45');
  h.window.tmuaDownloadProgress({state:'error',completed:12,total:45,message:'Connection unavailable'}); assert.equal(h.get('download-papers').disabled,false); assert.equal(h.get('download-papers').textContent,'Retry download');
  h.click('download-papers'); assert.equal(h.messages.length,2);
  h.window.tmuaDownloadProgress({state:'complete',completed:45,total:45,message:'Ready'}); assert.equal(h.location.reloads,1);
});

test('browser with zero local PDFs exposes all 360 questions through original publisher page frames',() => {
  const browser = {status:{completed:0,total:45},error:'Local storage unavailable',repository:{sources:[]},hasPdf:() => false,sourceUrl:(url) => 'https://publisher.invalid/'+url.split('/').pop(),rewriteLinks(){}};
  const h = createApp({data:realData(),browser});
  assert.equal(h.get('app').hidden,false); assert.equal(h.get('setup').hidden,true); assert.equal(h.get('total-count').textContent,360); assert.equal(h.app.filteredQuestions().length,360);
  assert.equal(h.get('browser-paper-bar').hidden,false); assert.match(h.get('browser-import-status').textContent,/storage unavailable/);
  const q = h.app.state.data.questions.find((item) => item.id === h.app.state.currentId);
  assert.match(h.get('question-workspace').innerHTML,/class="publisher-pdf"/); assert.ok(h.get('question-workspace').innerHTML.includes(`#page=${q.images[0].page}&amp;view=FitH`));
  assert.match(h.get('question-workspace').innerHTML,/Open original PDF/);
  assert.ok(h.get('question-workspace').innerHTML.indexOf('Open original PDF') < h.get('question-workspace').innerHTML.indexOf('<iframe'), 'Original PDF fallback must appear above the embedded viewer');
  h.click('reveal-solution'); assert.equal(h.get('question-workspace').querySelectorAll('iframe').length,q.images.length+q.solutionImages.length);
  let opened = false; h.get('paper-manager').showModal = () => {opened = true;}; h.click('manage-papers'); assert.equal(opened,true);
});

test('browser with an imported PDF uses individual crop descriptors while keeping all questions',() => {
  let rewrites = 0;
  const browser = {status:{completed:1,total:45},error:'',repository:{sources:[]},hasPdf:() => true,sourceUrl:(url) => 'https://publisher.invalid/'+url.split('/').pop(),rewriteLinks(){rewrites++;}};
  const h = createApp({data:realData(),browser});
  assert.equal(h.get('total-count').textContent,360); assert.equal(h.get('question-workspace').querySelectorAll('iframe').length,0);
  assert.match(h.get('question-workspace').innerHTML,/data-pdf-region=/); assert.ok(rewrites >= 2);
});
