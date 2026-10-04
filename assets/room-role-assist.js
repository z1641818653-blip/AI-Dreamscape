(function(){
  'use strict';
  const states=new WeakMap(),api=window.DreamscapeRoom;
  function mount(card,participant,index,running){
    if(participant.type==='human')return;
    let state=states.get(participant);if(!state){state={instruction:'',draft:null,busy:false,status:'',open:false};states.set(participant,state);}
    let fold=card.querySelector('.role-ai-assist');
    if(!fold){
      fold=document.createElement('details');fold.className='role-ai-assist';fold.innerHTML='<summary>AI 辅助修改</summary><div class="role-assist-body"><p class="role-assist-note">描述你想调整的地方，AI 会结合现有角色生成建议。检查后再应用。</p><label>修改要求<textarea class="assist-instruction" placeholder="例如：保留审查职责，语气温和一些，并要求给出具体改进建议。" maxlength="10000"></textarea></label><div class="role-assist-actions"><button type="button" class="assist-generate">生成修改建议</button><button type="button" class="assist-cancel" hidden>停止生成</button></div><p class="assist-status" role="status"></p><div class="assist-preview" hidden><label>建议名称<input class="assist-name" maxlength="80"></label><label>建议角色提示<textarea class="assist-prompt" maxlength="20000"></textarea></label><label>建议温度<input class="assist-temp" type="number" min="0" max="1" step="0.05"></label><div class="role-assist-actions"><button type="button" class="assist-apply">应用到当前角色</button><button type="button" class="assist-discard">放弃建议</button></div></div></div>';
      fold.open=state.open;card.querySelector('.ai-prompt').closest('.ai-card-field').after(fold);
      const preview=fold.querySelector('.assist-preview'),notice=document.createElement('p');notice.className='assist-draft-notice';notice.textContent='待确认建议 · 应用后才会修改角色';preview.prepend(notice);
      const original=document.createElement('details');original.className='assist-original';original.innerHTML='<summary>查看当前角色内容</summary><pre></pre>';notice.after(original);
      const config=document.createElement('a');config.className='assist-config-link';config.href='settings.html';config.target='_blank';config.rel='noopener';config.textContent='配置模型服务 ↗';fold.querySelector('.assist-status').after(config);
      fold.addEventListener('toggle',()=>{state.open=fold.open;});
      fold.querySelector('.assist-instruction').addEventListener('input',event=>{state.instruction=event.target.value;paint();});
      for(const [field,key] of [['.assist-name','name'],['.assist-prompt','prompt'],['.assist-temp','temp']])fold.querySelector(field).addEventListener('input',event=>{if(state.draft)state.draft[key]=key==='temp'?Number(event.target.value):event.target.value;});
      fold.querySelector('.assist-generate').addEventListener('click',async()=>{
        if(state.busy)return;state.busy=true;state.controller=new AbortController();state.draft=null;state.status='正在生成修改建议…';paint();
        try{state.draft=await api.suggestRoleRevision(api.getView().room.participants.indexOf(participant),state.instruction,state.controller.signal);state.status=state.draft.message;}
        catch(error){state.status=error.name==='AbortError'?'已停止生成，原角色未修改。':error.message;}
        finally{state.busy=false;paint();window.DreamscapeRoomUI?.refresh();}
      });
      fold.querySelector('.assist-cancel').addEventListener('click',()=>state.controller?.abort());
      fold.querySelector('.assist-apply').addEventListener('click',()=>{try{api.applyRoleRevision(state.draft);state.draft=null;state.status='已应用并保存到当前角色。';window.DreamscapeRoomUI?.refresh();}catch(error){state.status=error.message;}paint();});
      fold.querySelector('.assist-discard').addEventListener('click',()=>{state.draft=null;state.status='已放弃建议，原角色未修改。';paint();});
    }
    function paint(){
      const view=api.getView(),disabled=view.running||participant.locked;
      fold.querySelector('.assist-instruction').value=state.instruction;fold.querySelector('.assist-instruction').disabled=disabled||state.busy;
      fold.querySelector('.assist-generate').disabled=disabled||state.busy||!state.instruction.trim()||!DreamscapeConfig.getKey(participant.provider);
      fold.querySelector('.assist-cancel').hidden=!state.busy;
      const noKey=!DreamscapeConfig.getKey(participant.provider);
      fold.querySelector('.assist-status').textContent=view.running?'讨论进行中，停止讨论后可修改角色。':participant.locked?'解锁角色后可使用 AI 辅助修改。':noKey?'当前模型服务尚未配置 API Key，配置后即可生成建议。':state.status||'使用当前角色的模型：'+participant.model;
      fold.querySelector('.assist-config-link').hidden=!noKey;
      fold.querySelector('.assist-preview').hidden=!state.draft;
      fold.querySelector('.assist-original pre').textContent=participant.name+'\n\n'+participant.prompt+'\n\n温度：'+participant.temp;
      fold.querySelector('.assist-apply').disabled=disabled||state.busy;
      if(state.draft)for(const [field,key] of [['.assist-name','name'],['.assist-prompt','prompt'],['.assist-temp','temp']]){fold.querySelector(field).value=state.draft[key];fold.querySelector(field).disabled=disabled||state.busy;}
    }
    paint();
  }
  window.DreamscapeRoleAssist={mount};
})();
