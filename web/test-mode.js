'use strict';

(function(root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TMUA_TestMode = api;
})(typeof window === 'object' ? window : null,function() {
  const ACTIVE = 'tmua-test-active-v1:', RESULT = 'tmua-test-result-v1:';
  const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const time = (seconds) => { const s = Math.max(0,Math.floor(seconds)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
  const parse = (value) => { try { return JSON.parse(value || 'null'); } catch (_) { return null; } };
  const optionsOf = (q) => (q.options || ['A','B','C','D','E']).map((item) => String(typeof item === 'string' ? item : item.label || item.letter || item.value || '').trim().toUpperCase());

  function createStore({data,storage = null,getGeneration = () => 'legacy',now = () => Date.now(),randomId,onStorageError = () => {}}) {
    if (!data || !Array.isArray(data.questions) || !Array.isArray(data.papers)) throw new Error('The test question index is missing.');
    if (!storage) { try { storage = globalThis.localStorage; } catch (_) { onStorageError(); } }
    if (!storage) storage = {get length() { return 0; },key() { return null; },getItem() { throw new Error('Local storage is unavailable.'); },setItem() { throw new Error('Local storage is unavailable.'); }};
    const id = randomId || (() => globalThis.crypto?.randomUUID?.() || `${now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    const ownerId = id(), papers = new Map(data.papers.map((p) => [p.id,p]));
    const questionsFor = (paperId) => data.questions.filter((q) => q.paperId === paperId).slice().sort((a,b) => a.number-b.number);
    let generation = String(getGeneration()), active = null, pendingActive = false, pendingCompletion = null;
    const pendingResults = new Map(), completed = new Map();
    const activeKey = () => ACTIVE+generation, resultKey = (sessionId) => RESULT+generation+':'+sessionId;
    function read(key) { try { return storage.getItem(key); } catch (_) { onStorageError(); return undefined; } }
    function write(key,value) { try { storage.setItem(key,JSON.stringify(value)); return true; } catch (_) { onStorageError(); return false; } }
    function generationChanged() {
      const current = String(getGeneration());
      if (current === generation) return false;
      generation = current; active = null; pendingActive = false; pendingCompletion = null; pendingResults.clear(); completed.clear(); return true;
    }
    function validAnswers(raw,questions) {
      const values = {};
      for (const q of questions) { const value = typeof raw?.[q.id] === 'string' ? raw[q.id].trim().toUpperCase() : ''; if (optionsOf(q).includes(value)) values[q.id] = value; }
      return values;
    }
    function validTimes(raw,questions,maxMs) {
      const values = {}; let remaining = maxMs;
      for (const q of questions) { const n = raw?.[q.id]; const value = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n),remaining) : 0; values[q.id] = value; remaining -= value; }
      return values;
    }
    function normalize(raw,finished = false) {
      if (!raw || raw.version !== 1 || !safeId(raw.id) || !papers.has(raw.paperId)) return null;
      const questions = questionsFor(raw.paperId);
      if (!questions.length || !Number.isSafeInteger(raw.startedAt) || raw.startedAt < 0 || !Number.isInteger(raw.durationSeconds) || raw.durationSeconds < 60 || raw.durationSeconds > 6*3600 || raw.deadlineAt !== raw.startedAt+raw.durationSeconds*1000) return null;
      const limit = finished ? raw.completedAt : raw.viewSince;
      if (!Number.isSafeInteger(limit) || limit < raw.startedAt || limit > raw.deadlineAt) return null;
      if (!finished && (!questions.some((q) => q.id === raw.currentId) || !safeId(raw.ownerId) || !Number.isSafeInteger(raw.leaseUntil))) return null;
      const result = {version:1,id:raw.id,paperId:raw.paperId,startedAt:raw.startedAt,deadlineAt:raw.deadlineAt,durationSeconds:raw.durationSeconds,answers:validAnswers(raw.answers,questions),timesMs:validTimes(raw.timesMs,questions,limit-raw.startedAt)};
      if (finished) return {...result,completedAt:raw.completedAt,reason:raw.reason === 'expired' ? 'expired' : 'submitted'};
      return {...result,currentId:raw.currentId,viewSince:raw.viewSince,ownerId:raw.ownerId,leaseUntil:raw.leaseUntil,revision:Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0};
    }
    function saveActive() { pendingActive = !write(activeKey(),active || (pendingCompletion && pendingResults.has(pendingCompletion.id) ? {finished:pendingCompletion} : null)); }
    function storeResult(result) { completed.set(result.id,result); if (!write(resultKey(result.id),result)) pendingResults.set(result.id,result); else pendingResults.delete(result.id); }
    function scanResults() {
      let keys = [];
      try { for (let i=0;i<storage.length;i++) { const key = storage.key(i); if (key?.startsWith(RESULT+generation+':')) keys.push(key); } } catch (_) { onStorageError(); }
      for (const key of keys) { const result = normalize(parse(read(key)),true); if (result && key === resultKey(result.id)) completed.set(result.id,result); }
      for (const [sessionId,result] of pendingResults) if (write(resultKey(sessionId),result)) pendingResults.delete(sessionId);
      if (pendingCompletion && !pendingResults.has(pendingCompletion.id)) pendingCompletion = null;
    }
    function refresh() {
      generationChanged(); scanResults();
      if (pendingActive && active) {
        const newer = normalize(parse(read(activeKey())));
        if (newer && newer.id === active.id && newer.ownerId !== ownerId) { active = newer; pendingActive = false; }
      }
      if (!pendingActive) {
        const serialized = read(activeKey());
        if (serialized === undefined) pendingActive = true;
        else {
          const raw = parse(serialized);
          if (raw?.finished) { const result = normalize(raw.finished,true); if (result) { storeResult(result); pendingCompletion = pendingResults.has(result.id) ? result : null; } active = null; saveActive(); }
          else active = normalize(raw);
        }
      } else saveActive();
      if (active && completed.has(active.id)) { active = null; saveActive(); }
      return snapshot();
    }
    function own() { return Boolean(active && active.ownerId === ownerId); }
    function accrue() {
      const end = Math.min(active.deadlineAt,Math.max(active.viewSince,Math.floor(now())));
      active.timesMs[active.currentId] = (active.timesMs[active.currentId] || 0)+end-active.viewSince;
      active.viewSince = end; active.leaseUntil = Math.floor(now())+8000; active.revision++;
    }
    function requireOwner() {
      refresh();
      if (!active) throw new Error('No test is running.');
      if (!own()) throw new Error('This test is being used in another tab. Continue it in this tab before answering.');
    }
    function start(paperId,durationSeconds = 75*60) {
      refresh();
      if (active) throw new Error('Finish the current paper before starting another test.');
      if (pendingResults.size) throw new Error('Your previous test has not been saved. Free some browser storage and retry before starting another test.');
      if (!papers.has(paperId) || !questionsFor(paperId).length) throw new Error('Choose an available paper.');
      if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 6*3600) throw new Error('Choose a test duration from 1 to 360 minutes.');
      const startedAt = Math.floor(now());
      active = {version:1,id:id(),paperId,startedAt,deadlineAt:startedAt+durationSeconds*1000,durationSeconds,currentId:questionsFor(paperId)[0].id,answers:{},timesMs:{},viewSince:startedAt,ownerId,leaseUntil:startedAt+8000,revision:0};
      if (!safeId(active.id)) throw new Error('The test could not create a valid identifier.');
      saveActive(); return snapshot();
    }
    function takeOver() {
      refresh(); if (!active) return snapshot();
      active.ownerId = ownerId; accrue(); saveActive(); return tick();
    }
    function navigate(questionId) {
      requireOwner();
      if (now() >= active.deadlineAt) return finish('expired');
      if (!questionsFor(active.paperId).some((q) => q.id === questionId)) throw new Error('This question is outside the selected test paper.');
      accrue(); active.currentId = questionId; saveActive(); return snapshot();
    }
    function answer(letter) {
      requireOwner();
      if (now() >= active.deadlineAt) return finish('expired');
      const q = questionsFor(active.paperId).find((item) => item.id === active.currentId), value = String(letter || '').trim().toUpperCase();
      if (value && !optionsOf(q).includes(value)) throw new Error('Choose one of the available answer options.');
      accrue(); if (value) active.answers[q.id] = value; else delete active.answers[q.id]; saveActive(); return snapshot();
    }
    function finish(reason = 'submitted') {
      requireOwner(); accrue();
      const completedAt = active.viewSince, result = normalize({...active,completedAt,reason:completedAt >= active.deadlineAt ? 'expired' : reason},true);
      if (!result) throw new Error('The test result could not be saved.');
      storeResult(result); pendingCompletion = pendingResults.has(result.id) ? result : null; active = null; saveActive();
      return summary(result);
    }
    function tick() {
      refresh();
      if (active && (own() || active.leaseUntil <= now())) {
        if (!own()) { active.ownerId = ownerId; accrue(); saveActive(); }
        if (now() >= active.deadlineAt) return {finished:finish('expired')};
        accrue(); saveActive();
      }
      return snapshot();
    }
    function summary(value) {
      const result = typeof value === 'string' ? completed.get(value) : value;
      if (!result) return null;
      const rows = questionsFor(result.paperId).map((q) => {
        const selected = result.answers[q.id] || '', answer = String(q.answer || '').trim().toUpperCase();
        return {questionId:q.id,number:q.number,selected,answer,correct:Boolean(selected) && selected === answer,outcome:!selected ? 'unanswered' : selected === answer ? 'correct' : 'incorrect',elapsedSeconds:Math.floor((result.timesMs[q.id] || 0)/1000),elapsedMs:result.timesMs[q.id] || 0};
      });
      return {...clone(result),paperTitle:papers.get(result.paperId).title || result.paperId,rows,correct:rows.filter((r) => r.correct).length,incorrect:rows.filter((r) => r.outcome === 'incorrect').length,unanswered:rows.filter((r) => r.outcome === 'unanswered').length,total:rows.length,elapsedSeconds:Math.floor((result.completedAt-result.startedAt)/1000)};
    }
    function entries(value) {
      const result = summary(value);
      return result ? result.rows.map((row) => ({id:`test-${result.id}-${row.questionId}`,questionId:row.questionId,selected:row.selected,elapsedSeconds:row.elapsedSeconds,mode:'test',completedAt:new Date(result.completedAt).toISOString(),testId:result.id})) : [];
    }
    function history() { refresh(); return [...completed.values()].map(summary).sort((a,b) => b.completedAt-a.completedAt); }
    function snapshot() {
      if (!active) return {active:null,owner:false};
      const current = Math.max(active.viewSince,Math.floor(now()));
      return {active:clone(active),owner:own(),remainingSeconds:Math.max(0,Math.ceil((active.deadlineAt-current)/1000)),elapsedSeconds:Math.max(0,Math.min(active.durationSeconds,Math.floor((current-active.startedAt)/1000)))};
    }
    refresh();
    return {start,takeOver,navigate,answer,finish,tick,refresh,snapshot,history,summary,entries,questionsFor,ownerId,keys:{ACTIVE,RESULT}};
  }

  function create(settings) {
    const {data,host,renderImages = () => '',onActiveChange = () => {},onComplete = () => {},onBack = () => {},onStorageError = () => {}} = settings;
    if (!host) throw new Error('The test view is missing.');
    const model = createStore({...settings,onStorageError}), doc = host.ownerDocument || document;
    let visibleResult = null, screen = '', lastQuestion = '', destroyed = false, activeState;
    const byId = (id) => host.querySelector('#'+id);
    const paperTitle = (paperId) => data.papers.find((p) => p.id === paperId)?.title || paperId;
    const question = (qid) => data.questions.find((q) => q.id === qid);
    const mounted = () => { window.TMUA_BROWSER?.rewriteLinks(host); window.TMUA_PDFRenderer?.mount(host); };
    function signal(active) { if (activeState !== active) { activeState = active; onActiveChange(active); } }
    function replay() { for (const result of model.history()) { try { onComplete(model.entries(result.id),result); } catch (_) { onStorageError(); } } }
    function showError(error) { const box = byId('test-status'); if (box) box.textContent = error.message || String(error); }
    function call(action) { try { const result = action(); if (result?.rows) visibleResult = result.id; else if (result?.finished) visibleResult = result.finished.id; render(); } catch (error) { showError(error); } }
    function render() {
      if (destroyed) return;
      const state = model.snapshot(); signal(Boolean(state.active));
      if (state.active) renderActive(state); else if (visibleResult && model.summary(visibleResult)) renderResult(model.summary(visibleResult)); else renderPicker();
    }
    function renderPicker() {
      const history = model.history(); screen = 'picker'; lastQuestion = '';
      host.innerHTML = `<div class="test-shell"><div class="test-heading"><h1>Test mode</h1><button id="test-back" class="button" type="button">Back to practice</button></div><form id="test-start-form" class="test-start-panel"><label for="test-paper-select">Paper<select id="test-paper-select">${data.papers.map((p) => `<option value="${escape(p.id)}">${escape(p.title || p.id)}</option>`).join('')}</select></label><label for="test-duration">Time limit <span>(minutes)</span><input id="test-duration" type="number" min="1" max="360" step="1" value="75" required></label><p>Stay on one paper. Answers and worked solutions appear after you submit. The timer keeps running if you leave or reload this page.</p><button id="test-start" class="button primary" type="submit">Start test</button></form><p id="test-status" role="status"></p><section class="test-history"><h2>Previous tests</h2>${history.length ? `<div class="test-history-list">${history.map((r) => `<button class="test-history-item" type="button" data-test-review="${escape(r.id)}"><span>${escape(r.paperTitle)}<small>${escape(new Date(r.completedAt).toLocaleString())}</small></span><span>${r.correct}/${r.total} · ${time(r.elapsedSeconds)}</span></button>`).join('')}</div>` : '<p>No completed tests yet.</p>'}</section></div>`;
      byId('test-start-form').addEventListener('submit',(event) => { event.preventDefault(); const minutes = Number(byId('test-duration').value); call(() => model.start(byId('test-paper-select').value,minutes*60)); });
      byId('test-back').addEventListener('click',onBack);
      host.querySelectorAll('[data-test-review]').forEach((button) => button.addEventListener('click',() => { visibleResult = button.dataset.testReview; render(); }));
    }
    function renderActive(state) {
      const session = state.active, questions = model.questionsFor(session.paperId), q = question(session.currentId), position = questions.findIndex((item) => item.id === q.id);
      if (screen !== 'active' || lastQuestion !== q.id || host.dataset.owner !== String(state.owner)) {
        screen = 'active'; lastQuestion = q.id; host.dataset.owner = String(state.owner);
        host.innerHTML = `<div class="test-shell"><header class="test-running-header"><div><h1>${escape(paperTitle(session.paperId))}</h1><p id="test-answer-count"></p></div><div class="test-clock"><span>Time remaining</span><strong id="test-timer" role="timer" aria-live="off">${time(state.remainingSeconds)}</strong></div><button id="test-submit" class="button primary" type="button"${state.owner ? '' : ' disabled'}>Submit test</button></header>${state.owner ? '' : '<div class="test-other-tab" role="status">This test is open in another tab. The timer is still running. <button id="test-take-over" class="button" type="button">Continue in this tab</button></div>'}<nav class="test-question-nav" aria-label="Test questions">${questions.map((item) => `<button type="button" data-test-question="${escape(item.id)}"${item.id === q.id ? ' aria-current="true"' : ''}${state.owner ? '' : ' disabled'}>${item.number}</button>`).join('')}</nav><article class="test-question-card"><header><h2>Question ${escape(q.number)}</h2><span>${position+1} of ${questions.length}</span></header><div class="test-question-images">${renderImages(q.images || [],`${paperTitle(session.paperId)}, Question ${q.number}`,{testMode:true})}</div><div class="test-answer-controls"><p>Your answer</p><div id="test-options" class="answer-options" role="group" aria-label="Choose your test answer">${optionsOf(q).map((letter) => `<button type="button" class="answer-option" data-test-option="${escape(letter)}" aria-label="Answer ${escape(letter)}" aria-pressed="false"${state.owner ? '' : ' disabled'}>${escape(letter)}</button>`).join('')}</div><button id="test-clear-answer" class="text-button" type="button"${state.owner ? '' : ' disabled'}>Clear answer</button></div><nav class="test-prev-next" aria-label="Navigate this paper"><button id="test-previous" class="button" type="button"${position === 0 || !state.owner ? ' disabled' : ''}>← Previous</button><button id="test-next" class="button" type="button"${position === questions.length-1 || !state.owner ? ' disabled' : ''}>Next question →</button></nav></article><p id="test-status" role="status"></p></div>`;
        byId('test-submit').addEventListener('click',() => {
          const missing = questions.length-Object.keys(model.snapshot().active?.answers || {}).length;
          if (window.confirm(missing ? `Submit this paper with ${missing} unanswered question${missing === 1 ? '' : 's'}?` : 'Submit this paper and see your results?')) call(() => model.finish());
        });
        byId('test-take-over')?.addEventListener('click',() => call(() => model.takeOver()));
        host.querySelectorAll('[data-test-question]').forEach((button) => button.addEventListener('click',() => call(() => model.navigate(button.dataset.testQuestion))));
        host.querySelectorAll('[data-test-option]').forEach((button) => button.addEventListener('click',() => call(() => model.answer(button.dataset.testOption))));
        byId('test-clear-answer').addEventListener('click',() => call(() => model.answer('')));
        byId('test-previous').addEventListener('click',() => call(() => model.navigate(questions[position-1].id)));
        byId('test-next').addEventListener('click',() => call(() => model.navigate(questions[position+1].id)));
        mounted();
      }
      byId('test-timer').textContent = time(state.remainingSeconds);
      byId('test-answer-count').textContent = `${Object.keys(session.answers).length} of ${questions.length} answered`;
      host.querySelectorAll('[data-test-question]').forEach((button) => button.classList.toggle('test-answered',Boolean(session.answers[button.dataset.testQuestion])));
      host.querySelectorAll('[data-test-option]').forEach((button) => { const selected = session.answers[q.id] === button.dataset.testOption; button.classList.toggle('chosen',selected); button.setAttribute('aria-pressed',String(selected)); });
    }
    function renderResult(result) {
      screen = 'result'; lastQuestion = '';
      host.innerHTML = `<div class="test-shell"><div class="test-heading"><h1>${escape(result.paperTitle)} — results</h1><button id="test-new" class="button" type="button">Tests & history</button></div><section id="test-results" class="test-result-summary"><strong>${result.correct}/${result.total}</strong><span>${result.correct} correct · ${result.incorrect} incorrect · ${result.unanswered} unanswered</span><span>Time taken: ${time(result.elapsedSeconds)}${result.reason === 'expired' ? ' · Time limit reached' : ''}</span><p>Completed ${escape(new Date(result.completedAt).toLocaleString())}</p></section><div class="test-results-list">${result.rows.map((row) => `<article class="test-result-row ${row.outcome}" data-test-result="${escape(row.questionId)}"><div class="test-result-row-heading"><h2>Question ${row.number}</h2><span class="test-result-outcome">${row.outcome === 'correct' ? 'Correct' : row.outcome === 'incorrect' ? 'Incorrect' : 'Unanswered'}</span><span>Your answer: <strong>${escape(row.selected || '—')}</strong> · Correct: <strong>${escape(row.answer || '—')}</strong></span><span>${time(row.elapsedSeconds)}</span><button class="button" type="button" data-test-solution="${escape(row.questionId)}" aria-expanded="false">Question & worked solution</button></div><section class="test-review-detail" data-test-detail="${escape(row.questionId)}" hidden></section></article>`).join('')}</div><p id="test-status" role="status"></p></div>`;
      byId('test-new').addEventListener('click',() => { visibleResult = null; render(); });
      host.querySelectorAll('[data-test-solution]').forEach((button) => button.addEventListener('click',() => {
        const detail = host.querySelector(`[data-test-detail="${button.dataset.testSolution}"]`), q = question(button.dataset.testSolution);
        detail.hidden = !detail.hidden; button.setAttribute('aria-expanded',String(!detail.hidden));
        if (!detail.hidden && !detail.dataset.loaded) {
          detail.innerHTML = `<h3>Question ${q.number}</h3>${renderImages(q.images || [],`${result.paperTitle}, Question ${q.number}`,{testMode:false})}<h3>Worked solution</h3>${renderImages(q.solutionImages || [],`Worked solution, Question ${q.number}`,{testMode:false}) || '<p>A worked solution is not available for this question.</p>'}`;
          detail.dataset.loaded = 'true'; mounted();
        }
      }));
      replay();
    }
    function refresh() {
      const current = model.refresh();
      const takeover = current.active && current.active.ownerId !== model.ownerId && current.active.leaseUntil <= Date.now() ? model.takeOver() : null;
      const ticked = takeover?.finished ? takeover : model.tick();
      if (ticked.finished) visibleResult = ticked.finished.id;
      if (!ticked.active && !ticked.finished && screen === 'active') { const recent = model.history()[0]; visibleResult = recent?.id || null; }
      render();
    }
    const handleStorage = (event) => { if (!event.key || event.key.startsWith(ACTIVE) || event.key.startsWith(RESULT) || event.key === 'tmua-question-bank-reset-v2') refresh(); };
    const interval = (settings.setInterval || window.setInterval)(() => {
      const previous = model.snapshot();
      if (!previous.active) return;
      refresh();
    },1000);
    window.addEventListener('storage',handleStorage);
    window.addEventListener('focus',refresh);
    const visibility = () => refresh(); doc.addEventListener('visibilitychange',visibility);
    const ready = () => window.TMUA_PDFRenderer?.mount(host); window.addEventListener('tmua-pdf-ready',ready);
    refresh(); replay();
    return {open() { refresh(); },refresh,isActive() { return Boolean(model.snapshot().active); },activeSession() { return model.snapshot().active; },reset() { visibleResult = null; refresh(); },model,destroy() { destroyed = true; (settings.clearInterval || window.clearInterval)(interval); window.removeEventListener('storage',handleStorage); window.removeEventListener('focus',refresh); window.removeEventListener('tmua-pdf-ready',ready); doc.removeEventListener('visibilitychange',visibility); }};
  }
  return {create,createStore,formatTime:time,keys:{ACTIVE,RESULT}};
});
