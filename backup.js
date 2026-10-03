(function () {
  'use strict';
  const secretKeys = new Set(['dp49', 'dk30']);
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const sensitive = (key) => /api.?key|password|secret|token|^key-/i.test(key);
  const allowed = key => /^(?:dc0|dp0|dl0|dr0|di0|dcp0|dctx0|dtok0|dver0|ddm0|dtemp0|dcm0|dfs0|dre0|dp49|dk30|dreamscape_[\w-]+|chatroom_[\w-]+|wf_[\w-]+|md_docs|ai-dreamscape-latex-draft-v1|layout_(?:left|right)_w)$/.test(key);

  function cleanCaches(caches) {
    if (!object(caches)) return {};
    const clean = {};
    for (const [key, record] of Object.entries(caches)) {
      if (!object(record) || !object(record.fields)) continue;
      const fields = {};
      for (const [name, field] of Object.entries(record.fields)) {
        if (!object(field) || sensitive(name) || field.type === 'password' || field.type === 'file') continue;
        fields[name] = field;
      }
      clean[key] = { ...record, fields, fieldCount: Object.keys(fields).length };
    }
    return clean;
  }

  function snapshot(includeKeys = false) {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!allowed(key) || (!includeKeys && secretKeys.has(key))) continue;
      let value = localStorage.getItem(key);
      if (key === 'dp0' && !includeKeys) {
        const providers = DreamscapeConfig.read();
        Object.values(providers).forEach(item => { if (object(item)) item.apiKey = ''; });
        value = JSON.stringify(providers);
      }
      if (key === 'dreamscape_page_cache_v1') {
        try { value = JSON.stringify(cleanCaches(JSON.parse(value))); } catch { value = '{}'; }
      }
      result[key] = value;
    }
    return result;
  }

  function plan(payload) {
    if (payload?.kind !== 'ai-dreamscape-browser-backup' || payload.schemaVersion !== 1 || !object(payload.storage)) throw new Error('不是有效的 AI 灵境备份文件');
    const entries = Object.entries(payload.storage);
    if (entries.length > 500 || entries.some(([key, value]) => !allowed(key) || key.length > 200 || typeof value !== 'string')) throw new Error('备份包含未知键或无效内容');
    const writes = [], conflicts = [];
    for (const [key, raw] of entries) {
      if (secretKeys.has(key) && payload.includesApiKeys !== true) continue;
      let value = raw;
      if (key === 'dp0') {
        const incoming = JSON.parse(raw);
        if (!object(incoming) || Object.values(incoming).some(item => !object(item) || (item.apiKey != null && typeof item.apiKey !== 'string') || (item.model != null && typeof item.model !== 'string'))) throw new Error('模型配置格式无效');
        const current = DreamscapeConfig.read();
        for (const [provider, item] of Object.entries(incoming)) {
          if (!DreamscapeConfig.providers[provider]) throw new Error('备份包含未知模型服务');
          if (payload.includesApiKeys !== true) item.apiKey = current[provider]?.apiKey || '';
          current[provider] = { ...current[provider], ...item };
        }
        value = JSON.stringify(current);
      } else if (key === 'dreamscape_page_cache_v1') {
        value = JSON.stringify(cleanCaches(JSON.parse(raw)));
      } else if (key === 'dc0' || key === 'wf_list' || key === 'md_docs') {
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.some(item => !object(item) || typeof item.id !== 'string' || !item.id)) throw new Error(`备份中的 ${key} 数据格式无效`);
        if (key === 'dc0' && list.some(item => !Array.isArray(item.messages))) throw new Error('对话消息格式无效');
        if (key === 'wf_list' && list.some(item => !object(item.tree))) throw new Error('流程树格式无效');
        if (key === 'md_docs' && list.some(item => typeof item.content !== 'string')) throw new Error('Markdown 文档格式无效');
      } else if (key.startsWith('chatroom_') && !['chatroom_dark', 'chatroom_sidebar'].includes(key)) {
        const room = JSON.parse(raw);
        if (!object(room) || typeof room.id !== 'string' || !Array.isArray(room.messages) || !Array.isArray(room.participants)) throw new Error('聊天室备份格式无效');
      }
      const previous = localStorage.getItem(key);
      if (previous !== null && previous !== value) conflicts.push(key);
      writes.push([key, value]);
    }
    return { writes, conflicts };
  }

  function restore(prepared) {
    const original = prepared.writes.map(([key]) => [key, localStorage.getItem(key)]);
    try { prepared.writes.forEach(([key, value]) => localStorage.setItem(key, value)); }
    catch (error) {
      // Remove changed entries first to free quota before restoring original data.
      for (const [key] of original) localStorage.removeItem(key);
      try { for (const [key, value] of original) if (value !== null) localStorage.setItem(key, value); }
      catch { throw new Error('恢复失败且浏览器拒绝回滚，请保留原备份并检查存储权限'); }
      throw new Error('恢复失败，原有数据已回滚：' + error.message);
    }
    window.dispatchEvent(new Event('dreamscape-config-change'));
  }
  window.DreamscapeBackup = { snapshot, plan, restore, cleanCaches };
})();
