'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {create,PREFIX,RESET_KEY} = require('../web/memory.js');

class Storage {
  constructor(entries = new Map()) { this.entries = entries; this.failReads = false; this.failWrites = false; }
  get length() { if (this.failReads) throw new Error('No storage reads'); return this.entries.size; }
  key(index) { if (this.failReads) throw new Error('No storage reads'); return [...this.entries.keys()][index] ?? null; }
  getItem(key) { if (this.failReads) throw new Error('No storage reads'); return this.entries.get(key) ?? null; }
  setItem(key,value) { if (this.failWrites) throw new Error('No storage writes'); this.entries.set(key,String(value)); }
}
const questions = [
  {id:'2023-p1-q1',answer:'A',options:['A','B','C','D']},
  {id:'2023-p1-q2',answer:'F',options:['A','B','C','D','E','F']},
];
function setup({storage = new Storage(),getGeneration,questionList = questions} = {}) {
  let clock = Date.parse('2026-11-01T08:00:00.000Z'); const errors = [];
  const memory = create({storage,getGeneration,getQuestion:(id) => questionList.find((q) => q.id === id),now:() => clock,onStorageError:(error) => errors.push(error.message)});
  return {memory,storage,errors,advance:(ms) => { clock += ms; }};
}
const entry = (id,values = {}) => ({id,questionId:questions[0].id,selected:'B',elapsedSeconds:27,mode:'practice',...values});
const storedKey = (generation,questionId,id) => `${PREFIX}${generation}:${encodeURIComponent(questionId)}:${encodeURIComponent(id)}`;

test('every completed practice try retains its own time, date and correctness after retry and reload',() => {
  const h = setup();
  h.memory.append(entry('first')); h.advance(60000); h.memory.append(entry('retry',{selected:'A',elapsedSeconds:12}));
  const records = h.memory.list(questions[0].id);
  assert.deepEqual(records.map((r) => [r.id,r.selected,r.correct,r.outcome,r.elapsedSeconds,r.mode]),[
    ['first','B',false,'wrong',27,'practice'],['retry','A',true,'correct',12,'practice'],
  ]);
  assert.equal(Date.parse(records[1].completedAt)-Date.parse(records[0].completedAt),60000);
  const restarted = setup({storage:h.storage}); assert.deepEqual(restarted.memory.list(questions[0].id),records);
  assert.equal(restarted.memory.list(questions[1].id).length,0);
});

test('the stable attempt ID makes repeated marking and test submission idempotent and immutable',() => {
  const h = setup();
  const first = h.memory.append(entry('same-id'));
  h.advance(1000);
  const duplicate = h.memory.append(entry('same-id',{selected:'A',elapsedSeconds:99}));
  assert.deepEqual(duplicate,first); assert.equal(h.memory.all().length,1);
  const otherWindow = setup({storage:h.storage});
  assert.deepEqual(otherWindow.memory.append(entry('same-id',{selected:'C',elapsedSeconds:22})),first);
  assert.equal(otherWindow.memory.all().length,1);
});

test('test submissions retain marked, wrong and unanswered rows without creating empty practice tries',() => {
  const h = setup();
  assert.equal(h.memory.append(entry('empty-practice',{selected:''})),undefined);
  assert.equal(h.memory.append(entry('bad-choice',{selected:'Z'})),undefined);
  h.memory.append(entry('test-right',{selected:'A',mode:'test',testId:'test-1',elapsedSeconds:18}));
  h.memory.append(entry('test-wrong',{mode:'test',testId:'test-1',elapsedSeconds:20}));
  h.memory.append(entry('test-blank',{selected:'',mode:'test',testId:'test-1',elapsedSeconds:0}));
  const records = h.memory.all();
  assert.deepEqual(records.map((r) => r.outcome).sort(),['correct','unanswered','wrong']);
  assert.equal(records.find((r) => r.outcome === 'unanswered').correct,false);
  assert.ok(records.every((r) => r.testId === 'test-1'));
  h.memory.append(entry('last-option',{questionId:questions[1].id,selected:'f',elapsedSeconds:5}));
  assert.equal(h.memory.list(questions[1].id)[0].correct,true);
});

test('independent windows append histories without replacing unrelated or same-question tries',() => {
  const storage = new Storage(), a = setup({storage}), b = setup({storage});
  a.memory.append(entry('a-1')); b.memory.append(entry('b-1',{selected:'A'}));
  a.memory.append(entry('a-2',{questionId:questions[1].id,selected:'F'}));
  b.memory.append(entry('b-2',{selected:'C'}));
  assert.equal(a.memory.all().length,4); assert.equal(b.memory.all().length,4);
  assert.equal(a.memory.list(questions[0].id).length,3); assert.equal(b.memory.list(questions[1].id).length,1);
  assert.equal(new Set([...storage.entries.keys()]).size,4);
});

test('legacy migration runs once, preserves unknown time/date, and never invents earlier attempts',() => {
  const h = setup();
  const old = {selected:'B',marked:true,correct:true};
  const migrated = h.memory.migrate(questions[0],old);
  assert.equal(migrated.elapsedSeconds,null); assert.equal(migrated.completedAt,null); assert.equal(migrated.correct,false);
  assert.equal(h.memory.migrate(questions[0],old),undefined);
  const restarted = setup({storage:h.storage}); assert.equal(restarted.memory.migrate(questions[0],old),undefined);
  assert.equal(restarted.memory.all().length,1);
  const dated = {selected:'F',marked:true,elapsedSeconds:41,updatedAt:'2026-10-31T12:30:00+08:00'};
  const second = h.memory.migrate(questions[1],dated);
  assert.equal(second.elapsedSeconds,41); assert.equal(second.completedAt,'2026-10-31T04:30:00.000Z');
  assert.equal(h.memory.migrate(questions[0],{selected:'A',marked:false}),undefined);
});

test('new-format latest records and questions with newer history are never duplicated by migration',() => {
  const h = setup();
  assert.equal(h.memory.migrate(questions[0],{selected:'A',marked:true,attemptId:'try-already-recorded',elapsedSeconds:2}),undefined);
  h.memory.append(entry('new-first'));
  assert.equal(h.memory.migrate(questions[0],{selected:'A',marked:true,elapsedSeconds:9}),undefined);
  assert.equal(h.memory.all().length,1);
});

test('reset generations hide old history in every window and discard failed pending writes',() => {
  const storage = new Storage(), a = setup({storage}), b = setup({storage});
  a.memory.append(entry('old-persisted'));
  storage.failWrites = true; b.memory.append(entry('old-pending'));
  assert.equal(b.memory.all().length,2);
  storage.failWrites = false; storage.setItem(RESET_KEY,'new-generation');
  assert.deepEqual(a.memory.all(),[]); assert.deepEqual(b.memory.all(),[]);
  assert.equal(storage.entries.has(storedKey('legacy',questions[0].id,'old-pending')),false);
  b.memory.append(entry('new-attempt',{selected:'A'}));
  assert.deepEqual(a.memory.all().map((r) => r.id),['new-attempt']);
  assert.equal(a.memory.all()[0].correct,true);
});

test('a caller-controlled reset discards pending history even when storage is temporarily denied',() => {
  let generation = 'legacy'; const h = setup({getGeneration:() => generation});
  h.storage.failWrites = true; h.memory.append(entry('before-reset')); assert.equal(h.memory.all().length,1);
  generation = 'reset-locally'; assert.equal(h.memory.all().length,0);
  h.storage.failWrites = false; h.memory.flush();
  assert.equal(h.storage.entries.has(storedKey('legacy',questions[0].id,'before-reset')),false);
  h.memory.append(entry('after-reset'));
  assert.equal(h.storage.entries.has(storedKey('reset-locally',questions[0].id,'after-reset')),true);
});

test('storage failures keep session history usable and pending events recover once writes return',() => {
  const h = setup(); h.storage.failReads = true; h.storage.failWrites = true;
  h.memory.append(entry('offline-1')); h.memory.append(entry('offline-2',{selected:'A'}));
  assert.equal(h.memory.all().length,2); assert.ok(h.errors.length > 0);
  h.storage.failReads = false; h.storage.failWrites = false; assert.equal(h.memory.flush(),true);
  assert.equal(setup({storage:h.storage}).memory.all().length,2);
  const missing = setup({storage:null}); assert.equal(missing.memory.append(entry('session-only')).id,'session-only');
  assert.equal(missing.memory.all().length,1); assert.ok(missing.errors.length > 0);
});

test('malformed or unknown stored records are isolated and saved correctness is recalculated',() => {
  const h = setup();
  h.memory.append(entry('valid',{selected:'A'}));
  const original = JSON.parse(h.storage.getItem(storedKey('legacy',questions[0].id,'valid')));
  original.correct = false; original.outcome = 'wrong'; h.storage.setItem(storedKey('legacy',questions[0].id,'valid'),JSON.stringify(original));
  const variations = [
    'not json',JSON.stringify([]),JSON.stringify({...original,version:99,id:'bad-version'}),
    JSON.stringify({...original,id:'bad-time',elapsedSeconds:-1}),JSON.stringify({...original,id:'bad-date',completedAt:'yesterday'}),
    JSON.stringify({...original,id:'bad-option',selected:'Z'}),JSON.stringify({...original,id:'bad-mode',mode:'revision'}),
    JSON.stringify({...original,id:'unknown-q',questionId:'not-real'}),JSON.stringify({...original,id:'wrong-key'}),
  ];
  variations.forEach((value,index) => h.storage.setItem(storedKey('legacy',questions[0].id,'corrupt-'+index),value));
  const restored = setup({storage:h.storage}); assert.equal(restored.memory.all().length,1); assert.equal(restored.memory.all()[0].correct,true);
  const blockedKey = storedKey('legacy',questions[0].id,'repair-corrupt-key');
  h.storage.setItem(blockedKey,JSON.stringify({...original,id:'another-event'}));
  const repaired = restored.memory.append(entry('repair-corrupt-key',{selected:'B'}));
  assert.equal(repaired.id,'repair-corrupt-key'); assert.equal(repaired.correct,false);
  assert.equal(setup({storage:h.storage}).memory.all().length,2);
  const changedKey = questions.map((q) => ({...q,answer:q.id === questions[0].id ? 'B' : q.answer}));
  assert.equal(setup({storage:h.storage,questionList:changedKey}).memory.all().find((record) => record.id === 'valid').correct,false);
});

test('new IDs are unique and invalid entries cannot turn into completed tries',() => {
  const h = setup();
  assert.equal(new Set(Array.from({length:1000},() => h.memory.createId())).size,1000);
  for (const invalid of [null,{},entry('bad-duration',{elapsedSeconds:NaN}),entry('bad-duration-2',{elapsedSeconds:1.5}),entry('bad-date',{completedAt:'nonsense'}),entry('unknown',{questionId:'unknown'}),entry('bad-mode',{mode:'other'})]) assert.equal(h.memory.append(invalid),undefined);
  assert.equal(h.memory.all().length,0);
});
