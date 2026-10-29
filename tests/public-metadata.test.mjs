import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {regionGeometry} from '../web/pdf-geometry.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root,'web');
const data = JSON.parse(fs.readFileSync(path.join(web,'data/questions.json'),'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(web,'data/sources.json'),'utf8'));
const pdfUrl = (item) => 'https://papers.tmua.local/'+path.posix.basename(item.path);

test('metadata has all 360 question slots and references only hashed original official PDFs',() => {
  assert.equal(data.questions.length,360); assert.equal(data.papers.length,18); assert.equal(manifest.sources.length,45);
  const sources = new Map(manifest.sources.map((item) => [pdfUrl(item),item]));
  assert.equal(sources.size,45);
  for (const item of manifest.sources) {
    assert.match(item.url,/^https:\/\/uat-wp\.s3\.eu-west-2\.amazonaws\.com\//);
    assert.match(item.path,/^papers\/[A-Za-z0-9._-]+\.pdf$/); assert.match(item.sha256,/^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 1000);
  }
  const ids = new Set();
  for (const paper of data.papers) {
    const questions = data.questions.filter((question) => question.paperId === paper.id).sort((a,b) => a.number-b.number);
    assert.deepEqual(questions.map((question) => question.number),Array.from({length:20},(_,i) => i+1));
    for (const key of ['questionPdf','solutionPdf','answerKeyPdf']) assert.ok(sources.has(paper[key]),`${paper.id} ${key}`);
    for (const question of questions) {
      assert.ok(!ids.has(question.id)); ids.add(question.id);
      assert.ok(question.options.includes(question.answer));
      assert.equal('text' in question,false); assert.equal('searchText' in question,false);
      for (const [key,pages,pdf] of [['images','sourcePages','questionPdf'],['solutionImages','solutionPages','solutionPdf']]) {
        assert.deepEqual(question[key].map((region) => region.page),question[pages]);
        for (const region of question[key]) assert.equal(region.pdf,paper[pdf]);
      }
    }
  }
  const script = fs.readFileSync(path.join(web,'data/questions.js'),'utf8');
  assert.deepEqual(JSON.parse(script.trim().replace(/^window\.TMUA_DATA=/,'').replace(/;$/,'')),data);
});

test('all 749 source regions fit unchanged PDF page bounds and convert to clipped canvas geometry',() => {
  let count = 0;
  for (const question of data.questions) for (const region of [...question.images,...question.solutionImages]) {
    const geometry = regionGeometry(region);
    assert.ok(geometry.width > 0 && geometry.width < 2000); assert.ok(geometry.height > 0 && geometry.height < 2100);
    assert.equal(geometry.transform[4],-region.rect[0]*2.3); assert.equal(geometry.transform[5],-region.rect[1]*2.3);
    assert.ok(geometry.width/2.3 >= region.rect[2]-region.rect[0]); assert.ok(geometry.height/2.3 >= region.rect[3]-region.rect[1]);
    count++;
  }
  assert.equal(count,749);
  const fixed = data.questions.find((question) => question.id === '2021-p1-q17').images[0];
  assert.equal(fixed.page,19); assert.equal(fixed.rect[3],795);
  assert.throws(() => regionGeometry({...fixed,rect:[38,20,900,795]}),/outside/);
  assert.throws(() => regionGeometry({...fixed,rect:[38,20,50,NaN]}),/Invalid/);
  assert.throws(() => regionGeometry({...fixed,pageWidth:NaN}),/dimensions/);
  assert.throws(() => regionGeometry({...fixed,pageHeight:undefined}),/dimensions/);
  assert.throws(() => regionGeometry(fixed,-1),/scale/);
});

test('distributed web tree contains no official PDF files or pre-rendered question/solution images',() => {
  const paths = fs.readdirSync(web,{recursive:true,withFileTypes:true}).filter((item) => item.isFile()).map((item) => path.join(item.parentPath || item.path,item.name));
  assert.equal(paths.some((file) => /\.pdf$/i.test(file)),false);
  assert.equal(paths.some((file) => /assets[\\/](questions|solutions)[\\/]/i.test(file)),false);
  assert.equal(paths.some((file) => /\.(webp|png|jpe?g)$/i.test(file)),false);
});
