(function(){
  'use strict';
  if(document.documentElement.dataset.roomPage!=='classic')return;
  const api=window.DreamscapeRoom,$=id=>document.getElementById(id);
  const url=new URL(location.href);url.searchParams.delete('view');
  const link=document.createElement('a');link.href=url.pathname+url.search;link.textContent='返回新版';link.style.cssText='padding:7px 12px;color:var(--primary);font-size:13px;text-decoration:none';document.querySelector('.top-bar-actions').prepend(link);
  link.addEventListener('click',event=>{if(!api.canLeave())event.preventDefault();});
  const controls=document.createElement('div');controls.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px';controls.innerHTML='<label style="font-size:12px">发言方式 <select id="classicSpeechMode"><option value="auto">自动轮流</option><option value="manual">指定发言</option></select></label><span id="classicSpeakerNames" style="display:flex;gap:5px;flex-wrap:wrap"></span>';
  document.querySelector('.input-area-wrap').prepend(controls);
  $('classicSpeechMode').addEventListener('change',()=>api.setMode($('classicSpeechMode').value));
  function refresh(){const view=api.getView(),room=view.room;if(!room)return;const manual=room.speechMode==='manual';$('classicSpeechMode').value=manual?'manual':'auto';$('classicSpeechMode').disabled=view.stopping;const row=$('classicSpeakerNames');row.hidden=!manual;row.replaceChildren();if(manual)room.participants.forEach((p,index)=>{const button=document.createElement('button');button.type='button';button.textContent=p.name;button.disabled=p.enabled===false||view.stopping||(p.type!=='human'&&!DreamscapeConfig.getKey(p.provider));button.addEventListener('click',()=>api.specifySpeaker(index));row.append(button);});$('sendMsgBtn').textContent=manual?'补充消息':'发送';$('sendMsgBtn').disabled=view.running&&!manual&&!view.paused;$('startDiscussBtn').hidden=manual;$('requestTurnBtn').hidden=manual;}
  window.DreamscapeRoomUI={refresh};new MutationObserver(refresh).observe($('aiList'),{childList:true});window.addEventListener('dreamscape-config-change',refresh);refresh();document.title='AI 聊天室 · 旧版布局';
})();
