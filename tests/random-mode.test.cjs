'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {create,PREFIX,SETTINGS_KEY,RESET_KEY} = require('../web/random-mode.js');

class Storage {
  constructor(entries = new Map()) { this.entries = entries; this.failReads = false; this.failWrites = false; }
  get length() { if (this.failReads) throw new Error('Reads unavailable'); return this.entries.size; }
  key(i) { if (this.failReads) throw new Error('Reads unavailable'); return [...this.entries.keys()][i] ?? null; }
  getItem(key) { if (this.failReads) throw new Error('Reads unavailable'); return this.entries.get(key) ?? null; }
  setItem(key,value) { if (this.failWrites) throw new Error('Writes unavailable'); this.entries.set(key,String(value)); }
}
const START = Date.parse('2026-11-01T08:00:00Z'), MINUTE = 60000, IDS = ['q1','q2','q3','q4'];
function setup({storage = new Storage(),getGeneration,random = () => 0} = {}) {
  let clock = START; const errors = [];
  const scheduler = create({storage,getGeneration,random,now:() => clock,getQuestion:(id) => IDS.includes(id) ? {id} : undefined,onStorageError:(error) => errors.push(error.message)});
  return {scheduler,storage,errors,now:() => clock,advance:(ms) => { clock += ms; },record:(id,correct,questionId = 'q1') => scheduler.record({id,questionId,correct})};
}
const eventKey = (generation,qid,id) => `${PREFIX}${generation}:${encodeURIComponent(qid)}:${encodeURIComponent(id)}`;

test('wrong answer waits exactly eight minutes and due reviews take priority over random new questions',() => {
  const h = setup({random:() => 0.99});
  const entry = h.record('first',false);
  assert.equal(entry.status,'review'); assert.equal(entry.hadWrong,true); assert.equal(entry.dueAt,START+8*MINUTE);
  assert.equal(h.scheduler.next(IDS),'q4');
  assert.deepEqual(h.scheduler.summary(IDS),{due:0,pending:1,fresh:3,nextDueAt:START+8*MINUTE,completed:0});
  h.advance(8*MINUTE-1); assert.equal(h.scheduler.next(['q1']),null);
  h.advance(1); assert.equal(h.scheduler.next(IDS),'q1');
  assert.deepEqual(h.scheduler.summary(IDS),{due:1,pending:0,fresh:3,nextDueAt:START+8*MINUTE,completed:0});
});

test('correct retry moves to twenty minutes; later correct reviews keep twenty-minute spacing',() => {
  const h = setup(); h.record('wrong',false); h.advance(8*MINUTE);
  const retry = h.record('correct-retry',true);
  assert.equal(retry.dueAt,START+28*MINUTE); assert.equal(retry.status,'review');
  h.advance(20*MINUTE-1); assert.equal(h.scheduler.next(['q1']),null);
  h.advance(1); assert.equal(h.scheduler.next(IDS),'q1');
  const next = h.record('next-correct',true); assert.equal(next.dueAt,h.now()+20*MINUTE);
});

test('another wrong answer resets the wait to eight minutes even after a successful review',() => {
  const h = setup(); h.record('wrong',false); h.advance(8*MINUTE); h.record('right',true);
  h.advance(20*MINUTE); const failed = h.record('wrong-again',false);
  assert.equal(failed.correct,false); assert.equal(failed.dueAt,h.now()+8*MINUTE);
  h.advance(8*MINUTE-1); assert.equal(h.scheduler.next(['q1']),null);
  h.advance(1); assert.equal(h.scheduler.next(['q1']),'q1');
});

test('a first-try correct question is completed and cannot be chosen as an early random repeat',() => {
  const h = setup(); const right = h.record('right',true);
  assert.equal(right.status,'completed'); assert.equal(right.hadWrong,false); assert.equal(right.dueAt,null);
  assert.equal(h.scheduler.next(['q1']),null); assert.equal(h.scheduler.next(IDS),'q2');
  h.advance(20000*MINUTE); assert.equal(h.scheduler.next(['q1']),null);
  assert.equal(h.scheduler.summary(IDS).completed,1);
});

test('the same attempt ID is immutable and replaying it cannot postpone a review',() => {
  const h = setup(); const first = h.record('stable',false); h.advance(3*MINUTE);
  assert.deepEqual(h.record('stable',true),first);
  assert.equal(h.storage.entries.size,1);
  const reopened = setup({storage:h.storage}); reopened.advance(6*MINUTE);
  assert.deepEqual(reopened.record('stable',true),first);
  assert.equal(reopened.scheduler.get('q1').dueAt,START+8*MINUTE);
});

test('out-of-order events derive the latest deadline while preserving earlier incorrect history',() => {
  const h = setup();
  h.scheduler.record({id:'later-right',questionId:'q1',correct:true,completedAt:START+12*MINUTE});
  assert.equal(h.scheduler.get('q1').status,'completed');
  h.scheduler.record({id:'older-wrong',questionId:'q1',correct:false,completedAt:START});
  const result = h.scheduler.get('q1'); assert.equal(result.id,'later-right'); assert.equal(result.correct,true);
  assert.equal(result.hadWrong,true); assert.equal(result.dueAt,START+32*MINUTE);
  h.scheduler.record({id:'latest-wrong',questionId:'q1',correct:false,completedAt:START+33*MINUTE});
  assert.equal(h.scheduler.get('q1').dueAt,START+41*MINUTE);
});

test('overdue reviews use oldest deadlines first and only avoid the current question when another review is due',() => {
  const h = setup(); h.record('q1-wrong',false); h.advance(MINUTE); h.record('q2-wrong',false,'q2');
  h.advance(8*MINUTE);
  assert.equal(h.scheduler.next(IDS),'q1');
  assert.equal(h.scheduler.next(IDS,{excludeId:'q1'}),'q2');
  assert.equal(h.scheduler.next(['q1'],{excludeId:'q1'}),'q1');
  assert.equal(h.scheduler.next(['q3'],{excludeId:'q3'}),null);
});

test('settings persist and recalculate existing deadlines from the original completion time',() => {
  const h = setup(); h.record('wrong',false); h.advance(2*MINUTE);
  assert.deepEqual(h.scheduler.saveSettings({wrongMinutes:3,correctMinutes:25}),{wrongMinutes:3,correctMinutes:25});
  assert.equal(h.scheduler.get('q1').dueAt,START+3*MINUTE);
  h.advance(MINUTE); h.record('right',true);
  assert.equal(h.scheduler.get('q1').dueAt,START+28*MINUTE);
  h.scheduler.saveSettings({wrongMinutes:5,correctMinutes:10});
  assert.equal(h.scheduler.get('q1').dueAt,START+13*MINUTE);
  const reopened = setup({storage:h.storage});
  assert.deepEqual(reopened.scheduler.settings(),{wrongMinutes:5,correctMinutes:10});
  assert.equal(reopened.scheduler.get('q1').dueAt,START+13*MINUTE);
});

test('interval validation rejects malformed, fractional and out-of-range values without changing settings',() => {
  const h = setup();
  for (const value of [null,[],{}, {wrongMinutes:0,correctMinutes:20},{wrongMinutes:1.5,correctMinutes:20},{wrongMinutes:'8',correctMinutes:20},{wrongMinutes:8,correctMinutes:1441},{wrongMinutes:8,correctMinutes:NaN}]) {
    assert.equal(h.scheduler.saveSettings(value),false);
    assert.deepEqual(h.scheduler.settings(),{wrongMinutes:8,correctMinutes:20});
  }
  assert.deepEqual(h.scheduler.saveSettings({wrongMinutes:1,correctMinutes:1440}),{wrongMinutes:1,correctMinutes:1440});
});

test('reopening retains exact deadlines and never exposes pending questions as random fresh ones',() => {
  const h = setup(); h.record('q1-wrong',false); h.record('q2-right',true,'q2');
  const reopened = setup({storage:h.storage}); reopened.advance(7*MINUTE);
  assert.equal(reopened.scheduler.next(['q1','q2']),null);
  assert.equal(reopened.scheduler.next(IDS),'q3');
  reopened.advance(MINUTE); assert.equal(reopened.scheduler.next(IDS),'q1');
});

test('two tabs preserve independent attempts and notice same-question results and settings from another tab',() => {
  const storage = new Storage(), a = setup({storage}), b = setup({storage});
  a.record('a-wrong',false); b.advance(8*MINUTE); b.record('b-right',true); a.record('a-q2',false,'q2');
  assert.equal(a.scheduler.get('q1').dueAt,START+28*MINUTE); assert.equal(b.scheduler.get('q2').dueAt,START+8*MINUTE);
  assert.equal(storage.entries.size,3);
  b.scheduler.saveSettings({wrongMinutes:4,correctMinutes:30}); a.scheduler.refresh();
  assert.equal(a.scheduler.get('q1').dueAt,START+38*MINUTE); assert.equal(a.scheduler.get('q2').dueAt,START+4*MINUTE);
});

test('generation reset discards failed pending writes and prevents stale-generation results resurfacing',() => {
  const storage = new Storage(), a = setup({storage}), b = setup({storage});
  a.scheduler.saveSettings({wrongMinutes:6,correctMinutes:18}); a.record('persisted',false);
  storage.failWrites = true; b.record('pending',false,'q2');
  storage.failWrites = false; storage.setItem(RESET_KEY,'new-generation');
  a.scheduler.reset(); b.scheduler.refresh();
  assert.deepEqual(a.scheduler.summary(IDS),{due:0,pending:0,fresh:4,nextDueAt:null,completed:0});
  assert.equal(storage.entries.has(eventKey('legacy','q2','pending')),false);
  assert.deepEqual(a.scheduler.settings(),{wrongMinutes:6,correctMinutes:18});
  b.record('new',false,'q2'); assert.equal(a.scheduler.get('q2').id,'new'); assert.equal(a.scheduler.get('q1'),undefined);
});

test('caller-controlled reset remains isolated even when durable storage is unavailable',() => {
  let generation = 'legacy'; const h = setup({getGeneration:() => generation});
  h.storage.failWrites = true; h.record('old',false); generation = 'new-generation'; h.scheduler.reset();
  assert.equal(h.scheduler.get('q1'),undefined); h.record('new',true,'q2');
  h.storage.failWrites = false; h.scheduler.refresh();
  assert.equal(h.storage.entries.has(eventKey('legacy','q1','old')),false);
  assert.equal(h.storage.entries.has(eventKey('new-generation','q2','new')),true);
});

test('denied writes retain the session schedule and recover events and settings without duplicates',() => {
  const h = setup(); h.storage.failWrites = true; h.record('wrong',false);
  h.scheduler.saveSettings({wrongMinutes:4,correctMinutes:15});
  assert.equal(h.scheduler.get('q1').dueAt,START+4*MINUTE); assert.ok(h.errors.length>0);
  h.storage.failWrites = false; h.scheduler.refresh();
  const reopened = setup({storage:h.storage}); assert.equal(reopened.scheduler.get('q1').dueAt,START+4*MINUTE);
  assert.deepEqual(reopened.scheduler.settings(),{wrongMinutes:4,correctMinutes:15});
  assert.equal(h.storage.entries.size,2);
});

test('temporary denied reads preserve cached schedules and settings then discover later updates on recovery',() => {
  const h = setup(); h.scheduler.saveSettings({wrongMinutes:4,correctMinutes:15}); h.record('wrong',false);
  h.storage.failReads = true;
  assert.equal(h.scheduler.get('q1').dueAt,START+4*MINUTE); assert.equal(h.scheduler.next(['q1']),null);
  assert.deepEqual(h.scheduler.settings(),{wrongMinutes:4,correctMinutes:15});
  h.storage.failReads = false;
  const other = setup({storage:h.storage}); other.advance(4*MINUTE); other.record('right',true);
  h.scheduler.refresh(); assert.equal(h.scheduler.get('q1').dueAt,START+19*MINUTE);
});

test('damaged, mismatched and unknown saved events and invalid settings cannot create phantom reviews',() => {
  const h = setup();
  const valid = {version:1,id:'ok',questionId:'q1',correct:false,completedAt:new Date(START).toISOString()};
  const invalid = ['{broken',JSON.stringify({...valid,correct:'false'}),JSON.stringify({...valid,questionId:'unknown'}),JSON.stringify({...valid,completedAt:'bad'}),JSON.stringify({...valid,version:2})];
  invalid.forEach((value,i) => h.storage.setItem(eventKey('legacy','q1','bad-'+i),value));
  h.storage.setItem(eventKey('legacy','q2','ok'),JSON.stringify(valid));
  h.storage.setItem(SETTINGS_KEY,'{"version":1,"wrongMinutes":0,"correctMinutes":20}');
  assert.deepEqual(h.scheduler.settings(),{wrongMinutes:8,correctMinutes:20});
  assert.equal(h.scheduler.get('q1'),undefined); assert.equal(h.scheduler.summary(IDS).fresh,4);
  for (const raw of [null,{}, {id:'x',questionId:'unknown',correct:false},{id:'x',questionId:'q1',correct:0},{id:'x',questionId:'q1',correct:true,completedAt:'bad'}]) assert.equal(h.scheduler.record(raw),undefined);
  h.record('valid',false); assert.equal(h.scheduler.get('q1').dueAt,START+8*MINUTE);
});

test('eligible IDs are deduplicated and random selection safely handles invalid randomness and empty pools',() => {
  for (const random of [() => NaN,() => -1,() => { throw new Error('random failed'); }]) {
    const h = setup({random}); assert.equal(h.scheduler.next(['unknown','q1','q1','q2']),'q1');
    assert.deepEqual(h.scheduler.summary(['unknown','q1','q1','q2']),{due:0,pending:0,fresh:2,nextDueAt:null,completed:0});
  }
  const h = setup({random:() => 1}); assert.equal(h.scheduler.next(IDS),'q4');
  assert.equal(h.scheduler.next([]),null); assert.equal(h.scheduler.next(null),null);
  assert.equal(h.scheduler.isStorageKey(PREFIX+'legacy:q1:event'),true); assert.equal(h.scheduler.isStorageKey(SETTINGS_KEY),true);
  assert.equal(h.scheduler.isStorageKey(null),true); assert.equal(h.scheduler.isStorageKey('other-app'),false);
});
