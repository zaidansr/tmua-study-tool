(function () {
  'use strict';
  const key = 'tmua-theme-v1', root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try { const saved = localStorage.getItem(key); if (saved === 'dark' || saved === 'light') preference = saved; } catch (_) {}
  function apply() {
    const dark = preference ? preference === 'dark' : system.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark ? '#171717' : '#ffffff');
    const button = document.getElementById('theme-toggle');
    if (button) button.setAttribute('aria-pressed',String(dark));
  }
  apply();
  document.addEventListener('DOMContentLoaded',() => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click',() => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key,preference); } catch (_) {}
      apply();
    });
  });
  system.addEventListener('change',() => { if (!preference) apply(); });
  window.addEventListener('storage',(event) => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
    apply();
  });
})();
