(function () {
  'use strict';

  const PROVIDERS = {
    deepseek: { name:'DeepSeek', icon:'🟢', models:['deepseek-v4-pro','deepseek-v4-flash'] },
    openai: { name:'OpenAI', icon:'🟣', models:['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5-latest'] },
    claude: { name:'Claude', icon:'🟠', models:['claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5'] },
    gemini: { name:'Gemini', icon:'🔵', models:['gemini-3.5-flash','gemini-3.5-pro','gemini-omni-flash'] },
    qwen: { name:'千问', icon:'🔴', models:['qwen3.7-max','qwen3.7-plus','qwen3.7-flash'] }
  };
  const STORAGE_KEY = 'dp0';
  const CURRENT_PROVIDER_KEY = 'dcp0';

  function addStyles() {
    if (document.getElementById('dreamscape-model-selector-styles')) return;
    const style = document.createElement('style');
    style.id = 'dreamscape-model-selector-styles';
    style.textContent = `
      .ds-model-selector{--ds-primary:var(--primary,var(--accent-blue,#6558e8));--ds-border:var(--border,var(--border-color,rgba(103,94,196,.2)));--ds-surface:var(--surface,var(--bg-secondary,#fff));--ds-text:var(--text,var(--text-primary,#202235));--ds-muted:var(--text2,var(--text-secondary,#6c7188));display:grid;gap:10px;color:var(--ds-text)}
      .ds-model-selector details{border:1px solid var(--ds-border);border-radius:12px;background:var(--ds-surface);overflow:hidden}
      .ds-model-selector summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;cursor:pointer;font-weight:750;list-style:none}
      .ds-model-selector summary::-webkit-details-marker{display:none}
      .ds-model-selector summary::after{content:'▾';color:var(--ds-primary);transition:transform .18s ease}
      .ds-model-selector details[open] summary::after{transform:rotate(180deg)}
      .ds-model-selector-body{display:grid;gap:10px;padding:0 13px 13px}
      .ds-model-selector:not(.is-collapsible) .ds-model-selector-body{padding:0}
      .ds-model-selector-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:9px}
      .ds-model-field{display:grid;gap:5px;min-width:0}
      .ds-model-field label{font-size:11px;font-weight:730;color:var(--ds-muted)}
      .ds-model-field select{width:100%;min-height:40px;padding:0 10px;border:1px solid var(--ds-border);border-radius:9px;background:var(--ds-surface);color:var(--ds-text);font:inherit;outline:none}
      .ds-model-field select:focus{border-color:var(--ds-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--ds-primary) 14%,transparent)}
      .ds-model-selector-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--ds-muted)}
      .ds-model-api-state.is-ready{color:#207548}
      .ds-model-settings{color:var(--ds-primary);font-weight:730;text-decoration:none;white-space:nowrap}
      .ds-model-selector.is-compact{gap:7px}
      .ds-model-selector.is-compact .ds-model-selector-row{grid-template-columns:1fr}
      .ds-model-selector.is-compact .ds-model-selector-foot{align-items:flex-start;flex-direction:column}
      @media(max-width:640px){.ds-model-selector-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function readConfig() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function hasApiKey(providerKey) {
    return Boolean(readConfig()?.[providerKey]?.apiKey);
  }

  function saveSelection(providerKey, model, saveProvider) {
    try {
      const config = readConfig();
      const current = config[providerKey] && typeof config[providerKey] === 'object' ? config[providerKey] : {};
      config[providerKey] = { ...current, model };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      if (saveProvider) localStorage.setItem(CURRENT_PROVIDER_KEY, providerKey);
    } catch {}
  }

  function getInitialProvider(allowed, requested) {
    if (requested && allowed.includes(requested)) return requested;
    const saved = localStorage.getItem(CURRENT_PROVIDER_KEY);
    return allowed.includes(saved) ? saved : allowed[0];
  }

  function getInitialModel(providerKey, requested) {
    const models = PROVIDERS[providerKey].models;
    if (requested && models.includes(requested)) return requested;
    const saved = readConfig()?.[providerKey]?.model;
    return models.includes(saved) ? saved : models[0];
  }

  function mount(container, options) {
    if (!container) throw new Error('模型选择器缺少挂载容器');
    addStyles();
    const opts = options || {};
    const allowed = (Array.isArray(opts.providers) ? opts.providers : Object.keys(PROVIDERS)).filter(key => PROVIDERS[key]);
    if (!allowed.length) throw new Error('模型选择器没有可用提供商');

    let provider = getInitialProvider(allowed, opts.provider);
    let model = getInitialModel(provider, opts.model);
    const root = document.createElement('div');
    root.className = `ds-model-selector${opts.collapsible ? ' is-collapsible' : ''}${opts.compact ? ' is-compact' : ''}`;
    const body = document.createElement('div');
    body.className = 'ds-model-selector-body';
    if (opts.collapsible) {
      const details = document.createElement('details');
      details.open = opts.open === true;
      const summary = document.createElement('summary');
      summary.textContent = opts.title || '模型选择';
      details.append(summary, body);
      root.append(details);
    } else {
      root.append(body);
    }

    const row = document.createElement('div');
    row.className = 'ds-model-selector-row';
    const providerField = document.createElement('div');
    providerField.className = 'ds-model-field';
    const providerLabel = document.createElement('label');
    providerLabel.textContent = '服务商';
    const providerSelect = document.createElement('select');
    providerSelect.setAttribute('aria-label', '服务商');
    allowed.forEach(key => {
      const option = document.createElement('option');
      option.value = key; option.textContent = `${PROVIDERS[key].icon} ${PROVIDERS[key].name}`; providerSelect.append(option);
    });
    providerSelect.value = provider;
    providerSelect.disabled = allowed.length === 1 && opts.lockSingleProvider !== false;
    providerField.append(providerLabel, providerSelect);

    const modelField = document.createElement('div');
    modelField.className = 'ds-model-field';
    const modelLabel = document.createElement('label');
    modelLabel.textContent = '模型';
    const modelSelect = document.createElement('select');
    modelSelect.setAttribute('aria-label', '模型');
    modelField.append(modelLabel, modelSelect);
    row.append(providerField, modelField);

    const foot = document.createElement('div');
    foot.className = 'ds-model-selector-foot';
    const state = document.createElement('span');
    state.className = 'ds-model-api-state';
    const settings = document.createElement('a');
    settings.className = 'ds-model-settings'; settings.href = 'settings.html'; settings.textContent = '管理 API Key →';
    foot.append(state, settings);
    body.append(row, foot);

    function renderModels(requestedModel) {
      modelSelect.replaceChildren();
      PROVIDERS[provider].models.forEach(modelId => {
        const option = document.createElement('option'); option.value = modelId; option.textContent = modelId; modelSelect.append(option);
      });
      model = getInitialModel(provider, requestedModel);
      modelSelect.value = model;
      const ready = hasApiKey(provider);
      state.textContent = ready ? `${PROVIDERS[provider].name} API 已配置` : `${PROVIDERS[provider].name} API 未配置`;
      state.classList.toggle('is-ready', ready);
    }

    function notify(source) {
      if (opts.persist !== false) saveSelection(provider, model, opts.saveProvider !== false);
      if (typeof opts.onChange === 'function') opts.onChange({ provider, model, source });
    }

    providerSelect.addEventListener('change', () => {
      provider = providerSelect.value;
      renderModels();
      notify('provider');
    });
    modelSelect.addEventListener('change', () => {
      model = modelSelect.value;
      notify('model');
    });
    renderModels(model);
    container.replaceChildren(root);

    return {
      element: root,
      getValue: () => ({ provider, model }),
      setValue(value) {
        if (value?.provider && allowed.includes(value.provider)) {
          provider = value.provider; providerSelect.value = provider;
        }
        renderModels(value?.model);
      },
      refreshStatus() { renderModels(model); },
      destroy() { root.remove(); }
    };
  }

  window.DreamscapeModelSelector = { mount, providers: PROVIDERS, readConfig, hasApiKey };
})();

