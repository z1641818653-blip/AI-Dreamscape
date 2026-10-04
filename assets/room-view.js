(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = window.DreamscapeRoom;
  const layout = document.querySelector('.app-layout');
  const sidebar = $('sidebar');
  const settings = $('roomNameInput').closest('.sidebar-section');
  const roles = $('aiList').closest('.sidebar-section');
  const panel = document.createElement('aside'); panel.className='room-controls'; panel.id='roomControls';
  panel.setAttribute('aria-label','本次讨论与角色');
  panel.innerHTML='<div class="control-heading"><strong>本次讨论</strong><button type="button" id="closeControls" aria-label="关闭设置">×</button></div><label class="mode-label" for="speechMode">发言方式</label><select id="speechMode"><option value="auto">自动轮流</option><option value="manual">手动指定 · 点谁谁发言</option></select><p class="mode-note" id="modeNote"></p><div class="next-speaker" id="nextSpeaker" hidden><span></span><button type="button" id="cancelNext">取消</button></div>';
  panel.append(settings,roles);layout.append(panel);
  const advanced=document.createElement('details');advanced.className='advanced-settings';
  advanced.innerHTML='<summary>高级运行设置</summary>';
  for(const id of ['roomDeepThinkingBtn','discussionModeSelect','autoStartCheck']) {
    const node=$(id);advanced.append(id==='roomDeepThinkingBtn'?node.closest('.room-settings-heading'):node.closest('.setting-row'));
  }
  const note=settings.querySelector('.deep-thinking-note');if(note)advanced.append(note);
  settings.append(advanced);
  const roleTools=document.createElement('div');roleTools.className='role-tools';
  roleTools.innerHTML='<button type="button" id="orderRoles" aria-pressed="false">调整顺序</button><label for="speechPurpose" class="purpose-label">点名任务<select id="speechPurpose"><option value="reply">普通回应</option><option value="summary">整理总结</option><option value="verdict">最终裁决</option></select></label>';
  roles.querySelector('h3').after(roleTools);
  const add=document.createElement('details');add.className='add-role-menu';add.innerHTML='<summary>＋ 添加角色</summary>';add.append(roles.querySelector('.add-role-row'));roles.append(add);
  const menu=document.createElement('details');menu.className='room-menu';menu.innerHTML='<summary>更多 ⋯</summary><div class="room-menu-body"></div>';
  const menuBody=menu.querySelector('div');
  for(const id of ['exportTemplateBtn','exportFullRoomBtn','importRoomBtn','clearChatBtn','openTutorialBtn','themeBtn'])menuBody.append($(id));
  const link=document.createElement('a');link.href='settings.html';link.textContent='模型与本机数据';menuBody.append(link);
  const actions=document.querySelector('.top-bar-actions');actions.append(menu);
  const toggle=document.createElement('button');toggle.type='button';toggle.id='openControls';toggle.textContent='角色与设置';toggle.setAttribute('aria-controls','roomControls');toggle.setAttribute('aria-expanded','false');actions.prepend(toggle);
  const back=document.createElement('button');back.type='button';back.className='drawer-backdrop';back.hidden=true;layout.append(back);
  const title=document.createElement('div');title.className='goal-summary';title.setAttribute('role','status');document.querySelector('.top-bar').after(title);
  const historySearch=document.createElement('input');historySearch.placeholder='搜索房间';historySearch.setAttribute('aria-label','搜索房间');$('historyList').before(historySearch);
  sidebar.prepend($('newRoomBtn'));$('newRoomBtn').textContent='＋ 新讨论';
  const brand=sidebar.querySelector('.chatroom-shortcuts a');
  brand.classList.add('room-brand');brand.textContent='灵境';sidebar.prepend(brand);
  sidebar.querySelector('.chatroom-shortcuts').closest('.sidebar-section').hidden=true;
  $('historySection').querySelector('h3').textContent='讨论记录';
  roles.querySelector('h3').textContent='参与角色';
  $('sidebarToggle').textContent='房间';$('sidebarToggle').setAttribute('aria-label','打开或收起房间历史');
  const empty=$('emptyChat')||document.createElement('div');
  if(!empty.isConnected){empty.id='emptyChat';empty.className='empty-chat';empty.style.display='none';$('messagesArea').append(empty);}
  empty.innerHTML='<span class="empty-eyebrow">AI 协作 · 预览版</span><h1>一个问题，多种思考。</h1><p>选一组角色，写下问题，再决定让 AI 轮流讨论，还是由你点名。</p><div class="starter-choices"><button type="button" data-preset="debate"><strong>正反辩论</strong><span>正方、反方与裁判</span></button><button type="button" data-preset="cocreate"><strong>方案共创</strong><span>提案、审查与整合</span></button><button type="button" data-preset="free"><strong>自由讨论</strong><span>探索、质疑与总结</span></button></div><div class="starter-footer"><button type="button" id="readDemo">先阅读一场演示</button><a href="settings.html">配置模型服务 →</a></div><small>阅读演示不会请求模型。模板会创建新房间，保留已有记录。</small>';
  const starterHTML=empty.innerHTML;
  function decorateStarter(node) {
    const heading=node?.querySelector('h1');
    if(heading)heading.innerHTML='一个问题，<span>多种思考。</span>';
  }
  decorateStarter(empty);
  let lastFocus=null;
  function open(which) {
    lastFocus=document.activeElement;sidebar.classList.remove('show-history');panel.classList.remove('open');
    if(which==='roles')panel.classList.add('open');else sidebar.classList.add('show-history');
    back.hidden=false;toggle.setAttribute('aria-expanded',String(which==='roles'));
    (which==='roles'?$('speechMode'):historySearch).focus();
  }
  function close() {panel.classList.remove('open');sidebar.classList.remove('show-history');back.hidden=true;toggle.setAttribute('aria-expanded','false');lastFocus?.focus();}
  toggle.addEventListener('click',()=>{if(innerWidth<=1100)open('roles');else {panel.classList.toggle('collapsed');toggle.setAttribute('aria-expanded',String(!panel.classList.contains('collapsed')));}});
  $('closeControls').addEventListener('click',close);back.addEventListener('click',close);
  $('sidebarToggle').addEventListener('click',()=>{if(innerWidth<=900){if(sidebar.classList.contains('show-history'))close();else open('history');}});
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!back.hidden)close();for(const el of [menu,add])if(el.open){el.open=false;el.querySelector('summary').focus();}}
    if(event.key==='Tab'&&!back.hidden){const drawer=panel.classList.contains('open')?panel:sidebar;const items=[...drawer.querySelectorAll('button,input,select,textarea,a,summary')].filter(el=>!el.disabled&&el.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  $('speechMode').addEventListener('change',()=>{api.setMode($('speechMode').value);refresh();});
  $('cancelNext').addEventListener('click',()=>api.cancelNext());
  $('orderRoles').addEventListener('click',()=>{panel.classList.toggle('ordering');$('orderRoles').setAttribute('aria-pressed',String(panel.classList.contains('ordering')));});
  layout.addEventListener('click',event=>{
    const button=event.target.closest('[data-preset]');
    if(button){api.preset(button.dataset.preset);if(innerWidth<=1100)open('roles');$('discussionGoalInput').focus();}
    if(event.target.closest('#readDemo'))$('loadBuiltinTemplateBtn').click();
  });
  function filterHistory(){const q=historySearch.value.toLowerCase();$('historyList').querySelectorAll('.history-item').forEach(el=>{el.hidden=!el.textContent.toLowerCase().includes(q);});}
  historySearch.addEventListener('input',filterHistory);new MutationObserver(filterHistory).observe($('historyList'),{childList:true});
  menuBody.addEventListener('click',event=>{if(event.target.closest('button,a'))menu.open=false;});
  $('themeBtn').addEventListener('click',()=>queueMicrotask(refresh));
  sidebar.addEventListener('click',event=>{if(event.target.closest('.history-item')&&!api.getView().running&&innerWidth<=900)close();});
  $('chatInput').addEventListener('input',refresh);
  function refresh() {
    const view=api.getView();if(!view.room)return;const room=view.room;const manual=room.speechMode==='manual';
    const labels={newRoomBtn:'新讨论',exportTemplateBtn:'模板导出',exportFullRoomBtn:'整体导出',importRoomBtn:'导入房间 / 模板',clearChatBtn:'清空记录',addAiBtn:'添加 AI',addHumanBtn:'添加用户角色',openRoleCreatorBtn:'AI 创建角色',stopDiscussBtn:'停止'};
    for(const [id,label] of Object.entries(labels))$(id).textContent=label;
    $('themeBtn').textContent=document.documentElement.dataset.theme==='dark'?'浅色模式':'深色模式';
    $('roomDeepThinkingBtn').textContent='深度思考：'+(room.deepThinking?'开':'关');
    menu.querySelector('summary').textContent='更多';
    add.querySelector('summary').textContent='添加角色';
    const starter=$('emptyChat');if(starter){if(!starter.querySelector('.starter-choices')){starter.innerHTML=starterHTML;decorateStarter(starter);}starter.style.display=room.messages.length?'none':'flex';}
    $('speechMode').value=manual?'manual':'auto';$('speechMode').disabled=view.stopping;
    document.querySelector('.discussion-status').hidden=!view.running;
    $('modeNote').textContent=(manual?'补充消息后，点名让一位角色发言。下一位可改选或取消。':'按角色顺序讨论，你可以插话或随时停止。')+(view.running?' 切换方式会在当前发言结束后衔接。':'');
    $('nextSpeaker').hidden=!view.next;$('nextSpeaker').querySelector('span').textContent=view.next?'下一位：'+view.next:'';
    title.textContent=(room.discussionGoal?'目标：'+room.discussionGoal:'先写下问题，或在右侧填写长期讨论目标。')+(view.running?' · '+(view.stopping?'正在停止':view.speaker?view.speaker+'正在发言':view.paused?'等待你发言':'正在讨论'):'');
    $('speechPurpose').closest('label').hidden=!manual;
    $('roundCountRow').hidden=manual;advanced.hidden=manual;
    $('sendMsgBtn').textContent=manual?'补充消息':view.paused?'发送并继续':room.autoStart?'发送并开始':'仅发送';
    $('sendMsgBtn').disabled=view.running&&!manual&&!view.paused;
    $('startDiscussBtn').textContent=room.messages.length?'开始新一轮讨论':'开始讨论';
    $('startDiscussBtn').hidden=manual||view.running||(room.autoStart&&Boolean($('chatInput').value.trim()));
    $('requestTurnBtn').hidden=manual;$('stopDiscussBtn').style.display=view.running?'inline-flex':'none';
    for(const id of ['addAiBtn','openRoleCreatorBtn','addHumanBtn','discussionGoalInput','roomNameInput','collaborationModeSelect','discussionModeSelect','roundsSelect','autoStartCheck','orderRoles'])$(id).disabled=view.running;
    $('aiList').querySelectorAll('.ai-card').forEach((card,index)=>{
      const p=room.participants[index];if(!p)return;let button=card.querySelector('.speak-role');
      const speech=card.querySelector('.ai-speech-btn');
      if(speech){speech.textContent=p.enabled===false?'已静音':'可发言';speech.setAttribute('aria-label',(p.enabled===false?'开启':'关闭')+p.name+'的发言');}
      const expand=card.querySelector('.ai-header-btn');if(expand)expand.setAttribute('aria-label',(p.collapsed?'展开':'收起')+p.name+'的角色设置');
      if(!button){button=document.createElement('button');button.type='button';button.className='speak-role';card.querySelector('.ai-card-header').after(button);button.addEventListener('click',()=>api.specifySpeaker(index,$('speechPurpose').value));}
      button.hidden=!manual;button.textContent=p.type==='human'?'我要发言':view.running?'指定下一位':'让 TA 发言';
      button.disabled=p.enabled===false||view.stopping||(p.type!=='human'&&!DreamscapeConfig.getKey(p.provider));
      button.title=button.disabled?'请开启角色并在全局配置保存模型服务 Key':'';
      card.querySelectorAll('.ai-card-name,.ai-card-body input,.ai-card-body select,.ai-card-body textarea').forEach(el=>el.disabled=view.running||p.locked===true);
      card.querySelectorAll('.participant-order-btn').forEach((el,position)=>el.disabled=view.running||(position===0?index===0:index===room.participants.length-1));
      let meta=card.querySelector('.role-model-summary');if(!meta){meta=document.createElement('div');meta.className='role-model-summary';button.after(meta);}meta.textContent=p.type==='human'?'用户参与':p.model+(DreamscapeConfig.getKey(p.provider)?'':' · 未配置 Key');
    });
  }
  new MutationObserver(refresh).observe($('aiList'),{childList:true});
  window.addEventListener('dreamscape-config-change',refresh);window.addEventListener('storage',refresh);
  window.DreamscapeRoomUI={refresh};refresh();
})();
