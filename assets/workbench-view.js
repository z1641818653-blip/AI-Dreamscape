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
  const model=$('chatModelSelector').closest('.sidebar-section');
  const modelGroup=group('选择模型',[model],'wb-model');header.before(modelGroup);
  const left=document.querySelector('.action-left');
  const status=$('requestStatus');const tokens=$('totalTokenEstimate');
  const compare=$('compareToggleBtn');headerActions.prepend(compare);
  left.before(status);
  const answerAnchor=document.createComment('answer settings');left.before(answerAnchor);
  answerAnchor.replaceWith(group('回答设置',[left,$('reasoningToggleBtn'),$('clearInputBtn')],'wb-answer'));
  document.querySelector('.input-panel').append(tokens);
  const text=document.createElement('span');text.className='wb-model-current';modelGroup.querySelector('summary').append(text);
  function modelLabel(){const selected=model.querySelector('select[aria-label="模型"]');text.textContent=selected?.value?' · '+selected.value:'';}
  new MutationObserver(modelLabel).observe(model,{childList:true,subtree:true});model.addEventListener('change',modelLabel);modelLabel();
  const importExport=group('导入 / 导出',[$('importBtn'),$('exportAllBtn')]);$('conversationList').after(importExport);
  const search=document.createElement('button');search.type='button';search.className='import-btn';search.textContent='搜索全部对话';
  search.addEventListener('click',()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'F',ctrlKey:true,shiftKey:true,bubbles:true})));$('newConversationBtn').after(search);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=[...document.querySelectorAll('.wb-group[open]')];if(open.length){const last=open.at(-1);last.open=false;last.querySelector('summary').focus();}}});
})();
