'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'tmua-question-bank-progress-v1';
  const LAST_QUESTION_KEY = 'tmua-question-bank-last-question-v1';
  const RESET_KEY = 'tmua-question-bank-reset-v2';
  const ATTEMPT_PREFIX = 'tmua-question-bank-attempt-v2:';
  const BOOKMARK_PREFIX = 'tmua-question-bank-bookmark-v2:';
  const DRAFT_PREFIX = 'tmua-question-bank-draft-v1:';
  const PAGE_SIZE = 15;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, filled = false) => name === 'bookmark' ? `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"/></svg>` : '';
  const state = {data: null, progress: {}, currentId: null, listPage: 0, filters: {paper:'all',year:'all',topic:'all',status:'all',search:''}, reveal: false, startedAt: Date.now(), elapsedMs: 0, timerRunning: false, view: 'practice', toastTimeout: null};
  let memory, testController, practiceAttemptId = null, lastCheckpoint = 0;
  const draftCache = new Map();
  let knownMemoryEvents = new Set();
  let saveWarningShown = false;
  let progressGeneration = 'legacy', legacyProgress = {}, pendingReset = false;
  const pendingWrites = new Map();
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) state.progress = saved; } catch (_) { /* A fresh study record is safe if local data was cleared or damaged. */ }

  function notify(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }
  function storageWarning() {
    if (!saveWarningShown) { notify('This app could not save progress on this device. Your current session still works.'); saveWarningShown = true; }
  }
  function parseObject(value) { try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (_) { return {}; } }
  function storedGeneration() { const value = localStorage.getItem(RESET_KEY); return typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value) ? value : 'legacy'; }
  function resetChanged() { try { return !pendingReset && storedGeneration() !== progressGeneration; } catch (_) { return false; } }
  function flushProgressWrites() {
    try {
      if (pendingReset) { localStorage.setItem(RESET_KEY,progressGeneration); pendingReset = false; }
      for (const [key,value] of pendingWrites) { localStorage.setItem(key,value); pendingWrites.delete(key); }
    } catch (_) { storageWarning(); }
  }
  function allowPracticeAction() {
    if (!resetChanged()) return true;
    refreshProgress(); notify('Progress was reset in another tab. Please try again.'); return false;
  }
  function progressKey(kind,id,generation = progressGeneration) { return `${kind === 'attempt' ? ATTEMPT_PREFIX : BOOKMARK_PREFIX}${generation}:${id}`; }
  function normalizeRecord(q,raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const selected = typeof raw.selected === 'string' ? raw.selected.trim().toUpperCase() : '';
    const validSelection = optionsOf(q).map((option) => option.trim().toUpperCase()).includes(selected) ? selected : '';
    const marked = raw.marked === true && Boolean(validSelection) && Boolean(answerOf(q));
    const result = {selected:validSelection,marked,correct:marked && validSelection === answerOf(q),bookmarked:raw.bookmarked === true};
    if (typeof raw.attemptId === 'string' && /^[a-zA-Z0-9:_-]{1,180}$/.test(raw.attemptId)) result.attemptId = raw.attemptId;
    if (Number.isSafeInteger(raw.elapsedSeconds) && raw.elapsedSeconds >= 0) result.elapsedSeconds = raw.elapsedSeconds;
    if (typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))) result.updatedAt = raw.updatedAt;
    return result;
  }
  function readQuestionProgress(q,generation,legacy) {
    let raw = generation === 'legacy' ? normalizeRecord(q,legacy[q.id]) : undefined;
    const attemptKey = progressKey('attempt',q.id,generation), bookmarkKey = progressKey('bookmark',q.id,generation);
    const attempt = pendingWrites.has(attemptKey) ? pendingWrites.get(attemptKey) : localStorage.getItem(attemptKey);
    const bookmark = pendingWrites.has(bookmarkKey) ? pendingWrites.get(bookmarkKey) : localStorage.getItem(bookmarkKey);
    if (attempt !== null) { const parsed = parseObject(attempt); raw = {...raw,selected:parsed.selected,marked:parsed.marked,elapsedSeconds:parsed.elapsedSeconds,updatedAt:parsed.updatedAt,attemptId:parsed.attemptId}; }
    if (bookmark !== null) raw = {...raw,bookmarked:bookmark === 'true'};
    return normalizeRecord(q,raw);
  }
  function refreshProgress({render = true} = {}) {
    try {
      const generation = pendingReset ? progressGeneration : storedGeneration();
      const previousGeneration = progressGeneration, previous = currentQuestion() ? record(currentQuestion()) : {};
      if (generation !== progressGeneration) { pendingWrites.clear(); draftCache.clear(); }
      progressGeneration = generation;
      flushProgressWrites();
      legacyProgress = generation === 'legacy' ? parseObject(localStorage.getItem(STORAGE_KEY)) : {};
      const progress = Object.create(null);
      for (const q of state.data.questions) { const value = readQuestionProgress(q,generation,legacyProgress); if (value) progress[q.id] = value; }
      state.progress = progress;
      const current = currentQuestion() ? record(currentQuestion()) : {};
      if (generation !== previousGeneration || JSON.stringify([previous.selected,previous.marked,previous.elapsedSeconds,previous.attemptId]) !== JSON.stringify([current.selected,current.marked,current.elapsedSeconds,current.attemptId])) { state.reveal = false; resetTimer(currentQuestion()); }
      memory?.flush();
      if (memory) knownMemoryEvents = new Set(memory.all().map((entry) => `${entry.questionId}:${entry.id}`));
      testController?.refresh();
      if (render && !testController?.isActive()) { renderSummary(); if (!currentQuestion() && filteredQuestions().length) applyFilters(); else { renderList(); renderQuestion(); } }
    } catch (_) { /* Keep the session usable when reads are unavailable. */ }
  }
  function saveProgress(q,kind,value) {
    if (resetChanged()) { refreshProgress({render:false}); return false; }
    let base = record(q);
    try { base = readQuestionProgress(q,progressGeneration,legacyProgress) || {}; } catch (_) { /* Local progress remains available. */ }
    const patch = kind === 'bookmark' ? {bookmarked:value.bookmarked === true} : {selected:value.selected,marked:value.marked,elapsedSeconds:value.elapsedSeconds,updatedAt:value.updatedAt,attemptId:value.attemptId};
    state.progress[q.id] = normalizeRecord(q,{...base,...patch});
    const key = progressKey(kind,q.id), serialized = JSON.stringify(kind === 'bookmark' ? value.bookmarked === true : {selected:state.progress[q.id].selected,marked:state.progress[q.id].marked,elapsedSeconds:state.progress[q.id].elapsedSeconds,updatedAt:state.progress[q.id].updatedAt,attemptId:state.progress[q.id].attemptId});
    pendingWrites.set(key,serialized);
    flushProgressWrites();
    return true;
  }
  function resetProgress() {
    // A new generation prevents a stale window from restoring records deleted
    // by Reset. Separate attempt/bookmark keys avoid unrelated write conflicts.
    progressGeneration = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    pendingWrites.clear(); draftCache.clear(); knownMemoryEvents.clear(); legacyProgress = {}; pendingReset = true; state.progress = Object.create(null);
    try { localStorage.setItem(RESET_KEY,progressGeneration); pendingReset = false; } catch (_) { storageWarning(); }
    testController?.reset();
  }
  function record(q) { return state.progress[q.id] || {}; }
  function answerOf(q) { return typeof q.answer === 'string' ? q.answer.trim().toUpperCase() : ''; }
  function optionsOf(q) {
    if (Array.isArray(q.options) && q.options.length) return q.options.map((o) => typeof o === 'string' ? o : String(o.label || o.letter || o.value || '')).filter(Boolean);
    return ['A','B','C','D','E'];
  }
  function currentQuestion() { return state.data.questions.find((q) => q.id === state.currentId); }
  function updateFragment(id) { try { history.replaceState(null, '', `#${encodeURIComponent(id)}`); } catch (_) { /* Practice continues if history updates are unavailable. */ } }
  function rememberQuestion(id) { try { localStorage.setItem(LAST_QUESTION_KEY, id); } catch (_) { /* Answer persistence reports its own storage failures. */ } }
  function normalizeProgress() {
    const normalized = Object.create(null);
    for (const q of state.data.questions) {
      const raw = state.progress[q.id];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      normalized[q.id] = normalizeRecord(q,raw);
    }
    state.progress = normalized;
  }
  function currentPaper(q) { return state.data.papers.find((p) => p.id === q.paperId) || {}; }
  function paperLabel(q) { return `Paper ${q.paper}`; }
  function yearLabel(q) { return String(q.year).toLowerCase().includes('specimen') ? 'Specimen' : String(q.year); }
  function topicLabel(q) { return q.topic || 'Mathematics'; }
  function filteredQuestions() {
    const f = state.filters, search = f.search.trim().toLowerCase();
    return state.data.questions.filter((q) => {
      const r = record(q);
      if (f.paper !== 'all' && String(q.paper) !== f.paper) return false;
      if (f.year !== 'all' && String(q.year) !== f.year) return false;
      if (f.topic !== 'all' && topicLabel(q) !== f.topic) return false;
      if (f.status === 'unattempted' && r.marked) return false;
      if (f.status === 'correct' && !(r.marked && r.correct)) return false;
      if (f.status === 'incorrect' && !(r.marked && !r.correct)) return false;
      if (f.status === 'bookmarked' && !r.bookmarked) return false;
      return !search || [q.text, q.id, q.year, `paper ${q.paper}`, `question ${q.number}`, topicLabel(q), ...(q.tags || [])].join(' ').toLowerCase().includes(search);
    });
  }
  function navigationQuestions(q) {
    // Keep the reviewed question on screen, but navigate relative to its archive
    // position when checking/retrying/unbookmarking removes it from the filter.
    const position = state.data.questions.findIndex((item) => item.id === q.id);
    const matches = new Set(filteredQuestions().map((item) => item.id));
    let previous, next;
    state.data.questions.forEach((item,index) => { if (!matches.has(item.id)) return; if (index < position) previous = item; else if (index > position && !next) next = item; });
    return {previous, next, random:filteredQuestions().filter((item) => item.id !== q.id)};
  }
  function renderSummary() {
    $('total-count').textContent = state.data.questions.length;
    $('paper-count').textContent = state.data.papers.length;
    $('attempted-count').textContent = state.data.questions.filter((q) => record(q).marked).length;
  }
  function renderList() {
    const focusedId = $('question-list').contains(document.activeElement) ? document.activeElement?.dataset?.question : null;
    const questions = filteredQuestions(), pages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
    state.listPage = Math.max(0, Math.min(state.listPage, pages - 1));
    const start = state.listPage * PAGE_SIZE;
    $('result-count').textContent = questions.length;
    $('result-page').textContent = questions.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, questions.length)}` : '';
    $('list-page-label').textContent = `${state.listPage + 1} / ${pages}`;
    $('list-prev').disabled = state.listPage === 0;
    $('list-next').disabled = state.listPage >= pages - 1;
    $('question-list').innerHTML = questions.length ? questions.slice(start, start + PAGE_SIZE).map((q) => {
      const r = record(q), selected = q.id === state.currentId;
      const status = r.marked ? (r.correct ? 'Correct' : 'To revisit') : (r.bookmarked ? 'Bookmarked' : 'Not attempted');
      return `<button type="button" class="question-row${selected ? ' active' : ''}" data-question="${escape(q.id)}"${selected ? ' aria-current="true"' : ''} aria-label="${escape(`${yearLabel(q)}, ${paperLabel(q)}, Question ${q.number}. ${topicLabel(q)}. ${status}`)}"><span class="row-number">${escape(q.number)}</span><span class="row-info"><span class="row-title">${escape(yearLabel(q))} · P${escape(q.paper)}</span><span class="row-topic">${escape(topicLabel(q))}</span></span><span class="row-state${r.marked && !r.correct ? ' wrong' : ''}" aria-hidden="true">${r.marked ? (r.correct ? '✓' : '↺') : (r.bookmarked ? '◆' : '')}</span></button>`;
    }).join('') : '<p class="list-empty">No questions match these filters.</p>';
    if (focusedId) $('question-list').querySelector(`[data-question="${CSS.escape(focusedId)}"]`)?.focus({preventScroll:true});
  }
  function updateQuestionMarkup(workspace,id,markup) {
    // Keep an online PDF viewer mounted when checking an answer or bookmarking;
    // replacing its iframe would reset its page/zoom and start it loading again.
    if (window.TMUA_BROWSER && workspace.dataset.questionId === id) {
      const template = document.createElement('template');
      if (template.content) {
        template.innerHTML = markup;
        for (const selector of ['.question-tools','.answer-section','.position-note','.question-navigation','#attempt-history-panel']) {
          const current = workspace.querySelector(selector), next = template.content.querySelector(selector);
          if (current && next) current.innerHTML = next.innerHTML;
        }
        const currentSolution = workspace.querySelector('.solution-panel'), nextSolution = template.content.querySelector('.solution-panel');
        if (currentSolution && !nextSolution) currentSolution.remove();
        if (!currentSolution && nextSolution) workspace.querySelector('.question-bottom').before(nextSolution);
        return;
      }
    }
    workspace.innerHTML = markup; workspace.dataset.questionId = id;
  }
  function imageMarkup(paths, description, {testMode = false} = {}) {
    return (paths || []).map((region, index) => {
      const title = `${description}${paths.length > 1 ? `, part ${index + 1} of ${paths.length}` : ''}`;
      if (window.TMUA_BROWSER && !window.TMUA_BROWSER.hasPdf(region.pdf)) {
        const original = pdfLink(window.TMUA_BROWSER.sourceUrl(region.pdf),region.page)+'&view=FitH';
        return `<section class="remote-pdf"><p>Original PDF page ${escape(region.page)}. <a href="${escape(original)}" target="_blank" rel="noopener noreferrer">Open original PDF ↗</a>${testMode ? '' : ' · <button class="text-button import-region-pdf" type="button">Import for the individual question</button>'}</p><iframe class="publisher-pdf" src="${escape(original)}" title="${escape(title)}" loading="lazy"></iframe></section>`;
      }
      return `<a class="image-zoom pdf-region" href="${escape(pdfLink(region.pdf,region.page))}" target="_blank" rel="noopener noreferrer" title="Open full-size image" data-pdf-region="${escape(JSON.stringify(region))}"><span class="pdf-loading" role="status">Rendering original PDF…</span><img hidden alt="${escape(title)}. Open full-size image." decoding="async"></a>`;
    }).join('');
  }
  function pdfLink(path, page) { return path ? `${path}${page ? `#page=${page}` : ''}` : ''; }
  function durationLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Not recorded';
    const value = Math.floor(seconds);
    return `${Math.floor(value / 60).toString().padStart(2,'0')}:${(value % 60).toString().padStart(2,'0')}`;
  }
  function attemptHistory(q) {
    const entries = [...(memory?.list(q.id) || [])].reverse();
    return `<details id="attempt-history-panel" class="attempt-history"><summary>Attempt history <span>(${entries.length})</span></summary>${entries.length ? `<div class="history-scroll"><table id="attempt-history-table"><thead><tr><th scope="col">When</th><th scope="col">Mode</th><th scope="col">Result</th><th scope="col">Your answer</th><th scope="col">Time</th></tr></thead><tbody>${entries.map((entry) => {
      const outcome = entry.outcome || (entry.correct ? 'correct' : 'incorrect');
      const date = entry.completedAt ? new Date(entry.completedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Earlier saved attempt';
      return `<tr data-attempt-id="${escape(entry.id)}"><td>${escape(date)}</td><td>${entry.mode === 'test' ? 'Test' : 'Practice'}</td><td class="history-${escape(outcome)}">${outcome === 'unanswered' ? 'Unanswered' : outcome === 'correct' ? 'Correct' : 'Wrong'}</td><td>${escape(entry.selected || '—')}</td><td>${durationLabel(entry.elapsedSeconds)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p>No checked attempts yet.</p>'}</details>`;
  }
  function renderQuestion() {
    if (testController?.isActive()) return;
    const q = currentQuestion(), workspace = $('question-workspace');
    const focused = workspace.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id, focusOption = focused?.dataset?.option;
    if (!q) { workspace.innerHTML = ''; $('empty-state').hidden = false; return; }
    $('empty-state').hidden = true;
    const p = currentPaper(q), r = record(q), questions = filteredQuestions(), index = questions.findIndex((item) => item.id === q.id);
    const navigation = navigationQuestions(q);
    const answer = answerOf(q), options = optionsOf(q), marked = Boolean(r.marked), selected = r.selected || '';
    const questionLink = pdfLink(p.questionPdf || q.questionPdf || p.sourceUrl, (q.sourcePages || [])[0]);
    const solutionLink = pdfLink(p.solutionPdf || q.solutionPdf, (q.solutionPages || [])[0]);
    const questionDescription = `${yearLabel(q)} TMUA ${paperLabel(q)}, Question ${q.number}. Original question with answer options.`;
    const optionMarkup = options.map((option) => {
      const letter = option.trim().toUpperCase();
      let cls = letter === selected ? ' chosen' : '';
      if (marked && letter === answer) cls = ' right';
      else if (marked && letter === selected && selected !== answer) cls = ' wrong';
      return `<button class="answer-option${cls}" type="button" data-option="${escape(letter)}" aria-label="Answer ${escape(letter)}${marked && letter === answer ? ', correct answer' : ''}" aria-pressed="${letter === selected}"${marked ? ' disabled' : ''}>${escape(letter)}</button>`;
    }).join('');
    const feedback = marked ? `<div class="feedback${r.correct ? '' : ' incorrect'}" role="status"><span class="feedback-icon" aria-hidden="true">${r.correct ? '✓' : '↺'}</span><span><strong>${r.correct ? 'Correct.' : 'Incorrect.'}</strong> ${r.correct ? `Answer ${escape(answer)}.` : `You chose ${escape(selected)}. Answer ${escape(answer)}.`}</span></div>` : '';
    const solution = state.reveal ? `<section class="solution-panel" aria-label="Worked solution"><div class="solution-heading"><h3>Worked solution</h3>${solutionLink ? `<a href="${escape(solutionLink)}" target="_blank" rel="noopener noreferrer">Open original solution ↗</a>` : ''}</div>${(q.solutionImages || []).length ? `<div class="solution-images">${imageMarkup(q.solutionImages, `Official worked solution for ${yearLabel(q)} ${paperLabel(q)}, Question ${q.number}`)}</div>` : `<p class="no-image">${solutionLink ? `The worked solution is available in the <a href="${escape(solutionLink)}" target="_blank" rel="noopener noreferrer">original PDF ↗</a>.` : 'A worked solution is not available for this question.'}</p>`}<p class="solution-note">Original official worked solution. ${q.solutionPages?.length ? `PDF page${q.solutionPages.length > 1 ? 's' : ''} ${escape(q.solutionPages.join(', '))}.` : ''}</p></section>` : '';
    updateQuestionMarkup(workspace,q.id,`<article class="question-card"><div class="question-toolbar"><div class="question-meta"><span class="badge year-badge">${escape(yearLabel(q))}</span><span class="badge">${paperLabel(q)}</span><span class="question-number">Question ${escape(q.number)}</span></div><div class="question-tools"><span class="timer" id="question-timer" aria-label="Time on current attempt">${elapsedTime()}</span><button id="bookmark-question" class="icon-button${r.bookmarked ? ' bookmarked' : ''}" type="button" aria-label="${r.bookmarked ? 'Remove bookmark' : 'Bookmark question'}" aria-pressed="${Boolean(r.bookmarked)}">${icon('bookmark',r.bookmarked)}<span>${r.bookmarked ? 'Saved' : 'Save'}</span></button></div></div><div class="question-body"><div class="topic-line"><h2>${escape(topicLabel(q))}</h2><span class="paper-type">${Number(q.paper) === 1 ? 'Mathematical Thinking' : 'Mathematical Reasoning'}</span></div><div class="question-images">${(q.images || []).length ? imageMarkup(q.images, questionDescription) : `<div class="text-fallback">${escape(q.text || 'Open the original paper to read this question.')}</div>`}</div>${q.text ? `<details class="question-text"><summary>Read extracted text</summary><pre>${escape(q.text)}</pre></details>` : ''}<div class="answer-section"><p class="answer-label">YOUR ANSWER</p><div class="answer-options" role="group" aria-label="Choose your answer">${optionMarkup}</div><div class="question-action-bar"><button id="mark-answer" class="button primary" type="button"${!selected || marked || !answer ? ' disabled' : ''}>${marked ? 'Answer checked' : !answer ? 'Answer key unavailable' : 'Check answer'}<span aria-hidden="true">↗</span></button><button id="reveal-solution" class="reveal-button" type="button" aria-expanded="${state.reveal}">${state.reveal ? 'Hide worked solution' : 'Show worked solution'}</button>${marked ? '<button id="retry-question" class="text-button" type="button">Try again</button>' : ''}</div>${feedback}</div></div>${solution}${attemptHistory(q)}<div class="question-bottom">${questionLink ? `<a class="original-link" href="${escape(questionLink)}" target="_blank" rel="noopener noreferrer">Original question paper ↗</a>` : '<span></span>'}<span class="position-note">${index >= 0 ? `${index + 1} of ${questions.length} matching questions` : 'Reviewed · no longer matches this filter'}</span></div></article><nav class="question-navigation" aria-label="Question navigation"><button id="previous-question" class="nav-button" type="button"${!navigation.previous ? ' disabled' : ''}>← Previous</button><button id="random-question" class="random-button" type="button"${!navigation.random.length ? ' disabled' : ''}><span aria-hidden="true">⤨</span> Surprise me</button><button id="next-question" class="nav-button next" type="button"${!navigation.next ? ' disabled' : ''}>Next question →</button></nav>`);
    window.TMUA_PDFRenderer?.mount(workspace);
    window.TMUA_BROWSER?.rewriteLinks(workspace);
    if (focused) {
      let target = focusOption ? workspace.querySelector(`[data-option="${CSS.escape(focusOption)}"]`) : focusId ? $(focusId) : null;
      if (!target || target.disabled) target = focusId === 'mark-answer' ? $('reveal-solution') : focusId === 'retry-question' ? workspace.querySelector('[data-option]') : workspace;
      target?.focus({preventScroll:true});
    }
  }
  function newAttemptId() { return memory?.createId() || `practice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  function draftKey(q) { return `${DRAFT_PREFIX}${progressGeneration}:${q.id}`; }
  function loadDraft(q, fresh = false) {
    const key = draftKey(q);
    if (!fresh && draftCache.has(key)) return draftCache.get(key);
    let value;
    if (!fresh) {
      try { value = parseObject(pendingWrites.has(key) ? pendingWrites.get(key) : localStorage.getItem(key)); } catch (_) {}
    }
    if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,180}$/.test(value.id) || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) value = {id:newAttemptId(),elapsedMs:0};
    if (!fresh && record(q).attemptId && record(q).attemptId !== value.id) value = {id:record(q).attemptId,elapsedMs:(record(q).elapsedSeconds || 0) * 1000};
    draftCache.set(key,value); return value;
  }
  function persistDraft(q = currentQuestion()) {
    if (!q || record(q).marked || q.id !== state.currentId || !practiceAttemptId) return;
    try { if (!pendingReset && storedGeneration() !== progressGeneration) return; } catch (_) {}
    const key = draftKey(q), draft = {id:practiceAttemptId,elapsedMs:Math.max(0,Math.floor(state.elapsedMs + (state.timerRunning ? Math.max(0,Date.now()-state.startedAt) : 0)))};
    draftCache.set(key,draft); pendingWrites.set(key,JSON.stringify(draft));
    flushProgressWrites();
    lastCheckpoint = Date.now();
  }
  function pauseTimer() {
    if (state.timerRunning) state.elapsedMs += Math.max(0, Date.now() - state.startedAt);
    state.timerRunning = false;
    persistDraft();
  }
  function resumeTimer() {
    const q = currentQuestion();
    if (!state.timerRunning && q && !record(q).marked && state.view === 'practice' && !document.hidden) { state.startedAt = Date.now(); state.timerRunning = true; }
  }
  function resetTimer(q) {
    state.timerRunning = false;
    const draft = q && !record(q).marked ? loadDraft(q) : null;
    practiceAttemptId = draft?.id || (q ? record(q).attemptId : null);
    state.elapsedMs = q ? record(q).marked ? (record(q).elapsedSeconds || 0) * 1000 : draft.elapsedMs : 0;
    state.startedAt = Date.now();
    lastCheckpoint = Date.now();
    resumeTimer();
  }
  function elapsedSeconds() { return Math.floor((state.elapsedMs + (state.timerRunning ? Math.max(0,Date.now() - state.startedAt) : 0)) / 1000); }
  function elapsedTime() {
    const elapsed = elapsedSeconds();
    return `${Math.floor(elapsed / 60).toString().padStart(2,'0')}:${(elapsed % 60).toString().padStart(2,'0')}`;
  }
  function selectQuestion(id, {scroll = false, updateHash = true} = {}) {
    if (resetChanged()) refreshProgress({render:false});
    if (testController?.isActive()) return;
    if (!state.data.questions.some((q) => q.id === id)) return;
    const changed = state.currentId !== id;
    if (changed) pauseTimer();
    state.currentId = id;
    if (changed) { state.reveal = false; resetTimer(currentQuestion()); }
    const index = filteredQuestions().findIndex((q) => q.id === id);
    if (index >= 0) state.listPage = Math.floor(index / PAGE_SIZE);
    renderList(); renderQuestion();
    if (updateHash) updateFragment(id);
    rememberQuestion(id);
    if (scroll && window.innerWidth < 761) $('question-workspace').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function applyFilters() {
    if (resetChanged()) refreshProgress({render:false});
    if (testController?.isActive()) return;
    state.listPage = 0;
    const questions = filteredQuestions();
    if (!questions.some((q) => q.id === state.currentId)) {
      pauseTimer();
      state.currentId = questions[0]?.id || null;
      state.reveal = false; resetTimer(currentQuestion());
    }
    renderList(); renderQuestion();
    if (state.currentId) { updateFragment(state.currentId); rememberQuestion(state.currentId); }
  }
  function clearFilters() {
    state.filters = {paper:'all',year:'all',topic:'all',status:'all',search:''};
    $('search').value = '';
    ['year','topic','status'].forEach((name) => { $(`${name}-filter`).value = 'all'; });
    document.querySelectorAll('[data-paper]').forEach((button) => { const selected = button.dataset.paper === 'all'; button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected)); });
    applyFilters();
  }
  function showView(view) {
    state.view = view;
    for (const name of ['practice','sources','test']) {
      if ($(`${name}-view`)) $(`${name}-view`).hidden = view !== name;
      if ($(`${name}-tab`)) $(`${name}-tab`).classList.toggle('active',view === name);
    }
  }
  function switchView(view) {
    if (testController?.isActive() && view !== 'test') { notify('Submit your test before leaving this paper.'); return; }
    pauseTimer();
    showView(view);
    if (view === 'practice') { resetTimer(currentQuestion()); renderSummary(); renderList(); renderQuestion(); if (state.currentId) updateFragment(state.currentId); }
    if (view === 'sources') $('sources-view').focus({preventScroll:true});
    if (view === 'test') testController?.open();
  }
  function testActivityChanged(active) {
    for (const id of ['practice-tab','sources-tab']) $(id).disabled = active;
    document.querySelector('.brand').setAttribute('aria-disabled',String(active));
    if ($('browser-paper-bar')) $('browser-paper-bar').hidden = active || !window.TMUA_BROWSER;
    if (active) {
      pauseTimer(); state.reveal = false;
      for (const id of ['image-dialog','paper-manager']) { const dialog = $(id); if (dialog?.open && typeof dialog.close === 'function') dialog.close(); }
      const workspace = $('question-workspace'); workspace.innerHTML = ''; delete workspace.dataset.questionId;
      showView('test');
    }
  }
  function recordTestAttempts(entries) {
    if (resetChanged()) { refreshProgress({render:false}); return; }
    let changed = false;
    for (const entry of entries) {
      const q = state.data.questions.find((item) => item.id === entry.questionId); if (!q) continue;
      const key = `${q.id}:${entry.id}`;
      const saved = knownMemoryEvents.has(key) || memory?.append(entry);
      if (saved) knownMemoryEvents.add(key);
      if (saved && entry.selected && record(q).attemptId !== entry.id && (!record(q).updatedAt || Date.parse(entry.completedAt) > Date.parse(record(q).updatedAt))) {
        saveProgress(q,'attempt',{selected:entry.selected,marked:true,elapsedSeconds:entry.elapsedSeconds,updatedAt:entry.completedAt,attemptId:entry.id});
        changed = true;
      }
    }
    if (changed) renderSummary();
    if (changed && state.view === 'practice') { resetTimer(currentQuestion()); renderList(); renderQuestion(); }
  }
  function renderSources() {
    const meta = state.data.meta || {};
    const coverage = Array.isArray(meta.coverage) ? meta.coverage.join(', ') : meta.coverage;
    $('coverage-note').textContent = coverage || `${state.data.questions.length} questions across ${state.data.papers.length} papers, with their official worked solutions.`;
    $('official-source').href = meta.sourceUrl || 'https://esat-tmua.ac.uk/tmua-preparation-materials/';
    $('archive-count').textContent = `${state.data.papers.length} papers`;
    $('paper-library').innerHTML = state.data.papers.map((p) => `<article class="paper-card"><span class="paper-glyph" aria-hidden="true">${escape(p.paper)}</span><div><h3>${escape(p.title || `${yearLabel(p)} · Paper ${p.paper}`)}</h3><p>${escape(p.questionCount || state.data.questions.filter((q) => q.paperId === p.id).length)} questions · ${Number(p.paper) === 1 ? 'Mathematical Thinking' : 'Mathematical Reasoning'}</p><div class="paper-links">${p.questionPdf ? `<a href="${escape(p.questionPdf)}" target="_blank" rel="noopener noreferrer">Question paper ↗</a>` : ''}${p.solutionPdf ? `<a href="${escape(p.solutionPdf)}" target="_blank" rel="noopener noreferrer">Worked solutions ↗</a>` : ''}${p.answerKeyPdf ? `<a href="${escape(p.answerKeyPdf)}" target="_blank" rel="noopener noreferrer">Answer key ↗</a>` : ''}</div></div></article>`).join('');
    if (meta.importedAt) { const d = new Date(meta.importedAt); $('import-date').textContent = Number.isNaN(d.getTime()) ? `Archive imported: ${meta.importedAt}` : `Archive imported ${d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}.`; }
  }
  function bindEvents() {
    $('mobile-filter-toggle').addEventListener('click', (e) => { const expanded = document.querySelector('.sidebar').classList.toggle('expanded'); e.currentTarget.setAttribute('aria-expanded',String(expanded)); });
    $('search').addEventListener('input', (e) => { state.filters.search = e.target.value; applyFilters(); });
    ['year','topic','status'].forEach((name) => $(`${name}-filter`).addEventListener('change', (e) => { state.filters[name] = e.target.value; applyFilters(); }));
    $('paper-filter').addEventListener('click', (e) => { const button = e.target.closest('[data-paper]'); if (!button) return; state.filters.paper = button.dataset.paper; document.querySelectorAll('[data-paper]').forEach((b) => { const selected = b === button; b.classList.toggle('selected',selected); b.setAttribute('aria-pressed',String(selected)); }); applyFilters(); });
    $('clear-filters').addEventListener('click',clearFilters); $('empty-clear').addEventListener('click',clearFilters);
    $('list-prev').addEventListener('click',() => { state.listPage--; renderList(); });
    $('list-next').addEventListener('click',() => { state.listPage++; renderList(); });
    $('question-list').addEventListener('click',(e) => { const row = e.target.closest('[data-question]'); if (row) selectQuestion(row.dataset.question,{scroll:true}); });
    $('practice-tab').addEventListener('click',() => switchView('practice'));
    $('test-tab').addEventListener('click',() => switchView('test'));
    $('sources-tab').addEventListener('click',() => switchView('sources'));
    $('source-shortcut').addEventListener('click',() => switchView('sources'));
    document.querySelector('.brand').addEventListener('click',(e) => { e.preventDefault(); switchView('practice'); });
    $('reset-progress').addEventListener('click',() => { if (testController?.isActive()) return; if (!window.confirm('Reset all saved answers, attempt history, tests and bookmarks in this app?')) return; resetProgress(); state.reveal = false; resetTimer(currentQuestion()); renderSummary(); applyFilters(); notify('Your progress, history, tests and bookmarks have been reset.'); });
    $('question-workspace').addEventListener('click',(e) => {
      if (testController?.isActive()) return;
      if (!allowPracticeAction()) return;
      const q = currentQuestion(); if (!q) return;
      const optionButton = e.target.closest('[data-option]');
      if (optionButton && !record(q).marked) { const selected = optionButton.dataset.option; if (!optionsOf(q).map((option) => option.trim().toUpperCase()).includes(selected)) return; saveProgress(q,'attempt',{...record(q),selected,attemptId:practiceAttemptId,updatedAt:new Date().toISOString()}); persistDraft(q); renderQuestion(); return; }
      const button = e.target.closest('button'); if (!button) return;
      if (button.id === 'bookmark-question') { const previous = record(q); saveProgress(q,'bookmark',{bookmarked:!previous.bookmarked}); if (previous.marked !== record(q).marked || previous.selected !== record(q).selected) resetTimer(q); renderSummary(); renderList(); renderQuestion(); }
      if (button.id === 'mark-answer') { const r = record(q), answer = answerOf(q); if (!r.selected || r.marked || !answer) return; pauseTimer(); const completedAt = new Date().toISOString(), elapsed = elapsedSeconds(), id = practiceAttemptId || newAttemptId(); memory?.append({id,questionId:q.id,selected:r.selected,elapsedSeconds:elapsed,mode:'practice',completedAt}); saveProgress(q,'attempt',{...r,marked:true,elapsedSeconds:elapsed,updatedAt:completedAt,attemptId:id}); renderSummary(); renderList(); renderQuestion(); }
      if (button.id === 'reveal-solution') { state.reveal = !state.reveal; renderQuestion(); if (state.reveal) $('question-workspace').querySelector('.solution-panel')?.scrollIntoView({behavior:'smooth',block:'nearest'}); }
      if (button.id === 'retry-question') { const draft = loadDraft(q,true); saveProgress(q,'attempt',{selected:'',marked:false,elapsedSeconds:0,attemptId:draft.id,updatedAt:new Date().toISOString()}); state.reveal = false; resetTimer(q); persistDraft(q); renderSummary(); renderList(); renderQuestion(); }
      if (['previous-question','next-question','random-question'].includes(button.id)) { const navigation = navigationQuestions(q); const next = button.id === 'random-question' ? navigation.random[Math.floor(Math.random() * navigation.random.length)] : button.id === 'next-question' ? navigation.next : navigation.previous; if (next) selectQuestion(next.id,{scroll:true}); }
    });
    window.addEventListener('hashchange',() => { if (testController?.isActive()) return; let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; } if (state.data.questions.some((q) => q.id === id)) { switchView('practice'); if (!filteredQuestions().some((q) => q.id === id)) clearFilters(); selectQuestion(id); } });
    window.addEventListener('storage',(e) => { if (e.storageArea && e.storageArea !== localStorage) return; if (e.key === null || e.key === STORAGE_KEY || e.key === RESET_KEY || e.key?.startsWith(ATTEMPT_PREFIX) || e.key?.startsWith(BOOKMARK_PREFIX) || e.key?.startsWith('tmua-question-bank-history-') || e.key?.startsWith('tmua-test-')) refreshProgress(); });
    window.addEventListener('focus',() => refreshProgress());
    document.addEventListener('visibilitychange',() => { if (document.hidden) pauseTimer(); else { refreshProgress(); resumeTimer(); } });
    window.addEventListener('pagehide',pauseTimer);
    document.addEventListener('keydown',(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (testController?.isActive()) return; switchView('practice'); $('search').focus(); } });
    setInterval(() => { const timer = $('question-timer'); if (timer) timer.textContent = elapsedTime(); if (state.timerRunning && Date.now()-lastCheckpoint >= 5000) persistDraft(); }, 1000);
  }
  async function initialize() {
    if (window.TMUA_BOOT) await window.TMUA_BOOT;
    if (window.TMUA_BROWSER && !window.TMUA_BROWSER.repository) {
      $('loading').hidden = true; $('error').hidden = false; $('error-detail').textContent = window.TMUA_BROWSER.error || 'The source list could not load. Reload this page to try again.'; return;
    }
    if (window.TMUA_CONTENT_READY === false) {
      $('loading').hidden = true; $('setup').hidden = false;
      const download = $('download-papers'), status = $('download-status'), progress = $('download-progress');
      download.addEventListener('click',() => {
        if (!window.chrome?.webview) { status.textContent = 'Open the Windows app to download the papers.'; return; }
        download.disabled = true; progress.hidden = false; status.textContent = 'Starting download…';
        window.chrome.webview.postMessage({type:'download-papers'});
      });
      window.tmuaDownloadProgress = (update) => {
        status.textContent = update.message || '';
        progress.hidden = false; progress.max = update.total || 45; progress.value = update.completed || 0;
        if (update.state === 'complete') location.reload();
        if (update.state === 'error') { download.disabled = false; download.textContent = 'Retry download'; }
      };
      return;
    }
    try {
      let data = window.TMUA_DATA;
      if (!data) {
        const response = await fetch('data/questions.json');
        if (!response.ok) throw new Error(`Question data returned HTTP ${response.status}.`);
        data = await response.json();
      }
      if (!Array.isArray(data.questions) || !Array.isArray(data.papers) || !data.questions.length) throw new Error('The archive does not contain any imported questions yet.');
      const ids = new Set();
      for (const q of data.questions) { if (!q.id || ids.has(q.id)) throw new Error('The archive contains a missing or duplicate question ID.'); ids.add(q.id); }
      data.questions.sort((a,b) => (Number(b.year) || 0) - (Number(a.year) || 0) || Number(a.paper) - Number(b.paper) || Number(a.number) - Number(b.number));
      data.papers.sort((a,b) => (Number(b.year) || 0) - (Number(a.year) || 0) || Number(a.paper) - Number(b.paper));
      state.data = data;
      normalizeProgress();
      refreshProgress({render:false});
      memory = window.TMUA_Memory?.create({getGeneration:() => progressGeneration,getQuestion:(id) => state.data.questions.find((q) => q.id === id),onStorageError:storageWarning});
      for (const q of state.data.questions) memory?.migrate(q,record(q));
      if (memory) knownMemoryEvents = new Set(memory.all().map((entry) => `${entry.questionId}:${entry.id}`));
      const years = [...new Set(data.questions.map((q) => String(q.year)))].sort((a,b) => (Number(b) || 0) - (Number(a) || 0));
      $('year-filter').insertAdjacentHTML('beforeend',years.map((y) => `<option value="${escape(y)}">${escape(y)}</option>`).join(''));
      const topics = [...new Set(data.questions.map(topicLabel))].sort((a,b) => a.localeCompare(b));
      $('topic-filter').insertAdjacentHTML('beforeend',topics.map((t) => `<option value="${escape(t)}">${escape(t)}</option>`).join(''));
      bindEvents(); renderSummary(); renderSources();
      if (window.TMUA_BROWSER) {
        const browser = window.TMUA_BROWSER, manager = $('paper-manager'), input = $('import-papers-files'), importButton = $('import-papers'), status = $('browser-import-status');
        $('browser-paper-bar').hidden = false;
        $('browser-paper-summary').textContent = browser.status.completed ? `${browser.status.completed} of ${browser.status.total} PDFs stored on this device.` : 'Viewing original publisher PDFs online.';
        status.textContent = browser.error || `${browser.status.completed} of ${browser.status.total} official PDFs stored.`;
        $('browser-download-list').innerHTML = browser.repository.sources.map((source) => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} ↗</a>`).join('');
        const showManager = () => manager.showModal();
        $('manage-papers').addEventListener('click',() => { if (!testController?.isActive()) showManager(); });
        $('close-paper-manager').addEventListener('click',() => manager.close());
        importButton.addEventListener('click',() => input.click());
        document.addEventListener('click',(event) => { if (!testController?.isActive() && event.target.closest('.import-region-pdf')) showManager(); });
        window.tmuaDownloadProgress = (update) => {
          status.textContent = update.message || '';
          importButton.disabled = update.state === 'importing';
          $('browser-paper-summary').textContent = `${update.completed || 0} of ${update.total || 45} PDFs stored on this device.`;
          if (update.state === 'complete') location.reload();
        };
        input.addEventListener('change',async () => {
          try { if (input.files?.length) await browser.importFiles([...input.files]); }
          catch (error) { status.textContent = error.message; importButton.disabled = false; }
          input.value = '';
        });
        browser.rewriteLinks($('sources-view'));
      }
      window.addEventListener('tmua-pdf-ready',() => { window.TMUA_PDFRenderer?.mount($('question-workspace')); window.TMUA_PDFRenderer?.mount($('test-view')); });
      $('close-image-dialog').addEventListener('click',() => $('image-dialog').close());
      let hashId = ''; try { hashId = decodeURIComponent(location.hash.slice(1)); } catch (_) { /* Ignore invalid external fragments. */ }
      let lastId = ''; try { lastId = localStorage.getItem(LAST_QUESTION_KEY) || ''; } catch (_) {}
      selectQuestion(ids.has(hashId) ? hashId : ids.has(lastId) ? lastId : data.questions[0].id);
      testController = window.TMUA_TestMode?.create({data,host:$('test-view'),renderImages:imageMarkup,getGeneration:() => progressGeneration,onActiveChange:testActivityChanged,onComplete:recordTestAttempts,onBack:() => switchView('practice'),onStorageError:storageWarning});
      if (testController && $('test-view').querySelector('#test-results')) { pauseTimer(); showView('test'); }
      $('loading').hidden = true; $('app').hidden = false;
    } catch (error) {
      $('loading').hidden = true; $('error').hidden = false;
      $('error-detail').textContent = location.protocol === 'file:' ? `The local question data could not load. Keep index.html alongside the data and assets folders, then reopen it. ${error.message}` : `Please close and reopen the app. ${error.message}`;
    }
  }
  initialize();
})();
