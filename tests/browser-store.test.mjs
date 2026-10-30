import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import {PaperRepository,sha256,verifyPdf} from '../web/browser-store.mjs';

class MemoryStore {
  records = new Map();
  async get(path) { const record = this.records.get(path); return record ? structuredClone(record) : undefined; }
  async put(record) { this.records.set(record.path,structuredClone(record)); }
  async delete(path) { this.records.delete(path); }
}
const subtle = webcrypto.subtle;
const encoded = (text) => new TextEncoder().encode(text);
const url = (source) => 'https://papers.tmua.local/'+source.path.slice(7);
const file = (bytes,name = 'renamed original.pdf') => ({name,size:bytes.byteLength,arrayBuffer:async () => bytes.slice().buffer});
async function fixture() {
  const question = encoded('%PDF-1.4\nsynthetic question bytes for hash validation only\n');
  const solution = encoded('%PDF-1.4\nsynthetic solution bytes for hash validation only\n');
  const sources = await Promise.all([['question','question.pdf',question],['solution','solution.pdf',solution]].map(async ([kind,name,bytes]) => ({path:'papers/'+name,kind,bytes:bytes.length,sha256:await sha256(bytes,subtle),url:'https://example.invalid/'+name})));
  const store = new MemoryStore(), repository = new PaperRepository(sources,store,subtle);
  return {question,solution,sources,store,repository};
}

test('imports identify originals by SHA256 despite renamed files and preserve partial progress',async () => {
  const {question,solution,sources,store,repository} = await fixture();
  const progress = [];
  const first = await repository.importFiles([file(question,'paper (1).pdf')],(state) => progress.push(state));
  assert.deepEqual([first.accepted,first.rejected,first.completed,first.ready],[1,0,1,true]);
  assert.equal(repository.hasPdf(url(sources[0])),true); assert.equal(repository.hasPdf(url(sources[1])),false);
  assert.equal(progress[0].completed,1);
  const restarted = new PaperRepository(sources,store,subtle);
  assert.deepEqual(await restarted.inspect(),{completed:1,total:2,ready:true});
  const second = await restarted.importFiles([file(solution)]);
  assert.deepEqual([second.accepted,second.completed],[1,2]);
  assert.deepEqual(await restarted.readPdf(url(sources[1])),solution);
});

test('unknown, non-PDF, oversized and same-size changed files never enter local storage',async () => {
  const {question,sources,repository,store} = await fixture();
  const corrupt = question.slice(); corrupt[25] ^= 1;
  const result = await repository.importFiles([file(corrupt,'changed.pdf'),file(encoded('hello'),'not.pdf'),file(new Uint8Array(1000),'large.pdf')]);
  assert.equal(result.accepted,0); assert.equal(result.rejected,3); assert.equal(store.records.size,0); assert.equal(repository.ready,false);
  await assert.rejects(() => verifyPdf(sources[0],corrupt,subtle),/changed/);
  await assert.rejects(() => verifyPdf(sources[0],question.slice(1),subtle),/match/);
});

test('startup and read checks remove corrupted cached bytes without losing valid PDFs',async () => {
  const {question,solution,sources,repository,store} = await fixture();
  await repository.importFiles([file(question),file(solution)]);
  const record = store.records.get(sources[0].path); new Uint8Array(record.bytes)[30] ^= 1;
  const restarted = new PaperRepository(sources,store,subtle);
  assert.deepEqual(await restarted.inspect(),{completed:1,total:2,ready:false});
  assert.equal(store.records.has(sources[0].path),false); assert.equal(store.records.has(sources[1].path),true);
  const second = store.records.get(sources[1].path); new Uint8Array(second.bytes)[30] ^= 1;
  await assert.rejects(() => restarted.readPdf(url(sources[1])),/damaged/);
  assert.equal(restarted.available.size,0); assert.equal(store.records.size,0);
});

test('PDF.js receives a fresh byte copy so worker transfers cannot detach persistent cache data',async () => {
  const {question,sources,repository} = await fixture();
  await repository.importFiles([file(question)]);
  const first = await repository.readPdf(url(sources[0]));
  structuredClone(first,{transfer:[first.buffer]}); assert.equal(first.byteLength,0);
  const second = await repository.readPdf(url(sources[0])); assert.deepEqual(second,question);
  await assert.rejects(() => repository.readPdf('https://evil.invalid/question.pdf'),/outside/);
  await assert.rejects(() => repository.readPdf('https://papers.tmua.local/../question.pdf'),/outside/);
});

test('duplicate originals are idempotent and storage failures report rejected imports',async () => {
  const {question,repository,store} = await fixture();
  const result = await repository.importFiles([file(question),file(question)]);
  assert.equal(result.accepted,2); assert.equal(result.completed,1); assert.equal(store.records.size,1);
  store.put = async () => { throw new Error('Storage full'); };
  const failed = await repository.importFiles([file(question)]); assert.equal(failed.rejected,1); assert.match(failed.errors[0],/Storage full/);
});
