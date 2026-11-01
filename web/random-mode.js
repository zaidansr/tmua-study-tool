'use strict';

// Random-mode results are immutable events. A late write or a second tab cannot
// replace another attempt; schedules are derived in completion order.
(function (root) {
  const PREFIX = 'tmua-random-attempt-v1:';
  const SETTINGS_KEY = 'tmua-random-settings-v1';
  const RESET_KEY = 'tmua-question-bank-reset-v2';
  const DEFAULTS = Object.freeze({wrongMinutes:8,correctMinutes:20});
  const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value);
  const generationName = (value) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value) ? value : 'legacy';

  function create(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const onStorageError = typeof options.onStorageError === 'function' ? options.onStorageError : () => {};
    const warn = (error) => { try { onStorageError(error); } catch (_) { /* Saving must not block study. */ } };
    const getQuestion = typeof options.getQuestion === 'function' ? options.getQuestion :
      (id) => root.TMUA_DATA?.questions?.find((question) => question.id === id);
    let storage;
    try { storage = own(options,'storage') ? options.storage : root.localStorage; } catch (error) { warn(error); }
    let activeGeneration;
    const getGeneration = typeof options.getGeneration === 'function' ? options.getGeneration : () => {
      try { return storage?.getItem(RESET_KEY) || 'legacy'; } catch (error) { warn(error); return activeGeneration || 'legacy'; }
    };
    const session = new Map(), pending = new Map();
    let intervalSettings = {...DEFAULTS}, pendingSettings = null;

    function generation() {
      let next = activeGeneration || 'legacy';
      try { next = generationName(getGeneration()); } catch (error) { warn(error); }
      if (activeGeneration !== undefined && next !== activeGeneration) { session.clear(); pending.clear(); }
      activeGeneration = next;
      return next;
    }
    function validQuestion(id) {
      if (!identifier(id)) return false;
      try { const q = getQuestion(id); return object(q) && q.id === id; } catch (_) { return false; }
    }
    function keyFor(current,questionId,id) { return `${PREFIX}${current}:${encodeURIComponent(questionId)}:${encodeURIComponent(id)}`; }
    function normalized(raw) {
      if (!object(raw) || !identifier(raw.id) || !validQuestion(raw.questionId) || typeof raw.correct !== 'boolean') return undefined;
      let timestamp;
      if (typeof raw.completedAt === 'string') timestamp = Date.parse(raw.completedAt);
      else if (typeof raw.completedAt === 'number') timestamp = raw.completedAt;
      if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8639999913600000) return undefined;
      return {id:raw.id,questionId:raw.questionId,correct:raw.correct,completedAt:new Date(timestamp).toISOString()};
    }
    function parse(value) {
      if (typeof value !== 'string') return undefined;
      try { const raw = JSON.parse(value); return raw?.version === 1 ? normalized(raw) : undefined; } catch (_) { return undefined; }
    }
    function validatedSettings(value) {
      if (!object(value)) return undefined;
      const {wrongMinutes,correctMinutes} = value;
      if (![wrongMinutes,correctMinutes].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 1440)) return undefined;
      return {wrongMinutes,correctMinutes};
    }
    function readSettings() {
      if (pendingSettings) return intervalSettings;
      try {
        const raw = storage?.getItem(SETTINGS_KEY);
        if (raw === null || raw === undefined) intervalSettings = {...DEFAULTS};
        else {
          let parsed;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
          intervalSettings = parsed?.version === 1 && validatedSettings(parsed) || {...DEFAULTS};
        }
      } catch (error) { warn(error); }
      return intervalSettings;
    }
    function serialized(entry) { return JSON.stringify({version:1,...entry}); }
    function flush() {
      const current = generation();
      if (pendingSettings) {
        try {
          if (!storage || typeof storage.setItem !== 'function') throw new Error('Random-mode settings storage is unavailable.');
          storage.setItem(SETTINGS_KEY,pendingSettings); pendingSettings = null;
        } catch (error) { warn(error); }
      }
      for (const [key,value] of pending) {
        if (!key.startsWith(`${PREFIX}${current}:`)) { pending.delete(key); continue; }
        try {
          if (!storage || typeof storage.setItem !== 'function') throw new Error('Random-mode schedule storage is unavailable.');
          const existing = parse(storage.getItem(key));
          if (existing && keyFor(current,existing.questionId,existing.id) === key) session.set(key,serialized(existing));
          else storage.setItem(key,value);
          pending.delete(key);
        } catch (error) { warn(error); break; }
      }
    }
    function events() {
      const current = generation(), prefix = `${PREFIX}${current}:`;
      flush();
      const keys = new Set([...session.keys()].filter((key) => key.startsWith(prefix)));
      try {
        const length = storage?.length;
        if (storage && Number.isSafeInteger(length) && length >= 0 && typeof storage.key === 'function') {
          for (let i = 0; i < length; i++) { const key = storage.key(i); if (typeof key === 'string' && key.startsWith(prefix)) keys.add(key); }
        }
      } catch (error) { warn(error); }
      const entries = [];
      for (const key of keys) {
        let value = session.get(key);
        if (!value) { try { value = storage?.getItem(key); } catch (error) { warn(error); } }
        const event = parse(value);
        if (event && keyFor(current,event.questionId,event.id) === key) {
          session.set(key,serialized(event)); entries.push(event);
        }
      }
      return entries.sort((a,b) => Date.parse(a.completedAt)-Date.parse(b.completedAt) || a.id.localeCompare(b.id));
    }
    function schedules() {
      const result = new Map(), settings = readSettings();
      for (const event of events()) {
        const previous = result.get(event.questionId), hadWrong = !event.correct || Boolean(previous?.hadWrong);
        const status = hadWrong ? 'review' : 'completed';
        const delay = (event.correct ? settings.correctMinutes : settings.wrongMinutes) * 60000;
        result.set(event.questionId,{...event,hadWrong,status,dueAt:status === 'review' ? Date.parse(event.completedAt)+delay : null});
      }
      return result;
    }
    function settings() { flush(); return {...readSettings()}; }
    function saveSettings(value) {
      const next = validatedSettings(value); if (!next) return false;
      intervalSettings = next; pendingSettings = JSON.stringify({version:1,...next}); flush();
      return {...intervalSettings};
    }
    function record(raw) {
      const current = generation();
      const entry = normalized({...raw,completedAt:raw?.completedAt === undefined ? now() : raw.completedAt});
      if (!entry) return undefined;
      const key = keyFor(current,entry.questionId,entry.id);
      let existing = parse(session.get(key));
      if (!existing) { try { existing = parse(storage?.getItem(key)); } catch (error) { warn(error); } }
      if (existing && keyFor(current,existing.questionId,existing.id) === key) session.set(key,serialized(existing));
      else { const value = serialized(entry); session.set(key,value); pending.set(key,value); }
      flush();
      return get(entry.questionId);
    }
    function questionIds(ids) { return [...new Set(Array.isArray(ids) ? ids : [])].filter(validQuestion); }
    function next(ids,{excludeId} = {}) {
      const states = schedules(), candidates = questionIds(ids), timestamp = Number(now());
      const due = candidates.map((id) => states.get(id)).filter((entry) => entry?.status === 'review' && entry.dueAt <= timestamp)
        .sort((a,b) => a.dueAt-b.dueAt || a.questionId.localeCompare(b.questionId));
      const preferred = due.filter((entry) => entry.questionId !== excludeId);
      if (preferred.length || due.length) return (preferred[0] || due[0]).questionId;
      const fresh = candidates.filter((id) => id !== excludeId && !states.has(id));
      if (!fresh.length) return null;
      let fraction;
      try { fraction = Number(random()); } catch (_) { fraction = 0; }
      if (!Number.isFinite(fraction)) fraction = 0;
      return fresh[Math.max(0,Math.min(fresh.length-1,Math.floor(fraction*fresh.length)))];
    }
    function summary(ids) {
      const states = schedules(), result = {due:0,pending:0,fresh:0,nextDueAt:null,completed:0}, timestamp = Number(now());
      for (const id of questionIds(ids)) {
        const entry = states.get(id);
        if (!entry) result.fresh++;
        else if (entry.status === 'completed') result.completed++;
        else {
          if (entry.dueAt <= timestamp) result.due++; else result.pending++;
          if (result.nextDueAt === null || entry.dueAt < result.nextDueAt) result.nextDueAt = entry.dueAt;
        }
      }
      return result;
    }
    function get(id) { return validQuestion(id) ? schedules().get(id) : undefined; }
    function refresh() { flush(); readSettings(); }
    function reset() { generation(); session.clear(); pending.clear(); }
    function isStorageKey(key) { return key === null || key === RESET_KEY || key === SETTINGS_KEY || typeof key === 'string' && key.startsWith(PREFIX); }
    return {settings,saveSettings,record,next,summary,get,refresh,reset,isStorageKey};
  }

  const api = {create,PREFIX,SETTINGS_KEY,RESET_KEY,DEFAULTS};
  root.TMUA_RandomMode = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
