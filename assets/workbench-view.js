(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  function group(label,nodes,classes='') {
    const details=document.createElement('details');details.className='wb-group '+classes;
    const summary=document.createElement('summary');summary.textContent=label;details.append(summary);
    const body=document.createElement('div');body.className='wb-group-body';nodes.filter(Boolean).forEach(node=>body.append(node));details.append(body);return details;
  }
  const sidebar=$('sidebarLeft');
  if(innerWidth<=900&&!sidebar.classList.contains('collapsed'))$('sidebarToggleLeft').click();
  const prompt=$('promptTextarea').closest('.sidebar-section');
  const promptAnchor=document.createComment('prompt settings');prompt.before(promptAnchor);
  promptAnchor.replaceWith(group('角色与长期规则',[prompt]));
  const theme=document.querySelector('.theme-toggle');const font=document.querySelector('.font-size-selector');
  const appearance=group('显示设置',[theme,font]);sidebar.append(appearance);
  const header=document.querySelector('.chat-header');const headerActions=header.lastElementChild;
  const left=document.querySelector('.action-left');
  const status=$('requestStatus');const tokens=$('totalTokenEstimate');
  const compare=$('compareToggleBtn');headerActions.prepend(compare);
  left.before(status);
  const answerAnchor=document.createComment('answer settings');left.before(answerAnchor);
  const answer=group('回答设置',[left,$('reasoningToggleBtn'),$('clearInputBtn')],'wb-answer');
  answerAnchor.replaceWith(answer);
  const answerToggle=answer.querySelector('summary');
  answerToggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg-secondary)"/><circle cx="15" cy="17" r="2" fill="var(--bg-secondary)"/></svg><span>回答设置</span>';
  answerToggle.setAttribute('aria-controls','answerSettingsPanel');
  answer.querySelector('.wb-group-body').id='answerSettingsPanel';
  document.addEventListener('pointerdown',event=>{if(answer.open&&!answer.contains(event.target))answer.open=false;});
  document.querySelector('.input-panel').append(tokens);
  const importExport=group('导入 / 导出',[$('importBtn'),$('exportAllBtn')]);$('conversationList').after(importExport);
  const search=document.createElement('button');search.type='button';search.className='import-btn';search.textContent='搜索全部对话';
  search.addEventListener('click',()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'F',ctrlKey:true,shiftKey:true,bubbles:true})));$('newConversationBtn').after(search);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=[...document.querySelectorAll('.wb-group[open]')];if(open.length){const last=open.at(-1);last.open=false;last.querySelector('summary').focus();}}});
})();
