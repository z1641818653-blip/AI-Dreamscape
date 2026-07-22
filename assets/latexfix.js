(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const DEFAULT_TEX = String.raw`% !TeX program = xelatex
\documentclass[aspectratio=169]{beamer}
\usepackage[UTF8]{ctex}
\usepackage{amsmath,amssymb}
\usetheme{default}

\definecolor{brand}{HTML}{6257E6}
\setbeamercolor{structure}{fg=brand}
\setbeamercolor{frametitle}{fg=black}
\setbeamertemplate{navigation symbols}{}

\title{AI 灵境 · LaTeX 演示}
\subtitle{一份稳定的中文 Beamer 示例}
\author{AI 灵境}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\section{开始}
\begin{frame}{中文排版}
  \begin{block}{目标}
    使用 XeLaTeX 与 ctex，稳定生成包含中文和数学公式的演示文稿。
  \end{block}

  \begin{itemize}
    \item 保持信息层次清楚
    \item 每页只表达一个中心观点
    \item 用公式补充论证：$E = mc^2$
  \end{itemize}
\end{frame}

\section{公式}
\begin{frame}{数学公式}
  \[
    \int_{0}^{\infty} e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
  \]

  \[
    \sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}
  \]
\end{frame}

\end{document}`;

  const PROVIDERS = {
    deepseek: {
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      buildRequest(key, model, messages) {
        return {
          url: this.endpoint,
          headers: { Authorization: `Bearer ${key}` },
          body: { model, messages, max_tokens: 12000 }
        };
      },
      read(data) { return data?.choices?.[0]?.message?.content; }
    },
    openai: {
      models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4o-mini'],
      endpoint: 'https://api.openai.com/v1/chat/completions',
      buildRequest(key, model, messages) {
        return {
          url: this.endpoint,
          headers: { Authorization: `Bearer ${key}` },
          body: { model, messages, max_completion_tokens: 12000 }
        };
      },
      read(data) { return data?.choices?.[0]?.message?.content; }
    },
    gemini: {
      models: ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-pro-preview'],
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
      buildRequest(key, model, messages) {
        const system = messages.find(item => item.role === 'system')?.content || '';
        const contents = messages
          .filter(item => item.role !== 'system')
          .map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] }));
        return {
          url: `${this.endpoint}${encodeURIComponent(model)}:generateContent`,
          headers: { 'x-goog-api-key': key },
          body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 12000 } }
        };
      },
      read(data) { return data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(''); }
    },
    qwen: {
      models: ['qwen3.7-plus', 'qwen3.7-max', 'qwen3.6-flash'],
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      buildRequest(key, model, messages) {
        return {
          url: this.endpoint,
          headers: { Authorization: `Bearer ${key}` },
          body: { model, messages, max_tokens: 12000 }
        };
      },
      read(data) { return data?.choices?.[0]?.message?.content; }
    }
  };

  const el = {
    workspace: $('#workspace'),
    editor: $('#texEditor'),
    saveState: $('#saveState'),
    engine: $('#engineSelect'),
    compileForm: $('#compileForm'),
    formTex: $('#formTex'),
    formEngine: $('#formEngine'),
    pdfFrame: $('#pdfFrame'),
    previewEmpty: $('#previewEmpty'),
    compileBtn: $('#compileBtn'),
    cancelCompileBtn: $('#cancelCompileBtn'),
    clearPreviewBtn: $('#clearPreviewBtn'),
    compileStatus: $('#compileStatus'),
    compileDot: $('#compileDot'),
    editorNotice: $('#editorNotice'),
    undoBtn: $('#undoBtn'),
    redoBtn: $('#redoBtn'),
    versionBadge: $('#versionBadge'),
    outlinePanel: $('#outlinePanel'),
    outlineToggle: $('#outlineToggle'),
    outlineList: $('#outlineList'),
    aiPanel: $('#aiPanel'),
    aiToggle: $('#aiToggle'),
    backdrop: $('#drawerBackdrop'),
    provider: $('#providerSelect'),
    model: $('#modelInput'),
    customModel: $('#customModelInput'),
    aiConfigSummary: $('#aiConfigSummary'),
    apiKey: $('#apiKeyInput'),
    clearApiKeyBtn: $('#clearApiKeyBtn'),
    chatMessages: $('#chatMessages'),
    chatInput: $('#chatInput'),
    sendAiBtn: $('#sendAiBtn'),
    cancelAiBtn: $('#cancelAiBtn')
  };

  const state = {
    history: [],
    historyIndex: -1,
    compileId: 0,
    compileTimer: null,
    compileStartedAt: 0,
    aiController: null,
    aiHistory: [],
    keys: {},
    models: {},
    saveTimer: null,
    outlineTimer: null
  };

  function normalizeTex(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .replace(/\u0000/g, '')
      .replace(/\r\n?/g, '\n')
      .normalize('NFC');
  }

  function hasChinese(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
  }

  function detectEngine(value) {
    const directive = value.match(/^\s*%\s*!TeX\s+(?:program\s*=\s*)?(xelatex|lualatex|pdflatex)\b/im);
    if (directive) return directive[1].toLowerCase();
    if (/\\(?:usepackage\{(?:ctex|xeCJK|fontspec)\}|setCJK|setmainfont)/i.test(value)) return 'xelatex';
    if (/\\(?:directlua|luadirect|usepackage\{luatexja\})/i.test(value)) return 'lualatex';
    return hasChinese(value) ? 'xelatex' : 'pdflatex';
  }

  function validateDocument(value) {
    const problems = [];
    if (!/\\documentclass(?:\[[^\]]*\])?\s*\{[^}]+\}/.test(value)) problems.push('缺少 \\documentclass');
    if (!/\\begin\s*\{document\}/.test(value)) problems.push('缺少 \\begin{document}');
    if (!/\\end\s*\{document\}/.test(value)) problems.push('缺少 \\end{document}');
    const beginCount = (value.match(/\\begin\s*\{/g) || []).length;
    const endCount = (value.match(/\\end\s*\{/g) || []).length;
    if (beginCount !== endCount) problems.push(`环境数量不匹配（begin ${beginCount} / end ${endCount}）`);
    return problems;
  }

  function inspectCommonProblems(value) {
    const warnings = [];
    if (/\\set(?:main|sans|mono)font\s*\{(?:Consolas|Noto Sans CJK SC)/i.test(value)) {
      warnings.push('包含在线服务器可能没有的本机字体');
    }
    if (/\\beamerdefaultoverlayspecification\s*\{<\+->\}/.test(value)) {
      warnings.push('全局逐步动画会把少量 frame 展开成很多 PDF 页面');
    }
    const frames = value.match(/\\begin\s*\{frame\}[\s\S]*?\\end\s*\{frame\}/g) || [];
    if (frames.some(frame => /\\begin\s*\{lstlisting\}/.test(frame) && !/^\\begin\s*\{frame\}\s*\[[^\]]*fragile[^\]]*\]/.test(frame))) {
      warnings.push('包含 lstlisting 的页面缺少 [fragile]');
    }
    if (/\\begin\s*\{aligned\}[\s\S]*?\\tag\s*\{/.test(value)) {
      warnings.push('aligned 环境内部不能直接使用 \\tag');
    }
    return warnings;
  }

  function setNotice(message = '') {
    el.editorNotice.textContent = message;
    el.editorNotice.hidden = !message;
  }

  function setCompileState(kind, message) {
    el.compileDot.dataset.state = kind;
    el.compileStatus.textContent = message;
  }

  function snapshot(code = el.editor.value, reason = '编辑') {
    const normalized = normalizeTex(code);
    if (state.history[state.historyIndex]?.code === normalized) return;
    state.history.splice(state.historyIndex + 1);
    state.history.push({ code: normalized, reason, time: Date.now() });
    if (state.history.length > 60) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateHistoryUI();
  }

  function updateHistoryUI() {
    el.undoBtn.disabled = state.historyIndex <= 0;
    el.redoBtn.disabled = state.historyIndex >= state.history.length - 1;
    el.versionBadge.textContent = `v${state.historyIndex + 1}/${state.history.length}`;
  }

  function restoreHistory(index) {
    if (index < 0 || index >= state.history.length) return;
    state.historyIndex = index;
    el.editor.value = state.history[index].code;
    el.engine.value = detectEngine(el.editor.value);
    updateHistoryUI();
    scheduleDraftSave();
    renderOutline();
  }

  function scheduleDraftSave() {
    el.saveState.textContent = '正在保存草稿…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('ai-dreamscape-latex-draft-v1', el.editor.value);
        el.saveState.textContent = '草稿已保存';
      } catch {
        el.saveState.textContent = '无法保存草稿';
      }
    }, 500);
  }

  function getInitialDraft() {
    try { return normalizeTex(localStorage.getItem('ai-dreamscape-latex-draft-v1') || DEFAULT_TEX); }
    catch { return DEFAULT_TEX; }
  }

  function prepareForCompile() {
    let value = normalizeTex(el.editor.value);
    const problems = validateDocument(value);
    if (problems.length) {
      setNotice(`暂时不能编译：${problems.join('；')}`);
      return null;
    }

    const detected = detectEngine(value);
    const warnings = inspectCommonProblems(value);
    if (hasChinese(value) && el.engine.value === 'pdflatex' && !/\\usepackage(?:\[[^\]]*\])?\{CJK/i.test(value)) {
      el.engine.value = 'xelatex';
      warnings.unshift('检测到中文，已自动切换为 XeLaTeX');
    } else if (el.engine.value !== detected && !el.engine.dataset.userSelected) {
      el.engine.value = detected;
      warnings.unshift(`已根据源码自动选择 ${detected}`);
    }
    setNotice(warnings.length ? `编译前提示：${warnings.join('；')}。` : '');

    if (value !== el.editor.value) {
      el.editor.value = value;
      snapshot(value, '编码清理');
    } else {
      snapshot(value, '编译');
    }
    return value;
  }

  function stopCompile(message = '已停止等待；远程编译结果可能仍会返回。', kind = 'error') {
    state.compileId += 1;
    clearTimeout(state.compileTimer);
    state.compileTimer = null;
    el.compileBtn.disabled = false;
    el.cancelCompileBtn.hidden = true;
    setCompileState(kind, message);
  }

  function replaceCompileFrame(requestId, onResult) {
    const frame = document.createElement('iframe');
    frame.id = 'pdfFrame';
    frame.name = `pdfFrame-${requestId}`;
    frame.title = 'LaTeX 编译结果';
    frame.hidden = false;
    frame.onload = () => {
      try {
        if (frame.contentWindow?.location.href === 'about:blank') return;
      } catch {
        // 进入 TeXLive.net 的跨域结果页，说明远程响应已经返回。
      }
      onResult();
    };
    el.pdfFrame.replaceWith(frame);
    el.pdfFrame = frame;
    el.compileForm.target = frame.name;
    return frame;
  }

  function compile() {
    const value = prepareForCompile();
    if (!value) return;

    stopCompile('', 'idle');
    const requestId = ++state.compileId;
    state.compileStartedAt = Date.now();
    el.formTex.value = value;
    el.formEngine.value = el.engine.value;
    el.previewEmpty.hidden = true;
    el.compileBtn.disabled = true;
    el.cancelCompileBtn.hidden = false;
    setCompileState('working', `正在使用 ${el.engine.value} 编译…`);

    replaceCompileFrame(requestId, () => {
      if (requestId !== state.compileId) return;
      clearTimeout(state.compileTimer);
      state.compileTimer = null;
      el.compileBtn.disabled = false;
      el.cancelCompileBtn.hidden = true;
      setCompileState('success', '编译结果已返回；若预览显示普通文字，则是 TeX 编译错误日志。');
    });

    state.compileTimer = setTimeout(() => {
      if (requestId !== state.compileId) return;
      el.compileBtn.disabled = false;
      el.cancelCompileBtn.hidden = true;
      setCompileState('error', '等待超过 45 秒，可重试或切换编译引擎。');
    }, 45000);

    el.compileForm.submit();
  }

  function clearPreview() {
    stopCompile('尚未编译', 'idle');
    el.pdfFrame.onload = null;
    el.pdfFrame.removeAttribute('src');
    el.pdfFrame.hidden = true;
    el.previewEmpty.hidden = false;
  }

  function renderOutline() {
    const source = el.editor.value;
    const items = [];
    const patterns = [
      { regex: /\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, type: 'section' },
      { regex: /\\begin\s*\{frame\}(?:\[[^\]]*\])?\s*(?:\{([^{}]*)\})?/g, type: 'frame' },
      { regex: /\\frametitle\s*\{([^{}]*)\}/g, type: 'frame-title' }
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(source))) {
        if (pattern.type === 'section') {
          const depth = { part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3 }[match[1]] || 1;
          items.push({ index: match.index, depth, label: match[2].replace(/\\[a-zA-Z]+/g, '').trim() || '(无标题)' });
        } else if (pattern.type === 'frame' && match[1]) {
          items.push({ index: match.index, depth: 2, label: match[1].trim() });
        } else if (pattern.type === 'frame-title') {
          items.push({ index: match.index, depth: 2, label: match[1].trim() });
        }
      }
    }

    items.sort((a, b) => a.index - b.index);
    el.outlineList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = '尚未识别到章节或页面标题。';
      el.outlineList.append(empty);
      return;
    }

    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.depth = String(item.depth);
      const marker = document.createElement('b');
      marker.textContent = item.depth === 1 ? '§' : '·';
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(marker, label);
      button.addEventListener('click', () => {
        el.editor.focus();
        el.editor.setSelectionRange(item.index, item.index);
        const line = source.slice(0, item.index).split('\n').length - 1;
        const totalLines = Math.max(1, source.split('\n').length);
        el.editor.scrollTop = (line / totalLines) * Math.max(0, el.editor.scrollHeight - el.editor.clientHeight);
        if (window.matchMedia('(max-width: 760px)').matches) closeDrawers();
      });
      el.outlineList.append(button);
    });
  }

  function syncDrawerState() {
    const outlineOpen = el.outlinePanel.classList.contains('open');
    const aiOpen = el.aiPanel.classList.contains('open');
    el.outlinePanel.setAttribute('aria-hidden', String(!outlineOpen));
    el.aiPanel.setAttribute('aria-hidden', String(!aiOpen));
    el.outlineToggle.setAttribute('aria-expanded', String(outlineOpen));
    el.aiToggle.setAttribute('aria-expanded', String(aiOpen));
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    el.backdrop.hidden = !(mobile && (outlineOpen || aiOpen));
  }

  function toggleDrawer(name) {
    const target = name === 'outline' ? el.outlinePanel : el.aiPanel;
    const other = name === 'outline' ? el.aiPanel : el.outlinePanel;
    const willOpen = !target.classList.contains('open');
    if (window.matchMedia('(max-width: 1180px)').matches) other.classList.remove('open');
    target.classList.toggle('open', willOpen);
    if (name === 'outline' && willOpen) renderOutline();
    syncDrawerState();
  }

  function closeDrawers() {
    el.outlinePanel.classList.remove('open');
    el.aiPanel.classList.remove('open');
    syncDrawerState();
  }

  function addMessage(role, text, options = {}) {
    const article = document.createElement('article');
    article.className = `message ${role}${options.error ? ' error' : ''}`;
    if (role === 'assistant') {
      const label = document.createElement('div');
      label.className = 'message-label';
      label.textContent = options.error ? '请求失败' : 'AI 辅助';
      article.append(label);
    }

    if (options.loading) {
      const typing = document.createElement('span');
      typing.className = 'typing';
      typing.setAttribute('aria-label', 'AI 正在回复');
      typing.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      article.append(typing);
    } else if (role === 'assistant') {
      renderAiContent(article, text);
    } else {
      const p = document.createElement('p');
      p.textContent = text;
      article.append(p);
    }

    el.chatMessages.append(article);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    return article;
  }

  function renderAiContent(container, text) {
    const fence = /```(?:latex|tex)?\s*\n([\s\S]*?)```/gi;
    let cursor = 0;
    let match;
    while ((match = fence.exec(text))) {
      if (match.index > cursor) appendPlainText(container, text.slice(cursor, match.index));
      const code = normalizeTex(match[1]).trim();
      const pre = document.createElement('pre');
      pre.className = 'message-code';
      pre.textContent = code;
      container.append(pre);

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'primary-btn compact apply-code-btn';
      apply.textContent = '校验并应用整份源码';
      apply.addEventListener('click', () => applyAiCode(code, apply));
      container.append(apply);
      cursor = fence.lastIndex;
    }
    if (cursor < text.length) appendPlainText(container, text.slice(cursor));
    if (!container.querySelector('p, pre')) appendPlainText(container, text || '(没有返回可显示的内容)');
  }

  function appendPlainText(container, text) {
    const trimmed = text.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return;
    const p = document.createElement('p');
    p.textContent = trimmed;
    container.append(p);
  }

  function applyAiCode(code, button) {
    const normalized = normalizeTex(code);
    const problems = validateDocument(normalized);
    if (problems.length) {
      button.textContent = `未应用：${problems[0]}`;
      button.disabled = true;
      return;
    }
    snapshot(el.editor.value, 'AI 修改前');
    el.editor.value = normalized;
    snapshot(normalized, 'AI 修改');
    el.engine.value = detectEngine(normalized);
    delete el.engine.dataset.userSelected;
    scheduleDraftSave();
    renderOutline();
    button.textContent = '已应用，可用左上角撤销';
    button.disabled = true;
    setNotice('AI 源码已通过基础结构检查并应用；建议先编译确认。');
    if (window.matchMedia('(max-width: 760px)').matches) {
      el.workspace.dataset.mobileView = 'source';
      syncMobileTabs('source');
      closeDrawers();
    }
  }

  function systemPrompt() {
    return `你是 LaTeX Beamer 演示文稿助手。请优先保证代码可以编译，再改善页面层次、留白、配色和信息密度。
规则：
1. 当前文档可能包含中文；使用 XeLaTeX/ctex 兼容写法，不要改变文字编码。
2. 不要使用不常见或需要 shell-escape 的宏包。
3. 只有用户明确要求修改时，才在一个 \`\`\`latex 代码块中返回修改后的完整文档；不能只返回片段。
4. 保留用户没有要求删除的内容。
5. 如果只是分析问题，用简洁中文说明，不必输出整份源码。

当前源码：
\`\`\`latex
${el.editor.value}
\`\`\``;
  }

  async function sendAi() {
    if (state.aiController) return;
    const prompt = el.chatInput.value.trim();
    const key = el.apiKey.value.trim();
    const provider = PROVIDERS[el.provider.value];
    const model = getSelectedModel();
    if (!prompt) return;
    if (!key) {
      addMessage('assistant', '请先填写当前服务的 API Key。', { error: true });
      return;
    }
    if (!model) {
      addMessage('assistant', '请填写模型名称。', { error: true });
      return;
    }

    state.keys[el.provider.value] = key;
    el.chatInput.value = '';
    addMessage('user', prompt);
    const loading = addMessage('assistant', '', { loading: true });
    el.sendAiBtn.disabled = true;
    el.cancelAiBtn.hidden = false;
    state.aiController = new AbortController();
    const timeout = setTimeout(() => state.aiController?.abort('timeout'), 90000);

    const messages = [
      { role: 'system', content: systemPrompt() },
      ...state.aiHistory.slice(-8),
      { role: 'user', content: prompt }
    ];

    try {
      const request = provider.buildRequest(key, model, messages);
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal: state.aiController.signal
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error(`服务返回了无法识别的内容（HTTP ${response.status}）`); }
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw new Error(String(detail).slice(0, 240));
      }
      const reply = normalizeTex(provider.read(data) || '');
      if (!reply) throw new Error('服务没有返回正文。');
      loading.remove();
      addMessage('assistant', reply);
      state.aiHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: reply });
    } catch (error) {
      loading.remove();
      const aborted = error?.name === 'AbortError';
      addMessage('assistant', aborted ? '请求已停止或等待超时。' : `请求失败：${error.message}`, { error: true });
    } finally {
      clearTimeout(timeout);
      state.aiController = null;
      el.sendAiBtn.disabled = false;
      el.cancelAiBtn.hidden = true;
    }
  }

  function changeProvider(nextProvider) {
    const previous = el.provider.dataset.current;
    if (previous) {
      state.keys[previous] = el.apiKey.value.trim();
      state.models[previous] = getSelectedModel();
    }
    el.provider.dataset.current = nextProvider;
    const available = PROVIDERS[nextProvider].models;
    const preferred = state.models[nextProvider] || available[0];
    el.model.replaceChildren();
    available.forEach(modelId => {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = modelId;
      el.model.append(option);
    });
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = '自定义模型…';
    el.model.append(customOption);
    if (available.includes(preferred)) {
      el.model.value = preferred;
      el.customModel.hidden = true;
      el.customModel.value = '';
    } else {
      el.model.value = '__custom__';
      el.customModel.hidden = false;
      el.customModel.value = preferred;
    }
    el.apiKey.value = state.keys[nextProvider] || '';
    updateAiConfigSummary();
  }

  function getSelectedModel() {
    return el.model.value === '__custom__' ? el.customModel.value.trim() : el.model.value;
  }

  function updateAiConfigSummary() {
    const providerName = el.provider.options[el.provider.selectedIndex]?.textContent || el.provider.value;
    el.aiConfigSummary.textContent = `${providerName} · ${getSelectedModel() || '未设置模型'}`;
  }

  function runQuickAiAction(action) {
    const prompts = {
      diagnose: '请检查当前 LaTeX 源码。优先找出会导致无法编译、乱码、页面数量异常或宏包不兼容的问题；按严重程度列出，并给出精确修改方式。除非我明确要求，否则不要重写整份源码。',
      optimize: '请在不删除原有信息的前提下优化这份 Beamer 演示文稿：改善留白、信息层次、字号、配色和每页内容密度。请返回可以直接编译的完整 LaTeX 文档，并优先使用 TeX Live 自带宏包和字体。',
      overlays: '请检查这份 Beamer 文档的 frame 与 overlay 设置。目标是让 PDF 页数接近实际幻灯片数量，只在确实需要逐步展示的位置保留动画。请返回修改后的完整源码。'
    };
    if (action === 'log') {
      if (!el.chatInput.value.trim()) {
        el.chatInput.value = '请分析下面的 LaTeX 错误日志，只定位第一处根本错误并告诉我如何修改：\n\n';
        el.chatInput.focus();
        return;
      }
      el.chatInput.value = `请分析下面的 LaTeX 错误日志，只定位第一处根本错误并告诉我如何修改：\n\n${el.chatInput.value.trim()}`;
    } else {
      el.chatInput.value = prompts[action] || '';
    }
    sendAi();
  }

  function syncMobileTabs(view) {
    $$('[data-mobile-view]').forEach(button => {
      if (button.closest('.mobile-tabs')) button.setAttribute('aria-selected', String(button.dataset.mobileView === view));
    });
  }

  function bindEvents() {
    el.editor.addEventListener('input', () => {
      scheduleDraftSave();
      clearTimeout(state.outlineTimer);
      state.outlineTimer = setTimeout(renderOutline, 450);
      if (!el.engine.dataset.userSelected) el.engine.value = detectEngine(el.editor.value);
    });
    el.editor.addEventListener('blur', () => snapshot(el.editor.value, '编辑'));
    el.engine.addEventListener('change', () => { el.engine.dataset.userSelected = 'true'; });
    el.compileBtn.addEventListener('click', compile);
    el.cancelCompileBtn.addEventListener('click', () => stopCompile());
    el.clearPreviewBtn.addEventListener('click', clearPreview);
    el.undoBtn.addEventListener('click', () => restoreHistory(state.historyIndex - 1));
    el.redoBtn.addEventListener('click', () => restoreHistory(state.historyIndex + 1));
    el.outlineToggle.addEventListener('click', () => toggleDrawer('outline'));
    el.aiToggle.addEventListener('click', () => toggleDrawer('ai'));
    $$('[data-close]').forEach(button => button.addEventListener('click', () => toggleDrawer(button.dataset.close)));
    el.backdrop.addEventListener('click', closeDrawers);
    el.provider.addEventListener('change', () => changeProvider(el.provider.value));
    el.model.addEventListener('change', () => {
      const custom = el.model.value === '__custom__';
      el.customModel.hidden = !custom;
      if (custom) el.customModel.focus();
      updateAiConfigSummary();
    });
    el.customModel.addEventListener('input', updateAiConfigSummary);
    el.clearApiKeyBtn.addEventListener('click', () => {
      state.keys[el.provider.value] = '';
      el.apiKey.value = '';
      el.apiKey.focus();
    });
    el.sendAiBtn.addEventListener('click', sendAi);
    el.cancelAiBtn.addEventListener('click', () => state.aiController?.abort('user'));
    $$('.ai-quick-actions [data-ai-action]').forEach(button => {
      button.addEventListener('click', () => runQuickAiAction(button.dataset.aiAction));
    });
    el.chatInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendAi();
      }
    });
    $$('.mobile-tabs [data-mobile-view]').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.mobileView;
        el.workspace.dataset.mobileView = view;
        syncMobileTabs(view);
      });
    });
    window.addEventListener('resize', syncDrawerState, { passive: true });
  }

  function init() {
    const draft = getInitialDraft();
    el.editor.value = draft;
    el.engine.value = detectEngine(draft);
    snapshot(draft, '初始版本');
    changeProvider('deepseek');
    renderOutline();
    bindEvents();
    syncDrawerState();
  }

  init();
})();
