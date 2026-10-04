(function () {
  'use strict';
  if(document.documentElement.dataset.roomPage==='classic')return;
  const $ = id => document.getElementById(id);
  const api = window.DreamscapeRoom;
  const layout = document.querySelector('.app-layout');
  const sidebar = $('sidebar');
  const settings = $('roomNameInput').closest('.sidebar-section');
  const roles = $('aiList').closest('.sidebar-section');
  const panel = document.createElement('dialog'); panel.className='room-controls'; panel.id='roomControls';
  panel.setAttribute('aria-label','本次讨论与角色');
  panel.innerHTML='<div class="control-heading"><strong>本次讨论</strong><button type="button" id="closeControls" aria-label="关闭设置">×</button></div><label class="mode-label" for="speechMode">发言方式</label><select id="speechMode"><option value="auto">自动轮流</option><option value="manual">手动指定 · 点谁谁发言</option></select><p class="mode-note" id="modeNote"></p><div class="next-speaker" id="nextSpeaker" hidden><span></span><button type="button" id="cancelNext">取消</button></div>';
  panel.append(settings,roles);layout.append(panel);
  const dock=document.createElement('section');dock.className='speaker-dock';dock.setAttribute('aria-label','发言控制');
  dock.innerHTML='<div class="speaker-toolbar"><label for="quickSpeechMode">发言<select id="quickSpeechMode"><option value="auto">自动轮流</option><option value="manual">指定发言</option></select></label><div class="speaker-policy" role="group" aria-label="指定发言长度"><button type="button" data-policy="once" aria-pressed="true">按一下发言一次</button><button type="button" data-policy="until_done" aria-pressed="false">一直发言直到说完</button></div></div><div class="speaker-names" aria-label="点名发言"></div><p class="speaker-hint"></p>';
  const speechBar=document.createElement('div');speechBar.className='speech-launcher';
  const speechToggle=document.createElement('button');speechToggle.type='button';speechToggle.id='openSpeaker';speechToggle.textContent='指定发言';speechToggle.setAttribute('aria-controls','speakerFloat');speechToggle.setAttribute('aria-expanded','false');speechBar.append(speechToggle);
  document.querySelector('.input-area-wrap').prepend(speechBar);layout.append(dock);dock.id='speakerFloat';dock.hidden=true;dock.setAttribute('role','region');
  const speechHeading=document.createElement('div');speechHeading.className='speaker-float-heading';speechHeading.innerHTML='<strong>指定发言</strong><button type="button" id="closeSpeaker" aria-label="关闭指定发言面板">×</button>';dock.prepend(speechHeading);dock.append($('nextSpeaker'));
  function closeSpeaker(){dock.hidden=true;speechToggle.setAttribute('aria-expanded','false');}
  speechToggle.addEventListener('click',()=>{if(!dock.hidden){closeSpeaker();return;}api.setMode('manual');dock.hidden=false;speechToggle.setAttribute('aria-expanded','true');$('quickSpeechMode').focus();});
  $('closeSpeaker').addEventListener('click',()=>{closeSpeaker();speechToggle.focus();});

  let speechPolicy='once',namesSignature='';
  function speak(index){api.specifySpeaker(index,$('speechPurpose').value,speechPolicy);}
  $('quickSpeechMode').addEventListener('change',()=>{api.setMode($('quickSpeechMode').value);refresh();});
  dock.querySelectorAll('[data-policy]').forEach(button=>button.addEventListener('click',()=>{speechPolicy=button.dataset.policy;refresh();}));
  const advanced=document.createElement('details');advanced.className='advanced-settings';
  advanced.innerHTML='<summary>高级运行设置</summary>';
  for(const id of ['roomDeepThinkingBtn','discussionModeSelect','autoStartCheck']) {
    const node=$(id);advanced.append(id==='roomDeepThinkingBtn'?node.closest('.room-settings-heading'):node.closest('.setting-row'));
  }
  const note=settings.querySelector('.deep-thinking-note');if(note)advanced.append(note);
  settings.append(advanced);
  const roleTools=document.createElement('div');roleTools.className='role-tools';
  roleTools.innerHTML='<button type="button" id="orderRoles" aria-pressed="false">调整顺序</button><label for="speechPurpose" class="purpose-label">点名任务<select id="speechPurpose"><option value="reply">普通回应</option><option value="summary">整理总结</option><option value="verdict">最终裁决</option></select></label>';
  roles.querySelector('h3').after(roleTools);dock.querySelector('.speaker-toolbar').append(roleTools.querySelector('.purpose-label'));
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
  function open(){lastFocus=document.activeElement;sidebar.classList.add('show-history');back.hidden=false;historySearch.focus();}
  function close(){const wasOpen=!back.hidden;sidebar.classList.remove('show-history');back.hidden=true;if(wasOpen)lastFocus?.focus();lastFocus=null;}
  function pageURL(view){const url=new URL(location.href);if(view==='chat')url.searchParams.delete('view');else url.searchParams.set('view',view);return url.pathname+url.search;}
  let currentPage='chat',selectedRole=0,selectedParticipant=null,roleRoom=null,roleCount=0,roleSignature='';
  const settingsLink=document.createElement('a');settingsLink.id='openRoomSettings';settingsLink.textContent='讨论设置';settingsLink.href=pageURL('settings');settingsLink.className='room-page-link';
  const classicLink=document.createElement('a');classicLink.id='openClassic';classicLink.textContent='旧版页面';classicLink.href=pageURL('classic');classicLink.className='room-page-link';
  toggle.after(classicLink,settingsLink);
  const manager=document.createElement('header');manager.className='manager-header';manager.innerHTML='<nav aria-label="讨论页面"><a id="backToDiscussion" data-room-page="chat">← 返回讨论</a><div><a data-room-page="roles">角色管理</a><a data-room-page="settings">讨论设置</a></div><button type="button" id="closeManager" aria-label="关闭角色与讨论设置">×</button></nav><p class="manager-room-name"></p><h1 id="managerTitle"></h1><p class="manager-description"></p>';
  panel.setAttribute('aria-labelledby','managerTitle');panel.prepend(manager);settings.classList.add('room-settings-page');roles.classList.add('room-roles-page');
  const picker=document.createElement('div');picker.className='role-picker';picker.setAttribute('role','group');picker.setAttribute('aria-label','选择要编辑的角色');roleTools.before(picker);
  manager.querySelectorAll('[data-room-page]').forEach(link=>{link.href=pageURL(link.dataset.roomPage);link.addEventListener('click',event=>{event.preventDefault();navigate(link.dataset.roomPage);});});
  function showPage(view){
    currentPage=['roles','settings'].includes(view)?view:'chat';document.documentElement.dataset.roomPage=currentPage;
    close();refresh();
    toggle.setAttribute('aria-expanded',String(currentPage==='roles'));settingsLink.setAttribute('aria-expanded',String(currentPage==='settings'));
    if(currentPage==='chat'){if(panel.open)panel.close();document.body.append($('roleCreatorOverlay'),$('confirmOverlay'));}else{closeSpeaker();panel.append($('roleCreatorOverlay'),$('confirmOverlay'));if(!panel.open)panel.showModal();}
    document.title=(currentPage==='roles'?'角色管理':currentPage==='settings'?'讨论设置':'AI 聊天室')+' · 灵境';
    if(currentPage!=='chat'){manager.querySelector('h1').textContent=currentPage==='roles'?'角色管理':'讨论设置';manager.querySelector('.manager-description').textContent=currentPage==='roles'?'点选一个角色，调整模型、职责与发言顺序。修改会自动保存。':'设置这场讨论的目标与运行方式。修改会自动保存。';manager.querySelector('h1').tabIndex=-1;manager.querySelector('h1').focus();panel.scrollTop=0;}

    manager.querySelectorAll('[data-room-page]').forEach(link=>{if(link.dataset.roomPage===currentPage)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  }
  function navigate(view){history.pushState(null,'',pageURL(view));showPage(view);}
  toggle.addEventListener('click',()=>navigate('roles'));
  settingsLink.addEventListener('click',event=>{event.preventDefault();navigate('settings');});
  classicLink.addEventListener('click',event=>{if(!api.canLeave())event.preventDefault();});
  $('closeManager').addEventListener('click',()=>navigate('chat'));
  panel.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if($('roleCreatorOverlay').classList.contains('open')){event.preventDefault();event.stopPropagation();$('roleCreatorCloseBtn').click();}else if($('confirmOverlay').style.display==='flex'){event.preventDefault();event.stopPropagation();$('confirmNo').click();}},true);
  panel.addEventListener('cancel',event=>{event.preventDefault();navigate('chat');});
  panel.addEventListener('click',event=>{if(event.target!==panel)return;const rect=panel.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)navigate('chat');});
  window.addEventListener('popstate',()=>showPage(new URLSearchParams(location.search).get('view')));

  $('closeControls').addEventListener('click',close);back.addEventListener('click',close);
  $('sidebarToggle').addEventListener('click',()=>{if(innerWidth<=900||layout.classList.contains('has-discussion')){if(sidebar.classList.contains('show-history'))close();else open();}});
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!dock.hidden){closeSpeaker();speechToggle.focus();}if(!back.hidden)close();for(const el of [menu,add])if(el.open){el.open=false;el.querySelector('summary').focus();}}
    if(event.key==='Tab'&&!back.hidden){const drawer=sidebar;const items=[...drawer.querySelectorAll('button,input,select,textarea,a,summary')].filter(el=>!el.disabled&&el.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  $('speechMode').addEventListener('change',()=>{api.setMode($('speechMode').value);refresh();});
  $('cancelNext').addEventListener('click',()=>api.cancelNext());
  $('orderRoles').addEventListener('click',()=>{panel.classList.toggle('ordering');$('orderRoles').setAttribute('aria-pressed',String(panel.classList.contains('ordering')));});
  layout.addEventListener('click',event=>{
    const button=event.target.closest('[data-preset]');
    if(button){api.preset(button.dataset.preset);navigate('settings');$('discussionGoalInput').focus();}
    if(event.target.closest('#readDemo'))$('loadBuiltinTemplateBtn').click();
  });
  function filterHistory(){const q=historySearch.value.toLowerCase();$('historyList').querySelectorAll('.history-item').forEach(el=>{el.hidden=!el.textContent.toLowerCase().includes(q);});}
  historySearch.addEventListener('input',filterHistory);new MutationObserver(filterHistory).observe($('historyList'),{childList:true});
  menuBody.addEventListener('click',event=>{if(event.target.closest('button,a'))menu.open=false;});
  $('themeBtn').addEventListener('click',()=>queueMicrotask(refresh));
  sidebar.addEventListener('click',event=>{if(event.target.closest('.history-item,#newRoomBtn')&&!api.getView().running&&!back.hidden)close();});
  $('chatInput').addEventListener('input',refresh);
  layout.addEventListener('input',event=>{if(event.target.closest('#aiList'))queueMicrotask(refresh);});
  function refresh() {
    const view=api.getView();if(!view.room)return;const room=view.room;const manual=room.speechMode==='manual';
    manager.querySelector('.manager-room-name').textContent=room.name;
    layout.classList.toggle('has-discussion',room.messages.length>0||view.running);title.hidden=room.messages.length>0||view.running;
    speechToggle.classList.toggle('manual-active',manual);speechToggle.disabled=view.stopping;speechToggle.title=manual?'指定发言已开启，点击显示控制面板':'打开并切换为指定发言';
    if(roleRoom!==room.id){roleRoom=room.id;selectedRole=0;selectedParticipant=null;roleCount=room.participants.length;}
    else if(room.participants.length>roleCount)selectedRole=room.participants.length-1;
    else if(selectedParticipant&&room.participants.includes(selectedParticipant))selectedRole=room.participants.indexOf(selectedParticipant);
    roleCount=room.participants.length;selectedRole=Math.max(0,Math.min(selectedRole,roleCount-1));selectedParticipant=room.participants[selectedRole];
    const roleNames=JSON.stringify(room.participants.map(p=>[p.name,p.type]));
    if(roleSignature!==roleNames){roleSignature=roleNames;picker.replaceChildren();room.participants.forEach((p,index)=>{const button=document.createElement('button');button.type='button';button.textContent=p.name;button.addEventListener('click',()=>{selectedRole=index;selectedParticipant=room.participants[index];refresh();});picker.append(button);});}
    picker.querySelectorAll('button').forEach((button,index)=>button.setAttribute('aria-pressed',String(index===selectedRole)));
    const labels={newRoomBtn:'新讨论',exportTemplateBtn:'模板导出',exportFullRoomBtn:'整体导出',importRoomBtn:'导入房间 / 模板',clearChatBtn:'清空记录',addAiBtn:'添加 AI',addHumanBtn:'添加用户角色',openRoleCreatorBtn:'AI 创建角色',stopDiscussBtn:'停止'};
    for(const [id,label] of Object.entries(labels))$(id).textContent=label;
    $('themeBtn').textContent=document.documentElement.dataset.theme==='dark'?'浅色模式':'深色模式';
    $('roomDeepThinkingBtn').textContent='深度思考：'+(room.deepThinking?'开':'关');
    menu.querySelector('summary').textContent='更多';
    add.querySelector('summary').textContent='添加角色';
    const starter=$('emptyChat');if(starter){if(!starter.querySelector('.starter-choices')){starter.innerHTML=starterHTML;decorateStarter(starter);}starter.style.display=room.messages.length?'none':'flex';}
    $('quickSpeechMode').value=manual?'manual':'auto';$('quickSpeechMode').disabled=view.stopping;
    dock.querySelector('.speaker-policy').hidden=!manual;dock.querySelector('.speaker-names').hidden=!manual;dock.querySelector('.speaker-hint').hidden=!manual;
    dock.querySelectorAll('[data-policy]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.policy===speechPolicy));button.disabled=view.stopping;});
    dock.querySelector('.speaker-hint').textContent=speechPolicy==='until_done'?'点名字开始连续补充，讲完即停 · 最多 12 次 · 可随时停止或改选下一位':'点名字发言一次'+(view.running?' · 改点其他人可指定下一位':'');
    const signature=JSON.stringify(room.participants.map(p=>[p.name,p.type]));
    if(signature!==namesSignature){namesSignature=signature;const row=dock.querySelector('.speaker-names');row.replaceChildren();room.participants.forEach((p,index)=>{const button=document.createElement('button');button.type='button';button.textContent=p.name;button.addEventListener('click',()=>speak(index));row.append(button);});}
    dock.querySelectorAll('.speaker-names button').forEach((button,index)=>{const p=room.participants[index];button.disabled=p.enabled===false||view.stopping||(p.type!=='human'&&!DreamscapeConfig.getKey(p.provider));button.classList.toggle('speaking',view.speaker===p.name);button.classList.toggle('queued',view.next===p.name);button.setAttribute('aria-label',p.name+(view.speaker===p.name?'，正在发言':view.next===p.name?'，下一位':'，点名发言'));button.title=button.disabled?'请开启角色并配置模型 Key':'';});
    $('speechMode').value=manual?'manual':'auto';$('speechMode').disabled=view.stopping;
    document.querySelector('.discussion-status').hidden=!view.running;
    $('modeNote').textContent=(manual?'补充消息后，点名让一位角色发言。下一位可改选或取消。':'按角色顺序讨论，你可以插话或随时停止。')+(view.running?' 切换方式会在当前发言结束后衔接。':'');
    $('nextSpeaker').hidden=!view.next;$('nextSpeaker').querySelector('span').textContent=view.next?'下一位：'+view.next:'';
    title.textContent=(room.discussionGoal?'目标：'+room.discussionGoal:'先写下问题，或在讨论设置中填写长期目标。')+(view.running?' · '+(view.stopping?'正在停止':view.speaker?view.speaker+'正在发言':view.paused?'等待你发言':'正在讨论'):'');
    $('speechPurpose').closest('label').hidden=!manual;
    $('roundCountRow').hidden=manual;advanced.hidden=manual;
    $('sendMsgBtn').textContent=manual?'补充消息':view.paused?'发送并继续':room.autoStart?'发送并开始':'仅发送';
    $('sendMsgBtn').disabled=view.running&&!manual&&!view.paused;
    $('startDiscussBtn').textContent=room.messages.length?'开始新一轮讨论':'开始讨论';
    $('startDiscussBtn').hidden=manual||view.running||(room.autoStart&&Boolean($('chatInput').value.trim()));
    $('requestTurnBtn').hidden=manual;$('stopDiscussBtn').style.display=view.running?'inline-flex':'none';
    for(const id of ['addAiBtn','openRoleCreatorBtn','addHumanBtn','discussionGoalInput','roomNameInput','collaborationModeSelect','discussionModeSelect','roundsSelect','autoStartCheck','orderRoles'])$(id).disabled=view.running;
    $('aiList').querySelectorAll('.ai-card').forEach((card,index)=>{
      const p=room.participants[index];if(!p)return;card.classList.toggle('selected-role',index===selectedRole);let button=card.querySelector('.speak-role');
      window.DreamscapeRoleAssist?.mount(card,p,index,view.running);
      const speech=card.querySelector('.ai-speech-btn');
      if(speech){speech.textContent=p.enabled===false?'已静音':'可发言';speech.setAttribute('aria-label',(p.enabled===false?'开启':'关闭')+p.name+'的发言');}
      const expand=card.querySelector('.ai-header-btn');if(expand)expand.setAttribute('aria-label',(p.collapsed?'展开':'收起')+p.name+'的角色设置');
      if(!button){button=document.createElement('button');button.type='button';button.className='speak-role';card.querySelector('.ai-card-header').after(button);button.addEventListener('click',()=>speak(index));}
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
  window.DreamscapeRoomUI={refresh};showPage(new URLSearchParams(location.search).get('view'));
})();
