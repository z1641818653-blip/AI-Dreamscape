(function () {
  'use strict';
  const PROVIDERS = {
    deepseek: {
      name: 'DeepSeek',
      icon: '🟢',
      models: ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash'],
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      streamFormat: 'openai',
      authHeader: (key) => ({ 'Authorization': 'Bearer ' + key }),
      buildBody: (model, messages, mt, temp) => ({ model, messages, temperature: temp ?? 0.7, max_tokens: mt }),
      parseResponse: (data) => data.choices?.[0]?.message?.content
    },
    openai: {
      name: 'OpenAI',
      icon: '🟣',
      models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      endpoint: 'https://api.openai.com/v1/chat/completions',
      streamFormat: 'openai',
      authHeader: (key) => ({ 'Authorization': 'Bearer ' + key }),
      buildBody: (model, messages, mt, temp) => {
        const body = { model, messages, max_completion_tokens: mt };
        // Reasoning models reject sampling parameters at their default effort.
        if (!/^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(model)) body.temperature = temp ?? 0.7;
        return body;
      },
      parseResponse: (data) => data.choices?.[0]?.message?.content
    },
    claude: {
      name: 'Claude',
      icon: '🟠',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-sonnet-4-6'],
      endpoint: 'https://api.anthropic.com/v1/messages',
      streamFormat: 'anthropic',
      authHeader: (key) => ({
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }),
      buildBody: (model, messages, mt, temp) => {
        const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean).join('\n\n');
        const cm = messages.filter(m => m.role !== 'system');
        const body = {
          model,
          max_tokens: mt,
          messages: cm.map(m => ({ role: m.role, content: m.content }))
        };
        if (!/^claude-(?:opus-(?:[5-9]|4-[789])|sonnet-[5-9]|fable-)/.test(model)) body.temperature = temp ?? 0.7;
        if (system) body.system = system;
        return body;
      },
      parseResponse: (data) => data.content?.filter(block => block.type === 'text').map(block => block.text || '').join('') || ''
    },
    gemini: {
      name: 'Gemini',
      icon: '🔵',
      models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.5-flash'],
      endpoint: (model) => 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse',
      streamFormat: 'gemini',
      authHeader: (key) => ({ 'x-goog-api-key': key }),
      buildBody: (model, messages, mt, temp) => {
        const contents = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
        const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean).join('\n\n');
        const body = { contents, generationConfig: { maxOutputTokens: mt, temperature: temp ?? 0.7 } };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        return body;
      },
      parseResponse: (data) => data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || ''
    },
    qwen: {
      name: '千问',
      icon: '🔴',
      models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.7-flash'],
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      streamFormat: 'openai',
      authHeader: (key) => ({ 'Authorization': 'Bearer ' + key }),
      buildBody: (model, messages, mt, temp) => ({ model, messages, temperature: temp ?? 0.7, max_tokens: mt }),
      parseResponse: (data) => data.choices?.[0]?.message?.content
    }
  };

  const KEY = 'dp0';
  function normalizeModels(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
    return [...new Set(items.filter(x => typeof x === 'string').map(x => x.trim()).filter(x => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(x)))].slice(0, 40);
  }
  Object.entries(PROVIDERS).forEach(([key, provider]) => {
    const builtins = provider.models;
    provider.builtinModels = [...builtins];
    Object.defineProperty(provider, 'models', { get() {
      const config = read()[key] || {};
      return [...new Set([...builtins, ...normalizeModels(config.customModels), ...normalizeModels(config.model)])];
    }});
  });
  function read() {
    try { const data = JSON.parse(localStorage.getItem(KEY) || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
    catch { return {}; }
  }
  function decode(value) {
    if (!value) return '';
    try { return decodeURIComponent(atob(value)).trim(); } catch { return ''; }
  }
  function encode(value) { return value ? btoa(encodeURIComponent(value.trim())) : ''; }
  function getKey(provider) { return decode(read()[provider]?.apiKey); }
  function saveSelection(provider, model, saveProvider) {
    const config = read();
    config[provider] = { ...config[provider], model };
    localStorage.setItem(KEY, JSON.stringify(config));
    if (saveProvider) localStorage.setItem('dcp0', provider);
    window.dispatchEvent(new Event('dreamscape-config-change'));
  }
  function migrate() {
    const config = read();
    let legacy = {};
    const legacyRaw = localStorage.getItem('dp49');
    if (legacyRaw) {
      legacy = JSON.parse(legacyRaw);
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('旧配置格式无效，已保留原数据');
    }
    let changed = false;
    // An explicitly present modern key, including an empty key, always wins.
    for (const provider of Object.keys(PROVIDERS)) {
      if (Object.prototype.hasOwnProperty.call(config[provider] || {}, 'apiKey')) continue;
      let key = '';
      key = decode(legacy[provider]?.apiKey);
      if (!key && provider === 'deepseek') key = localStorage.getItem('dk30') || '';
      if (key) { config[provider] = { ...config[provider], apiKey: encode(key) }; changed = true; }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(config));
    // Delete only the two known legacy secret entries after successful migration.
    localStorage.removeItem('dk30');
    if (!legacyRaw || Object.keys(legacy).every(provider => PROVIDERS[provider] && (!legacy[provider]?.apiKey || decode(legacy[provider].apiKey) || Object.prototype.hasOwnProperty.call(config[provider] || {}, 'apiKey')))) localStorage.removeItem('dp49');
  }
  try { migrate(); } catch (error) { console.warn('旧配置迁移未完成', error.name); }
  const info = { deepseek:'推理与高速模型', openai:'GPT 多档模型', claude:'Opus、Sonnet 与 Haiku', gemini:'Gemini 系列', qwen:'通义千问系列' };
  Object.entries(PROVIDERS).forEach(([key, provider]) => { provider.info = info[key]; });
  function getUrl(provider, model, stream = true) {
    const adapter = PROVIDERS[provider];
    let url = typeof adapter.endpoint === 'function' ? adapter.endpoint(model) : adapter.endpoint;
    if (provider === 'gemini' && !stream) url = url.replace(':streamGenerateContent?alt=sse', ':generateContent');
    return url;
  }
  function getStreamText(provider, payload) {
    if (provider === 'claude') return payload.type === 'content_block_delta' ? payload.delta?.text || '' : '';
    if (provider === 'gemini') return PROVIDERS.gemini.parseResponse(payload);
    return payload.choices?.[0]?.delta?.content || '';
  }
  window.DreamscapeConfig = { providers:PROVIDERS, read, decode, encode, normalizeModels, getKey, saveSelection, getUrl, getStreamText };
})();
