(function () {
  'use strict';
  const escape = text => {
    const element = document.createElement('div');
    element.textContent = String(text || ''); return element.innerHTML;
  };
  function render(source, options = {}) {
    if (!source) return '';
    const original = String(source);
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return escape(original).replace(/\n/g, '<br>');
    let text = original;
    // Keep math out of Markdown parsing, without modifying fenced/inline code.
    const chunks = text.split(/(```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|`[^`\n]*`)/g);
    const math = [];
    text = chunks.map((chunk, i) => {
      if (i % 2 || !options.math) return chunk;
      chunk = chunk.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math}$$`)
        .replace(/\\\((.+?)\\\)/g, (_, math) => `$${math}$`);
      return chunk.replace(/\$\$([\s\S]*?)\$\$|(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (match) => {
        const marker = `DSMATHTOKEN${math.length}END`;
        math.push(match); return marker;
      });
    }).join('');
    try {
      let html = marked.parse(text, { breaks: true, gfm: true });
      math.forEach((value, i) => { html = html.split(`DSMATHTOKEN${i}END`).join(escape(value)); });
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch { return escape(original).replace(/\n/g, '<br>'); }
  }
  window.DreamscapeMarkdown = { render, escape };
})();
