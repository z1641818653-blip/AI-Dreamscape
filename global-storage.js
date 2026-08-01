(function () {
  'use strict';

  const SETTINGS_KEY = 'dreamscape_global_storage_v1';
  const CACHE_KEY = 'dreamscape_page_cache_v1';
  const MAX_FIELD_LENGTH = 100000;
  const MAX_FIELDS = 200;
  let dirty = false;
  let saveTimer = null;
  let restoring = false;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function getSettings() {
    return { exitProtection: true, ...readJson(SETTINGS_KEY, {}) };
  }

  function isCacheableField(element) {
    if (!(element instanceof HTMLElement) || element.closest('[data-no-page-cache]')) return false;
    if (element.matches('[contenteditable="true"]')) return true;
    if (!element.matches('input, textarea, select')) return false;
    const type = String(element.type || '').toLowerCase();
    return !['password', 'file', 'hidden', 'button', 'submit', 'reset', 'image'].includes(type);
  }

  function fieldKey(element, index) {
    return element.id || element.getAttribute('name') || `field-${index}`;
  }

  function collectFields() {
    const fields = {};
    const elements = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
      .filter(isCacheableField)
      .slice(0, MAX_FIELDS);
    elements.forEach((element, index) => {
      const key = fieldKey(element, index);
      const type = String(element.type || element.tagName).toLowerCase();
      const raw = element.matches('[contenteditable="true"]') ? element.textContent : element.value;
      fields[key] = {
        type,
        checked: typeof element.checked === 'boolean' ? element.checked : undefined,
        value: String(raw || '').slice(0, MAX_FIELD_LENGTH)
      };
    });
    return fields;
  }

  function persistPageCache() {
    if (!dirty) return true;
    try {
      const allCaches = readJson(CACHE_KEY, {});
      const fields = collectFields();
      allCaches[location.pathname] = {
        path: location.pathname,
        title: document.title,
        updatedAt: new Date().toISOString(),
        dirty: true,
        fieldCount: Object.keys(fields).length,
        fields
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(allCaches));
      return true;
    } catch {
      return false;
    }
  }

  function schedulePageCache() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistPageCache, 500);
  }

  function findField(key, index) {
    const byId = document.getElementById(key);
    if (byId && isCacheableField(byId)) return byId;
    const named = Array.from(document.querySelectorAll('[name]')).find(element => element.getAttribute('name') === key && isCacheableField(element));
    if (named) return named;
    return Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]')).filter(isCacheableField)[index] || null;
  }

  function restoreFields(record) {
    restoring = true;
    Object.entries(record.fields || {}).forEach(([key, saved], index) => {
      const element = findField(key, index);
      if (!element) return;
      if (element.matches('[contenteditable="true"]')) element.textContent = saved.value || '';
      else if (typeof saved.checked === 'boolean' && /checkbox|radio/.test(saved.type)) element.checked = saved.checked;
      else element.value = saved.value || '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    restoring = false;
    dirty = true;
  }

  function offerRestore() {
    if (/settings\.html$/i.test(location.pathname)) return;
    const record = readJson(CACHE_KEY, {})[location.pathname];
    if (!record?.dirty || !record.fields || !Object.keys(record.fields).length) return;
    const meaningful = Object.values(record.fields).some(field => field.value || field.checked);
    if (!meaningful) return;
    const time = record.updatedAt ? new Date(record.updatedAt).toLocaleString('zh-CN') : '上次离开时';
    if (confirm(`发现 ${time} 保存的页面输入缓存，是否恢复？`)) restoreFields(record);
  }

  function markSaved() {
    dirty = false;
    try {
      const allCaches = readJson(CACHE_KEY, {});
      if (allCaches[location.pathname]) {
        allCaches[location.pathname].dirty = false;
        localStorage.setItem(CACHE_KEY, JSON.stringify(allCaches));
      }
    } catch {}
  }

  document.addEventListener('input', event => {
    if (restoring || !isCacheableField(event.target)) return;
    dirty = true;
    schedulePageCache();
  }, true);
  document.addEventListener('change', event => {
    if (restoring || !isCacheableField(event.target)) return;
    dirty = true;
    schedulePageCache();
  }, true);

  window.addEventListener('beforeunload', event => {
    if (!dirty || !getSettings().exitProtection) return;
    persistPageCache();
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', persistPageCache);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistPageCache(); });

  window.DreamscapeStorage = { persist: persistPageCache, markSaved, getSettings };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(offerRestore, 0), { once: true });
  else setTimeout(offerRestore, 0);
})();

