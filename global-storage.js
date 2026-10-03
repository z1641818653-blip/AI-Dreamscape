(function () {
  'use strict';
  const SETTINGS_KEY = 'dreamscape_global_storage_v1';
  const CACHE_KEY = 'dreamscape_page_cache_v1';
  let dirty = false, saveTimer, restoring = false, context = '';
  function read(key) {
    try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }
  function getSettings() { return { exitProtection:true, ...read(SETTINGS_KEY) }; }
  const cacheId = () => context ? `${location.pathname}#${context}` : location.pathname;
  const sensitive = element => element.matches('[data-key], [data-sensitive], [type="password"], [type="file"]') || /api.?key|password|secret|^key-/i.test(element.id || element.name || '');
  function isCacheable(element) {
    return element instanceof HTMLElement && !element.closest('[data-no-page-cache]') && element.matches('[data-page-cache]') && !sensitive(element) && !element.readOnly && !element.disabled;
  }
  function scrub() {
    try {
      const original = localStorage.getItem(CACHE_KEY);
      if (!original) return;
      const clean = JSON.stringify(DreamscapeBackup.cleanCaches(read(CACHE_KEY)));
      if (clean !== original) localStorage.setItem(CACHE_KEY, clean);
    } catch (error) { console.warn('清理旧缓存未完成', error.name); }
  }
  function persist() {
    if (!dirty) return true;
    try {
      const fields = {};
      for (const element of [...document.querySelectorAll('[data-page-cache]')].filter(isCacheable).slice(0, 200)) {
        const key = element.id || element.name;
        if (!key) continue;
        fields[key] = { type:element.type || element.tagName, checked:element.checked, value:String(element.isContentEditable ? element.textContent : element.value || '').slice(0, 100000) };
      }
      const caches = DreamscapeBackup.cleanCaches(read(CACHE_KEY));
      if (!Object.keys(fields).length) return true;
      caches[cacheId()] = { path:location.pathname, context, title:document.title, updatedAt:new Date().toISOString(), dirty:true, fieldCount:Object.keys(fields).length, fields };
      localStorage.setItem(CACHE_KEY, JSON.stringify(caches));
      return true;
    } catch { return false; }
  }
  function markDirty() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); }
  function markSaved() {
    clearTimeout(saveTimer); dirty = false;
    try {
      const caches = read(CACHE_KEY);
      if (caches[cacheId()]) { delete caches[cacheId()]; localStorage.setItem(CACHE_KEY, JSON.stringify(caches)); }
    } catch {}
  }
  function offerRestore() {
    if (/settings\.html$/i.test(location.pathname)) return;
    const record = read(CACHE_KEY)[cacheId()];
    if (!record?.dirty || !record.fields) return;
    const entries = Object.entries(record.fields).filter(([key, saved]) => isCacheable(document.getElementById(key)) && (saved.value || saved.checked));
    if (!entries.length) return;
    if (!confirm('发现当前文档或对话的未发送草稿，是否恢复？')) { markSaved(); return; }
    restoring = true;
    try {
      for (const [key, saved] of entries) {
        const element = document.getElementById(key);
        if (/checkbox|radio/.test(element.type)) element.checked = Boolean(saved.checked);
        else if (element.isContentEditable) element.textContent = saved.value || '';
        else element.value = saved.value || '';
        element.dispatchEvent(new Event('input', { bubbles:true }));
      }
      dirty = true;
      return true;
    } finally { restoring = false; }
  }
  function setContext(next) {
    next = String(next || '');
    if (next === context) return;
    persist(); clearTimeout(saveTimer); dirty = false; context = next;
    for (const element of [...document.querySelectorAll('[data-page-cache]')].filter(isCacheable)) element.value = '';
    if (document.readyState !== 'loading') return offerRestore();
  }
  const changed = event => {
    if (restoring) return;
    if (isCacheable(event.target) || event.target instanceof HTMLElement && event.target.matches('[data-unsaved]')) markDirty();
  };
  document.addEventListener('input', changed, true);
  document.addEventListener('change', changed, true);
  window.addEventListener('beforeunload', event => {
    persist();
    if (!dirty || !getSettings().exitProtection) return;
    event.preventDefault(); event.returnValue = '';
  });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.DreamscapeStorage = { persist, markSaved, markDirty, getSettings, setContext };
  scrub();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(offerRestore, 0), { once:true });
  else setTimeout(offerRestore, 0);
})();
