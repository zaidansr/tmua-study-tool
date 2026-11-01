'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createStore,formatTime,keys} = require('../web/test-mode.js');

class Storage {
  entries = new Map(); failing = false; failResults = false; failReads = false;
  get length() { return this.entries.size; }
  key(i) { return [...this.entries.keys()][i] ?? null; }
  getItem(key) { if (this.failReads) throw new Error('Storage reads denied'); return this.entries.get(key) ?? null; }
  setItem(key,value) { if (this.failing || (this.failResults && key.startsWith(keys.RESULT))) throw new Error('Storage full'); this.entries.set(key,String(value)); }
}
const data = {papers:[{id:'2023-p1',title:'2023 · Paper 1'},{id:'2022-p2',title:'2022 · Paper 2'}],questions:['2023-p1','2022-p2'].flatMap((paperId) => Array.from({length:20},(_,i) => ({id:`${paperId}-q${i+1}`,paperId,number:i+1,options:['A','B','C','D'],answer:['A','B','C','D'][i%4]})))};
function fixture() {
  const storage = new Storage(); let clock = 1700000000000, generation = 'legacy', id = 0, warnings = 0;
  const instance = () => createStore({data,storage,now:() => clock,getGeneration:() => generation,randomId:() => `session-${++id}`,onStorageError:() => warnings++});
  return {storage,instance,advance(ms) { clock += ms; },setClock(value) { clock = value; },get clock() { return clock; },get warnings() { return warnings; },reset() { generation = 'reset-two'; }};
}

test('one selected paper owns all test navigation and only accepts available choices',() => {
  const h = fixture(), model = h.instance();
  model.start('2023-p1');
  assert.equal(model.snapshot().active.paperId,'2023-p1');
  assert.equal(model.questionsFor('2023-p1').length,20);
  assert.throws(() => model.navigate('2022-p2-q1'),/outside/);
  assert.throws(() => model.start('2022-p2'),/Finish/);
  assert.throws(() => model.answer('Z'),/available/);
  model.navigate('2023-p1-q20'); model.answer('D');
  assert.equal(model.snapshot().active.answers['2023-p1-q20'],'D');
  model.answer(''); assert.equal(model.snapshot().active.answers['2023-p1-q20'],undefined);
  assert.equal(model.snapshot().active.correct,undefined);
  assert.equal(model.snapshot().active.rows,undefined);
});

test('per-question times add across visits and a reload counts the away interval',() => {
  const h = fixture(), first = h.instance(); first.start('2023-p1');
  h.advance(4200); first.answer('A'); h.advance(800); first.navigate('2023-p1-q2');
  h.advance(2100); first.answer('C');
  h.advance(10000); const reloaded = h.instance();
  assert.equal(reloaded.snapshot().owner,false);
  reloaded.takeOver(); h.advance(3000); reloaded.navigate('2023-p1-q1'); h.advance(1000);
  const result = reloaded.finish();
  assert.equal(result.elapsedSeconds,21);
  assert.equal(result.rows[0].elapsedMs,6000);
  assert.equal(result.rows[1].elapsedMs,15100);
  assert.equal(result.rows.reduce((sum,r) => sum+r.elapsedMs,0),result.completedAt-result.startedAt);
  assert.equal(result.rows[0].outcome,'correct'); assert.equal(result.rows[1].outcome,'incorrect');
});

test('submission marks the whole paper with correct, incorrect and unanswered rows',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1');
  model.answer('A'); model.navigate('2023-p1-q2'); model.answer('D');
  h.advance(15000); const result = model.finish();
  assert.equal(result.rows.length,20); assert.equal(result.correct,1); assert.equal(result.incorrect,1); assert.equal(result.unanswered,18);
  assert.equal(result.rows[1].answer,'B'); assert.equal(model.snapshot().active,null);
  const entries = model.entries(result.id); assert.equal(entries.length,20);
  assert.equal(entries[0].id,`test-${result.id}-2023-p1-q1`); assert.equal(entries[0].mode,'test'); assert.equal(entries[0].testId,result.id);
  assert.equal(entries[2].selected,''); assert.equal(entries[0].completedAt,new Date(result.completedAt).toISOString());
  assert.throws(() => model.finish(),/No test/);
  const reloaded = h.instance(); assert.equal(reloaded.history().length,1); assert.deepEqual(reloaded.summary(result.id),result);
  model.start('2022-p2'); assert.notEqual(model.snapshot().active.id,result.id);
});

test('expiry submits exactly at the deadline, including unanswered questions',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1',60); model.answer('B');
  h.advance(120000); const state = model.tick();
  assert.equal(state.finished.reason,'expired'); assert.equal(state.finished.elapsedSeconds,60);
  assert.equal(state.finished.rows[0].elapsedMs,60000); assert.equal(state.finished.incorrect,1); assert.equal(state.finished.unanswered,19);
  assert.equal(model.history().length,1); assert.equal(model.tick().active,null);
  assert.throws(() => model.answer('A'),/No test/);
});

test('a reloaded or second tab cannot overwrite the current owner without takeover',() => {
  const h = fixture(), first = h.instance(); first.start('2023-p1'); first.answer('A');
  const second = h.instance(); assert.equal(second.snapshot().owner,false);
  assert.throws(() => second.answer('B'),/another tab/);
  second.takeOver(); second.navigate('2023-p1-q2'); second.answer('B');
  assert.throws(() => first.answer('D'),/another tab/);
  assert.equal(first.snapshot().active.answers['2023-p1-q1'],'A');
  assert.equal(first.snapshot().active.answers['2023-p1-q2'],'B');
  h.advance(9000); const third = h.instance(); third.tick();
  assert.equal(third.snapshot().owner,true); assert.throws(() => second.answer('D'),/another tab/);
});

test('malformed sessions cannot switch papers, extend duration or manufacture valid tests',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1');
  const key = keys.ACTIVE+'legacy', valid = JSON.parse(h.storage.getItem(key));
  for (const changed of [{paperId:'missing'},{currentId:'2022-p2-q1'},{durationSeconds:0},{deadlineAt:valid.deadlineAt+1},{id:'../../bad'},{viewSince:valid.startedAt-1},{ownerId:''}]) {
    h.storage.setItem(key,JSON.stringify({...valid,...changed})); assert.equal(h.instance().snapshot().active,null);
  }
  h.storage.setItem(key,'{broken'); assert.equal(h.instance().snapshot().active,null);
  assert.throws(() => h.instance().start('missing'),/available/);
  for (const duration of [0,59,21601,NaN,Infinity,61.5]) assert.throws(() => h.instance().start('2023-p1',duration),/duration/);
});

test('stored correctness and invalid choices are recomputed from the official metadata',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1'); model.answer('C'); const result = model.finish();
  const key = keys.RESULT+'legacy:'+result.id, raw = JSON.parse(h.storage.getItem(key));
  raw.correct = 20; raw.rows = [{correct:true}]; raw.answers['2023-p1-q2']='Z'; raw.answers['other-q1']='A'; raw.timesMs['2023-p1-q1']=-100;
  h.storage.setItem(key,JSON.stringify(raw));
  const reread = h.instance().history()[0]; assert.equal(reread.correct,0); assert.equal(reread.incorrect,1); assert.equal(reread.unanswered,19);
  assert.equal(reread.rows[1].selected,''); assert.equal(reread.rows[0].elapsedMs,0);
});

test('temporary write failures retain the current attempt and recover safely',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1');
  h.storage.failing = true; h.advance(2000); model.answer('B'); h.advance(3000); model.navigate('2023-p1-q2'); model.answer('B');
  assert.ok(h.warnings > 0); assert.equal(model.snapshot().active.answers['2023-p1-q1'],'B');
  h.storage.failing = false; model.tick();
  const restored = h.instance(); restored.takeOver(); const result = restored.finish();
  assert.equal(result.rows[0].selected,'B'); assert.equal(result.rows[1].selected,'B'); assert.equal(result.rows[0].elapsedMs,5000);
});

test('pending writes do not reclaim a test taken over by another tab',() => {
  const h = fixture(), first = h.instance(); first.start('2023-p1');
  h.storage.failing = true; first.answer('C'); h.storage.failing = false;
  const second = h.instance(); second.takeOver(); second.answer('B');
  first.refresh(); assert.equal(first.snapshot().owner,false); assert.equal(first.snapshot().active.answers['2023-p1-q1'],'B');
  assert.throws(() => first.answer('D'),/another tab/);
});

test('temporary denied storage reads keep the running session locked and usable',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1');
  h.storage.failReads = true; h.advance(4000); model.tick(); assert.equal(model.snapshot().active.paperId,'2023-p1');
  model.answer('A'); model.navigate('2023-p1-q2'); assert.equal(model.snapshot().active.answers['2023-p1-q1'],'A');
  h.storage.failReads = false; const restored = h.instance(); restored.takeOver(); assert.equal(restored.snapshot().active.currentId,'2023-p1-q2');
  assert.ok(h.warnings > 0);
});

test('completion survives temporary storage failure and is replayable after recovery',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1'); model.answer('A');
  h.storage.failing = true; const result = model.finish(); assert.equal(result.correct,1); assert.equal(model.history().length,1);
  h.storage.failing = false; model.refresh();
  const reloaded = h.instance(); assert.equal(reloaded.history().length,1); assert.equal(reloaded.summary(result.id).correct,1); assert.equal(reloaded.snapshot().active,null);
});

test('a completed recovery marker survives repeated reloads while only new history keys fail',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1'); model.answer('A');
  h.storage.failResults = true; const result = model.finish();
  assert.equal(JSON.parse(h.storage.getItem(keys.ACTIVE+'legacy')).finished.id,result.id);
  for (let i=0;i<3;i++) {
    const reload = h.instance(); assert.equal(reload.history().length,1); assert.equal(reload.snapshot().active,null);
    assert.equal(JSON.parse(h.storage.getItem(keys.ACTIVE+'legacy')).finished.id,result.id);
    assert.throws(() => reload.start('2022-p2'),/previous test has not been saved/);
  }
  h.storage.failResults = false; const recovered = h.instance(); assert.equal(recovered.history().length,1);
  assert.equal(JSON.parse(h.storage.getItem(keys.ACTIVE+'legacy')),null); assert.equal(recovered.summary(result.id).correct,1);
});

test('a restored orphan session expires through tick without an explicit takeover',() => {
  const h = fixture(), first = h.instance(); first.start('2023-p1',60); first.answer('A');
  h.advance(65000); const restored = h.instance(); assert.equal(restored.snapshot().owner,false);
  const expired = restored.tick().finished; assert.equal(expired.reason,'expired'); assert.equal(expired.correct,1); assert.equal(expired.elapsedSeconds,60);
  assert.equal(restored.snapshot().active,null); assert.equal(restored.history().length,1);
});

test('a reset generation removes both active tests and history without stale resurrection',() => {
  const h = fixture(), old = h.instance(); old.start('2023-p1'); old.answer('A'); old.finish(); old.start('2022-p2');
  h.storage.failing = true; old.answer('C'); h.reset(); h.storage.failing = false;
  assert.equal(old.refresh().active,null); assert.equal(old.history().length,0);
  assert.equal(h.instance().history().length,0); old.start('2023-p1'); assert.equal(old.snapshot().active.paperId,'2023-p1');
});

test('timer output remains monotonic if the device clock moves backwards',() => {
  const h = fixture(), model = h.instance(); model.start('2023-p1',60); const started = h.clock;
  h.advance(9000); model.tick(); assert.equal(model.snapshot().remainingSeconds,51);
  h.setClock(started+4000); model.tick(); assert.equal(model.snapshot().remainingSeconds,51); assert.equal(model.snapshot().elapsedSeconds,9);
  assert.equal(formatTime(75*60),'75:00'); assert.equal(formatTime(0),'00:00'); assert.equal(formatTime(3661),'61:01');
});
