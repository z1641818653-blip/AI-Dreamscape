(function () {
  'use strict';
  // Shared provider adapters remain the single source of endpoints and credentials.
  async function complete({ provider, model, messages, maxTokens = 2400, temperature = .3, signal, onText }) {
    const adapter = DreamscapeConfig.providers[provider];
    if (!adapter) throw new Error('请选择有效的模型服务');
    const key = DreamscapeConfig.getKey(provider);
    if (!key) throw new Error(`${adapter.name} API 未配置，请先到全局配置保存 API Key`);
    const body = adapter.buildBody(model, messages, maxTokens, temperature);
    if (provider !== 'gemini') body.stream = true;
    return DreamscapeRequest.withTimeout(signal, 90000, async (requestSignal, touch) => {
      const response = await fetch(DreamscapeConfig.getUrl(provider, model), {
        method:'POST', headers:{ 'Content-Type':'application/json', ...adapter.authHeader(key) },
        body:JSON.stringify(body), signal:requestSignal, credentials:'omit'
      });
      touch();
      if (!response.ok) {
        // Do not display provider response bodies: they can contain echoed secrets.
        throw new Error(`${adapter.name} 请求失败（HTTP ${response.status}），请检查模型权限和配置`);
      }
      let text = '';
      if ((response.headers.get('content-type') || '').includes('json')) {
        const data = await response.json();
        if (data.error) throw new Error(`${adapter.name} 返回错误，请检查模型与账户权限`);
        text = adapter.parseResponse(data) || '';
        onText?.(text);
      } else {
        try {
          await DreamscapeRequest.readSSE(response, payload => {
            const part = DreamscapeConfig.getStreamText(provider, payload);
            if (part) { text += part; onText?.(part); }
          }, touch);
        } catch (error) {
          if (requestSignal.aborted) throw error;
          throw new Error(`${adapter.name} 流式响应未完成，请检查模型与账户权限后重试`);
        }
      }
      if (!text.trim()) throw new Error(`${adapter.name} 没有返回正文，请重试或切换模型`);
      return text;
    });
  }
  function json(text) {
    const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(clean); } catch {}
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
    throw new Error('模型没有返回有效的结构化结果，请重试');
  }
  window.DreamscapeAI = { complete, json };
})();
