(function () {
  'use strict';

  const PROVIDERS = DreamscapeConfig.providers;
  const STORAGE_KEY = 'dp0';
  const CURRENT_PROVIDER_KEY = 'dcp0';

  function addStyles() {
    if (document.getElementById('dreamscape-model-selector-styles')) return;
    const style = document.createElement('style');
    style.id = 'dreamscape-model-selector-styles';
    style.textContent = `
      .ds-model-selector{--ds-primary:var(--primary,var(--accent-blue,#6558e8));--ds-border:var(--border,var(--border-color,rgba(103,94,196,.2)));--ds-surface:var(--surface,var(--bg-secondary,#fff));--ds-text:var(--text,var(--text-primary,#202235));--ds-muted:var(--text2,var(--text-secondary,#6c7188));display:grid;gap:8px;color:var(--ds-text)}
      .ds-model-selector details{border:1px solid var(--ds-border);border-radius:10px;background:var(--ds-surface);overflow:hidden}
      .ds-model-selector summary{min-height:36px;display:flex;align-items:center;justify-content:space-between;gap:9px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:700;list-style:none}
      .ds-model-selector summary::-webkit-details-marker{display:none}
      .ds-model-selector summary::after{content:'▾';color:var(--ds-primary);transition:transform .18s ease}
      .ds-model-selector details[open] summary::after{transform:rotate(180deg)}
      .ds-model-selector-body{display:grid;gap:8px;padding:0 10px 10px}
      .ds-model-selector:not(.is-collapsible) .ds-model-selector-body{padding:0}
      .ds-model-selector-row{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:7px}
      .ds-model-field{display:grid;gap:4px;min-width:0}
      .ds-model-field label{font-size:10px;font-weight:700;color:var(--ds-muted)}
      .ds-model-field select{width:100%;height:34px;min-height:34px;padding:0 8px;border:1px solid var(--ds-border);border-radius:8px;background:var(--ds-surface);color:var(--ds-text);font-size:12px;outline:none}
      .ds-model-field select:focus{border-color:var(--ds-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--ds-primary) 14%,transparent)}
      .ds-model-selector-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;line-height:1.4;color:var(--ds-muted)}
      .ds-model-api-state.is-ready{color:#207548}
      .ds-model-settings{color:var(--ds-primary);font-weight:730;text-decoration:none;white-space:nowrap}
      .ds-model-selector.is-compact{gap:6px}
      .ds-model-selector.is-compact .ds-model-selector-row{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}
      .ds-model-selector.is-compact .ds-model-selector-foot{gap:6px}
      @media(max-width:420px){.ds-model-selector-row{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}}
    `;
    document.head.appendChild(style);
  }

  const readConfig = DreamscapeConfig.read;
  function hasApiKey(provider) { return Boolean(DreamscapeConfig.getKey(provider)); }
  const saveSelection = DreamscapeConfig.saveSelection;

  function getInitialProvider(allowed, requested) {
    if (requested && allowed.includes(requested)) return requested;
    const saved = localStorage.getItem(CURRENT_PROVIDER_KEY);
    return allowed.includes(saved) ? saved : allowed[0];
  }

  function getInitialModel(providerKey, requested) {
    const models = PROVIDERS[providerKey].models;
    const pinned = DreamscapeConfig.normalizeModels([requested])[0];
    if (pinned) return pinned;
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
    let reasoningEffort = opts.reasoningEffort ?? (opts.persist === false ? '' : DreamscapeConfig.getPageGlmEffort());
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
    providerSelect.disabled = opts.disabled === true || (allowed.length === 1 && opts.lockSingleProvider !== false);
    providerField.append(providerLabel, providerSelect);

    const modelField = document.createElement('div');
    modelField.className = 'ds-model-field';
    const modelLabel = document.createElement('label');
    modelLabel.textContent = '模型';
    const modelSelect = document.createElement('select');
    modelSelect.setAttribute('aria-label', '模型');
    modelSelect.disabled = opts.disabled === true;
    modelField.append(modelLabel, modelSelect);
    row.append(providerField, modelField);

    const foot = document.createElement('div');
    foot.className = 'ds-model-selector-foot';
    const state = document.createElement('span');
    state.className = 'ds-model-api-state';
    const settings = document.createElement('a');
    settings.className = 'ds-model-settings'; settings.href = 'settings.html'; settings.textContent = '管理 API Key →';
    foot.append(state, settings);
    const effortField = document.createElement('div');
    effortField.className = 'ds-model-field';
    const effortLabel = document.createElement('label');
    effortLabel.textContent = '推理强度';
    const effortSelect = document.createElement('select');
    effortSelect.setAttribute('aria-label', '推理强度');
    effortSelect.disabled = opts.disabled === true;
    effortField.append(effortLabel, effortSelect);
    body.append(row, effortField, foot);
    function renderEffort() {
      effortField.hidden = provider !== 'glm' || !/^glm-5\.3(?:-|$)/i.test(model);
      effortField.style.display = effortField.hidden ? 'none' : '';
      const inherited = DreamscapeConfig.normalizeGlmEffort(readConfig().glm?.reasoningEffort);
      effortSelect.replaceChildren(new Option('沿用全局（' + inherited + '）', ''),
        new Option('low · 轻量', 'low'), new Option('high · 深入', 'high'), new Option('max · 最大', 'max'));
      effortSelect.value = ['low','high','max'].includes(reasoningEffort) ? reasoningEffort : '';
    }
    effortSelect.addEventListener('change', () => {
      reasoningEffort = effortSelect.value;
      if (opts.persist !== false) DreamscapeConfig.savePageGlmEffort(reasoningEffort);
      notify('effort');
    });

    function renderModels(requestedModel) {
      modelSelect.replaceChildren();
      model = getInitialModel(provider, requestedModel);
      [...new Set([...PROVIDERS[provider].models, model])].forEach(modelId => {
        const option = document.createElement('option'); option.value = modelId; option.textContent = DreamscapeConfig.getModelLabel(provider, modelId); modelSelect.append(option);
      });
      modelSelect.value = model;
      const ready = hasApiKey(provider);
      state.textContent = ready ? `${PROVIDERS[provider].name} API 已配置` : `${PROVIDERS[provider].name} API 未配置`;
      state.classList.toggle('is-ready', ready);
      renderEffort();
    }

    function notify(source) {
      const selection = { provider, model, reasoningEffort, source };
      // Update the owning page before broadcasting a global configuration change.
      if (typeof opts.onChange === 'function') opts.onChange(selection);
      if (opts.persist !== false) saveSelection(selection.provider, selection.model, opts.saveProvider !== false);
    }

    providerSelect.addEventListener('change', () => {
      provider = providerSelect.value;
      renderModels();
      notify('provider');
    });
    modelSelect.addEventListener('change', () => {
      model = modelSelect.value;
      renderEffort();
      notify('model');
    });
    renderModels(model);
    container.replaceChildren(root);
    const cleanup = () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('dreamscape-config-change', refresh);
    };
    const refresh = () => {
      if (!root.isConnected) { cleanup(); return; }
      if (opts.persist !== false) reasoningEffort = DreamscapeConfig.getPageGlmEffort();
      renderModels(model);
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('dreamscape-config-change', refresh);

    return {
      element: root,
      getValue: () => ({ provider, model, reasoningEffort }),
      setValue(value) {
        if (value?.provider && allowed.includes(value.provider)) {
          provider = value.provider; providerSelect.value = provider;
        }
        if (value && Object.prototype.hasOwnProperty.call(value, 'reasoningEffort')) reasoningEffort = value.reasoningEffort || '';
        renderModels(value?.model);
      },
      refreshStatus() { renderModels(model); },
      destroy() { cleanup(); root.remove(); }
    };
  }

  window.DreamscapeModelSelector = { mount, providers: PROVIDERS, readConfig, hasApiKey };
})();
