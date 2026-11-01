'use strict';

// Each completed try has its own storage key. Independent tabs therefore add
// history without rewriting a shared array or replacing an earlier attempt.
(function (root) {
  const PREFIX = 'tmua-question-bank-history-v1:';
  const RESET_KEY = 'tmua-question-bank-reset-v2';
  const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value);
  const generationName = (value) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value) ? value : 'legacy';
  let sequence = 0;

  function create(options = {}) {
    const onStorageError = typeof options.onStorageError === 'function' ? options.onStorageError : () => {};
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const getQuestion = typeof options.getQuestion === 'function' ? options.getQuestion :
      (id) => root.TMUA_DATA?.questions?.find((question) => question.id === id);
    const warn = (error) => { try { onStorageError(error); } catch (_) { /* Storage callbacks must not interrupt practice. */ } };
    let storage;
    try { storage = own(options,'storage') ? options.storage : root.localStorage; } catch (error) { warn(error); }
    const getGeneration = typeof options.getGeneration === 'function' ? options.getGeneration : () => {
      try { return storage?.getItem(RESET_KEY) || 'legacy'; } catch (error) { warn(error); return activeGeneration || 'legacy'; }
    };
    const pending = new Map(), session = new Map();
    let activeGeneration;

    function generation() {
      let next = activeGeneration || 'legacy';
      try { next = generationName(getGeneration()); } catch (error) { warn(error); }
      if (activeGeneration !== undefined && next !== activeGeneration) {
        pending.clear(); session.clear();
      }
      activeGeneration = next;
      return next;
    }
    function eventKey(current,questionId,id) {
      return `${PREFIX}${current}:${encodeURIComponent(questionId)}:${encodeURIComponent(id)}`;
    }
    function questionFor(id,provided) {
      try { const question = provided || getQuestion(id); return object(question) && question.id === id ? question : undefined; }
      catch (_) { return undefined; }
    }
    function normalized(raw,provided) {
      if (!object(raw) || !identifier(raw.id) || !identifier(raw.questionId)) return undefined;
      const question = questionFor(raw.questionId,provided);
      if (!question || typeof question.answer !== 'string') return undefined;
      const answer = question.answer.trim().toUpperCase();
      const letters = (Array.isArray(question.options) && question.options.length ? question.options : ['A','B','C','D','E'])
        .map((option) => typeof option === 'string' ? option : String(option?.label || option?.letter || option?.value || ''))
        .map((option) => option.trim().toUpperCase());
      if (!/^[A-Z]$/.test(answer) || !letters.includes(answer)) return undefined;
      const mode = raw.mode === 'test' ? 'test' : raw.mode === 'practice' ? 'practice' : undefined;
      if (!mode) return undefined;
      const selected = typeof raw.selected === 'string' ? raw.selected.trim().toUpperCase() : '';
      if ((selected && !letters.includes(selected)) || (!selected && mode !== 'test')) return undefined;
      const migrated = raw.migrated === true && raw.id === `legacy-${raw.questionId}` && mode === 'practice';
      const elapsedSeconds = Number.isSafeInteger(raw.elapsedSeconds) && raw.elapsedSeconds >= 0 ? raw.elapsedSeconds :
        migrated && raw.elapsedSeconds === null ? null : undefined;
      if (elapsedSeconds === undefined) return undefined;
      let completedAt = null;
      if (typeof raw.completedAt === 'string' && Number.isFinite(Date.parse(raw.completedAt))) completedAt = new Date(raw.completedAt).toISOString();
      else if (!(migrated && raw.completedAt === null)) return undefined;
      const correct = Boolean(selected) && selected === answer;
      const result = {questionId:question.id,id:raw.id,selected,correct,outcome:selected ? correct ? 'correct' : 'wrong' : 'unanswered',elapsedSeconds,mode,completedAt};
      if (identifier(raw.testId) && mode === 'test') result.testId = raw.testId;
      return result;
    }
    function parse(value,provided) {
      if (typeof value !== 'string') return undefined;
      try { const raw = JSON.parse(value); return object(raw) && raw.version === 1 ? normalized(raw,provided) : undefined; } catch (_) { return undefined; }
    }
    function serialized(record,migrated = false) {
      return JSON.stringify({version:1,...record,...(migrated ? {migrated:true} : {})});
    }
    function read(key,provided) {
      let record;
      if (session.has(key)) record = parse(session.get(key),provided);
      else try { record = parse(storage?.getItem(key),provided); } catch (error) { warn(error); }
      return record && eventKey(activeGeneration || 'legacy',record.questionId,record.id) === key ? record : undefined;
    }
    function flush() {
      const current = generation(), prefix = `${PREFIX}${current}:`;
      if (!pending.size) return true;
      for (const [key,value] of pending) {
        if (!key.startsWith(prefix)) { pending.delete(key); continue; }
        try {
          if (!storage || typeof storage.setItem !== 'function') throw new Error('Local attempt history storage is unavailable.');
          // Never change a completed attempt if the same event was already saved.
          const existing = parse(storage.getItem(key));
          if (existing && eventKey(current,existing.questionId,existing.id) === key) session.set(key,serialized(existing,existing.id === `legacy-${existing.questionId}`));
          else storage.setItem(key,value);
          pending.delete(key);
        } catch (error) { warn(error); return false; }
      }
      return !pending.size;
    }
    function entries(questionId) {
      const current = generation(), prefix = `${PREFIX}${current}:${questionId ? encodeURIComponent(questionId)+':' : ''}`;
      flush();
      const keys = new Set([...session.keys()].filter((key) => key.startsWith(prefix)));
      try {
        const length = storage?.length;
        if (storage && Number.isSafeInteger(length) && length >= 0 && typeof storage.key === 'function') {
          for (let index = 0; index < length; index++) {
            const key = storage.key(index);
            if (typeof key === 'string' && key.startsWith(prefix)) keys.add(key);
          }
        }
      } catch (error) { warn(error); }
      const result = [];
      for (const key of keys) {
        const entry = read(key);
        if (entry && eventKey(current,entry.questionId,entry.id) === key) result.push(entry);
      }
      return result.sort((a,b) => (Date.parse(a.completedAt || '') || 0) - (Date.parse(b.completedAt || '') || 0) || a.id.localeCompare(b.id));
    }
    function all() { return entries(); }
    function list(questionId) { return identifier(questionId) ? entries(questionId) : []; }
    function createId() {
      try { if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID(); } catch (_) { /* Unique fallback for older browsers. */ }
      const timestamp = Number(now());
      return `try-${(Number.isFinite(timestamp) ? timestamp : Date.now()).toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }
    function append(entry) {
      if (!object(entry)) return undefined;
      const current = generation();
      let completedAt = entry.completedAt;
      if (completedAt === undefined) {
        const value = Number(now());
        if (!Number.isFinite(value)) return undefined;
        try { completedAt = new Date(value).toISOString(); } catch (_) { return undefined; }
      } else if (typeof completedAt === 'number' && Number.isFinite(completedAt)) {
        try { completedAt = new Date(completedAt).toISOString(); } catch (_) { return undefined; }
      }
      const record = normalized({...entry,completedAt});
      if (!record) return undefined;
      const key = eventKey(current,record.questionId,record.id), existing = read(key);
      if (existing) { flush(); return existing; }
      const value = serialized(record);
      session.set(key,value); pending.set(key,value); flush();
      return read(key) || record;
    }
    function migrate(question,latest) {
      if (!object(question) || !identifier(question.id) || !object(latest) || latest.marked !== true) return undefined;
      if (identifier(latest.attemptId)) return undefined;
      if (list(question.id).length) return undefined;
      const current = generation(), id = `legacy-${question.id}`;
      const completedAt = typeof latest.updatedAt === 'string' && Number.isFinite(Date.parse(latest.updatedAt)) ? new Date(latest.updatedAt).toISOString() : null;
      const raw = {questionId:question.id,id,selected:latest.selected,elapsedSeconds:Number.isSafeInteger(latest.elapsedSeconds) && latest.elapsedSeconds >= 0 ? latest.elapsedSeconds : null,mode:'practice',completedAt,migrated:true};
      const record = normalized(raw,question);
      if (!record) return undefined;
      const key = eventKey(current,question.id,id), value = serialized(record,true);
      session.set(key,value); pending.set(key,value); flush();
      return record;
    }
    return {createId,append,list,all,migrate,flush};
  }

  const api = {create,PREFIX,RESET_KEY};
  root.TMUA_Memory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
