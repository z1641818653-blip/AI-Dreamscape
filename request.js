(function () {
  'use strict';

  async function withTimeout(signal, timeoutMs, operation) {
    const controller = new AbortController();
    let timer, timedOut = false;
    const abort = () => controller.abort();
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    };
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    touch();
    try {
      return await operation(controller.signal, touch);
    } catch (error) {
      if (timedOut) throw new Error(`${Math.round(timeoutMs / 1000)} 秒内未收到新数据，请检查网络或重试`);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function readSSE(response, onEvent, touch = () => {}) {
    if (!response.body) throw new Error('响应没有可读取的正文');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', data = [], ended = false;
    const dispatch = () => {
      if (!data.length) return;
      const payload = data.join('\n'); data = [];
      if (payload.trim() === '[DONE]' || payload.trim() === '[done]') { ended = true; return; }
      let parsed;
      try { parsed = JSON.parse(payload); }
      catch { throw new Error('模型返回了无法解析的流式数据；请保留已收到的内容后重试'); }
      if (parsed.error || parsed.type === 'error') throw new Error(parsed.error?.message || parsed.message || '模型流式请求失败');
      onEvent(parsed);
    };
    const line = value => {
      if (!value) { dispatch(); return; }
      if (!value.startsWith('data:')) return;
      const next = value.slice(5).replace(/^ /, '');
      // Some compatible services omit blank event separators. Accept a complete
      // JSON event per line without breaking spec-compliant multiline JSON.
      if (data.length) {
        try { JSON.parse(data.join('\n')); dispatch(); } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      data.push(next);
    };
    try {
      while (!ended) {
        const { done, value } = await reader.read();
        if (done) { buffer += decoder.decode(); break; }
        touch(); buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        for (const item of lines) { line(item); if (ended) break; }
      }
      if (!ended) { if (buffer) line(buffer.replace(/\r$/, '')); dispatch(); }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  window.DreamscapeRequest = { withTimeout, readSSE };
})();
