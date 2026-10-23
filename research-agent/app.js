import {loadConfig,selectedConfig} from './config.js';
import {makeTask,snapshot,restore,ResearchAgent,rejectResult} from './agent.js';
import {createTools,createModel,translateRecords,suggestDirections} from './tools.js';
import {judgeRevision,reviseTask,searchExisting} from './revisions.js';
import {flagExistingConflicts} from './scope.js';
import {cachedTranslation,translationQueue,applyTranslations} from './translation.js';
import {demoAdapters} from './demo.js';
const $=id=>document.getElementById(id);let task,agent,filter='pending',busy=false,level=0,chinese=false,translating=false,translationController,localMatchIDs=null;
const labels={idle:'准备就绪',running:'正在搜集',complete:'本轮完成',partial:'部分完成',paused:'已暂停',budget:'已到预算',error:'请求失败'};
const visibleResults=()=>task.results.filter(r=>(filter==='all'||r.status===filter)&&(!localMatchIDs||localMatchIDs.includes(r.id)));
const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
function render(){if(!task)return;$('workspace').hidden=false;$('status').textContent=(task.demo?'演示 · ':'')+(labels[task.status]||task.status)+` · ${task.used.steps}/${task.limits.steps} 轮 · ${task.used.requests}/${task.limits.requests} 次请求`;$('counts').textContent=`${task.results.filter(r=>r.status==='approved').length} 项通过 / ${task.results.length} 项候选`;$('summary').textContent=task.summary;$('plan').textContent=task.plan?['检索计划：'+task.plan.topic,'筛选：'+(task.plan.criteria.join('；')||'按原需求'),'排除：'+(task.plan.exclusions.join('；')||'无额外限制'),'查询：'+task.plan.queries.join(' / ')].join('\n'):'';$('gaps').textContent=task.gaps.length?'待补充：'+task.gaps.join('；'):'';$('start').disabled=busy;$('start').textContent=busy?'正在处理…':'搜索 ↗';$('demo').disabled=busy;$('stop').hidden=!busy;$('continue').disabled=busy;$('continue').textContent=task.demo?'继续演示':'继续深入';
 const missing=translationQueue(visibleResults(),level===2).length;$('language').textContent=translating?'取消翻译':chinese?(missing?'中文 · '+missing+'待译':'中文'):'原文';$('language').title=chinese?'点击返回原文；未翻译内容暂显示原文':'点击分批翻译当前分类全部结果；使用模型 API 计费';$('language').disabled=busy;
 $('level').textContent=['名称','基础','详细'][level]+' ▾';
 const list=$('results');list.replaceChildren();const rows=task.results.filter(r=>(filter==='all'||r.status===filter)&&(!localMatchIDs||localMatchIDs.includes(r.id)));const sort=$('sort').value;
 rows.sort((a,b)=>sort==='score'?b.score-a.score:sort==='year'?b.year-a.year:String(sort==='source'?a.source:a.title).localeCompare(String(sort==='source'?b.source:b.title),'zh-CN'));
 if(!rows.length)list.append(el('p','此分类暂无条目','empty'));
 const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 for(const [index,r] of rows.entries()){
  const c=el('details','','card record-shell');c.dataset.id=r.id;c.open=level>0;const head=el('summary','','record-head');head.tabIndex=-1;head.onclick=e=>e.preventDefault();head.append(el('span',String(index+1).padStart(2,'0'),'record-number'));
  const title=el('div','','record-title');title.append(el('span',(r.demo?'[演示] ':'')+(chinese?cachedTranslation(r)?.title||r.title:r.title)));if(chinese&&!cachedTranslation(r)?.title)title.append(el('small',' 原文 · 待译','translation-pending'));head.append(title,el('span',({approved:'已通过',pending:'待确认',rejected:'已排除'})[r.status],'badge '+r.status));const feedback=el('button',r.userRejected?'已排除':'不相关','feedback-button');feedback.disabled=busy||r.userRejected;feedback.onclick=e=>{e.preventDefault();e.stopPropagation();$('feedback-id').value=r.id;$('feedback-reason').value='';$('feedback-dialog').showModal();};head.append(feedback);c.append(head);
  const d=el('details','','record-detail');d.dataset.id=r.id;d.open=level===2;const detailLabel=el('summary','详细信息');detailLabel.hidden=true;d.append(detailLabel);d.hidden=level<2;
  const basic=el('div','','record-basic');
  if(r.previewURL){const img=document.createElement('img');img.src=r.previewURL;img.alt=r.title;img.loading='lazy';img.referrerPolicy='no-referrer';basic.append(img);}
  const meta=el('dl','','metadata');for(const [key,value] of [['来源',r.source||'未知'],['年份',r.year||'未提供'],['资料类型',({paper:'论文',image:'图片',web:'网页'})[r.type]||'资料'],['相关评分',r.score?r.score+'/100':'尚未评分'],...(r.license?[['许可',r.license]]:[])])meta.append(el('dt',key),el('dd',String(value)));
  basic.append(meta,el('p',r.reason,'review-reason'));c.append(basic);
  for(const [label,value] of [['摘要 / 图片描述',(chinese?cachedTranslation(r)?.abstract||r.abstract:r.abstract)||'来源未提供摘要或描述'],['审核依据',r.evidence||'尚无可追溯的审核摘录'],['已读取正文',r.excerpt||'尚未阅读全文']]){d.append(el('h3',label),el('p',value,'detail-text'));}
  if(chinese&&cachedTranslation(r)){d.append(el('h3','原文标题'),el('p',r.title,'detail-text'));if(cachedTranslation(r).abstract)d.append(el('h3','原文摘要'),el('p',r.abstract,'detail-text'));}
  if(r.doi)d.append(el('h3','DOI'),el('p',r.doi));const links=el('div','','record-links');links.append(link('打开原始来源 ↗',r.url));if(r.downloadURL)links.append(link('原始文件 ↗',r.downloadURL));d.append(links);c.append(d);list.append(c);
 }

 for(const b of document.querySelectorAll('[data-filter]')){b.classList.toggle('active',b.dataset.filter===filter);b.textContent=({approved:'已通过',pending:'待确认',rejected:'已排除'})[b.dataset.filter]+` ${task.results.filter(r=>r.status===b.dataset.filter).length}`;}
 $('events').replaceChildren(...task.events.slice(-30).map(e=>el('li',e.text)));
 try{localStorage.setItem('dreamscape_agent_task',JSON.stringify(snapshot(task)));}catch{$('notice').textContent='浏览器存储空间不足，建议导出进度。';}
}
try{const selected=localStorage.getItem('dreamscape_agent_model');if(['deepseek','glm','glm-flash'].includes(selected))$('provider').value=selected;}catch{}
$('provider').onchange=()=>{try{localStorage.setItem('dreamscape_agent_model',$('provider').value);}catch{}};
const config=()=>selectedConfig($('provider').value);
function requireKey(){const c=config();if(!(c.provider==='glm'?c.glmKey:c.key))throw Error('深入搜集需要模型 Key，请前往右上角“全局配置”填写。');return c;}
async function runAgent(extend=false){const c=task.demo?{}:requireKey();const a=task.demo?demoAdapters(task):{tools:createTools(c),model:createModel(c)};agent=new ResearchAgent({task,...a,onChange:render});await agent.run({extend});filter=task.results.some(r=>r.status==='approved')?'approved':'pending';}
async function action(fn){if(busy)return;if(translating){$('notice').textContent='请先取消或等待翻译完成。';return;}busy=true;$('start').disabled=true;$('start').textContent='正在处理…';$('notice').textContent='';render();try{await fn();}catch(e){$('notice').textContent=e.message;if(task){task.status='error';task.summary=e.message;}}finally{busy=false;$('start').disabled=false;$('start').textContent='搜索 ↗';render();}}
let resolveDirection,directionRequest='',directionAbort,lastDirectionExtra='',directionRound=0;
function showDirectionOptions(options,preserve=false){const selected=preserve?[...document.querySelectorAll('#direction-options input:checked')].map(n=>({group:n.name.replace('direction-',''),label:n.parentElement.textContent,value:n.value})):[];options=[...selected,...options.filter(o=>!selected.some(s=>s.group===o.group&&s.value===o.value))];const box=$('direction-options');box.replaceChildren();for(const group of ['对象','方向','关键词']){const rows=options.filter(o=>o.group===group);if(!rows.length)continue;const field=el('fieldset','');field.append(el('legend',group));for(const o of rows){const label=el('label','','direction-choice'),input=document.createElement('input');input.type=group==='对象'?'radio':'checkbox';input.name='direction-'+group;input.value=o.value;input.checked=selected.some(s=>s.group===o.group&&s.value===o.value);label.append(input,document.createTextNode(o.label));field.append(label);}box.append(field);}}
function chooseDirections(request){directionRequest=request;lastDirectionExtra='';directionRound=0;$('direction-confirm').textContent='确定并搜索';$('direction-original').textContent='原需求：'+request;$('direction-extra').value='';$('direction-status').textContent='';$('direction-ai').disabled=false;
 showDirectionOptions(/苹果|apple/i.test(request)?[{group:'对象',label:'苹果公司',value:'苹果公司 Apple Inc.'},{group:'对象',label:'苹果果实 / 果树',value:'苹果果实 apple fruit Malus domestica'},{group:'方向',label:'产品与设计',value:'产品设计 product design'},{group:'方向',label:'管理与创新',value:'管理与创新 innovation management'},{group:'方向',label:'种植与果实研究',value:'种植与果实研究 horticulture'}]:[]);
 return new Promise(resolve=>{resolveDirection=resolve;$('direction-dialog').showModal();});}
function closeDirections(value){directionAbort?.abort();$('direction-dialog').close();resolveDirection?.(value);}
$('direction-cancel').onclick=()=>closeDirections(null);$('direction-dialog').addEventListener('cancel',()=>{directionAbort?.abort();resolveDirection?.(null);});
const directionSelection=()=>[...document.querySelectorAll('#direction-options input:checked')].map(n=>n.value);
function directionContext(){const selected=directionSelection(),extra=$('direction-extra').value.trim();return [directionRequest,...(selected.length?['已选方向：'+selected.join('；')]:[]),...(extra?['用户补充：'+extra]:[])].join('\n');}
async function updateDirectionOptions(){
 let c;try{c=requireKey();}catch{$('direction-status').textContent='更新选项需要模型 Key，请先填写；补充内容已保留，尚未开始搜索。';return false;}
 directionAbort?.abort();directionAbort=new AbortController();const controller=directionAbort,extra=$('direction-extra').value.trim(),context=directionContext();$('direction-ai').disabled=true;$('direction-confirm').disabled=true;$('direction-status').textContent='正在根据已选方向和补充生成下一轮选项…';const timer=setTimeout(()=>controller.abort(),60000);
 try{const options=await suggestDirections(context,c,controller.signal);controller.signal.throwIfAborted();showDirectionOptions(options,true);lastDirectionExtra=extra;directionRound++;$('direction-status').textContent=`第 ${directionRound} 轮选项已更新，已选项保留。可继续补充，也可确定并搜索。`;return true;}
 catch(e){if($('direction-dialog').open)$('direction-status').textContent=controller.signal.aborted?'更新已取消或超时，补充与选择保留。':e.message;return false;}
 finally{clearTimeout(timer);$('direction-ai').disabled=false;$('direction-confirm').disabled=false;}
}
$('direction-extra').oninput=()=>{$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';};
$('direction-confirm').onclick=async()=>{if($('direction-extra').value.trim()!==lastDirectionExtra){await updateDirectionOptions();$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';return;}closeDirections(directionContext());};
$('direction-ai').onclick=async()=>{await updateDirectionOptions();$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';};
let resolveRoute;
function chooseRoute(reason){$('route-reason').textContent=reason;return new Promise(resolve=>{resolveRoute=resolve;$('route-dialog').showModal();});}
for(const b of document.querySelectorAll('[data-route]'))b.onclick=()=>{$('route-dialog').close();resolveRoute(b.dataset.route);};
$('route-dialog').addEventListener('cancel',()=>resolveRoute('cancel'));
function archiveCurrent(){if(task)localStorage.setItem('dreamscape_agent_previous',JSON.stringify(snapshot(task)));}
$('start').onclick=()=>action(async()=>{
 let request=$('request').value.trim();const type=$('type').value,mode=document.querySelector('[name=mode]:checked').value;
 if(!request)throw Error('请先输入需求');
 request=await chooseDirections(request);if(request===null)return;
 localMatchIDs=null;let route=judgeRevision(task,request,type);let decision=route.action;
 if(decision==='ask')decision=await chooseRoute(route.reason);if(decision==='cancel')return;
 if(mode==='agent')requireKey();$('request').value=request;
 if(decision==='reuse'){
  archiveCurrent();reviseTask(task,{request,type,target:$('target').value});filter='pending';render();
  if(task.demo){task.summary+=' 当前为演示项目，真实搜集请新建项目。';return;}
  if(mode==='agent')await runAgent(task.used.steps>=task.limits.steps||task.used.requests>=task.limits.requests);
  else {
   const matches=searchExisting(task.results,request);
   if(matches.length){localMatchIDs=matches.map(r=>r.id);filter='all';task.summary=`已有资料检索完成：${task.results.length} 项中匹配 ${matches.length} 项。仅做标题和摘要关键词匹配，相关性需深入审核。`;$('notice').textContent=task.summary;}
   else {task.summary='已有资料未找到关键词匹配，正在补搜…';render();await quickSearch();}
  }
  render();$('workspace').scrollIntoView({behavior:'smooth',block:'start'});
  return;
 }
 const next=makeTask({request,type,mode,target:$('target').value,maxSteps:config().steps,maxRequests:config().requests,minutes:config().minutes});
 archiveCurrent();task=next;filter='pending';render();
 if(mode==='agent')await runAgent();else{
  await quickSearch();
 }
});
async function quickSearch(){
 const tools=createTools(config());agent=new ResearchAgent({task,tools,onChange:render});agent.controller=new AbortController();task.status='running';render();
 const timeout=setTimeout(()=>agent.stop(),task.limits.ms);
 try{
  if(task.used.requests>=task.limits.requests)throw Error('网络请求预算已用完，请增加预算后继续深入');
  task.used.requests++;const name=task.type==='paper'?'search_papers':task.type==='image'?'search_images':'search_web';
  const before=task.results.length,rows=await tools[name]({query:task.request,source:'crossref',page:1},agent.controller.signal);agent.controller.signal.throwIfAborted();agent.add(rows);
  task.status='partial';task.summary=`快速检索完成：新增 ${task.results.length-before} 项，保留已有资料；候选尚未按当前条件审核。`;$('notice').textContent=task.summary;
 }finally{clearTimeout(timeout);}
}
$('restore-previous').onclick=()=>{if(busy)return;try{const saved=localStorage.getItem('dreamscape_agent_previous');if(!saved){$('notice').textContent='暂无上一版项目';return;}const previous=restore(JSON.parse(saved));archiveCurrent();task=previous;localMatchIDs=null;$('request').value=task.request;$('type').value=task.type;filter='pending';render();}catch{$('notice').textContent='上一版项目无法恢复';}};
$('demo').onclick=()=>action(async()=>{localMatchIDs=null;task=makeTask({request:'找城市树冠和街道植被缓解热岛的论文，兼顾不同气候。',target:2,demo:true});$('request').value=task.request;await runAgent();});
$('continue').onclick=()=>action(()=>runAgent(task.used.steps>=task.limits.steps||task.used.requests>=task.limits.requests));
$('stop').onclick=()=>agent?.stop();
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{localMatchIDs=null;filter=b.dataset.filter;render();};

$('feedback-form').onsubmit=e=>{e.preventDefault();rejectResult(task,$('feedback-id').value,$('feedback-reason').value);$('feedback-dialog').close();render();};
$('feedback-cancel').onclick=()=>$('feedback-dialog').close();
$('language').onclick=async()=>{
 if(translating){translationController.abort();return;}if(busy||!task)return;
 const detail=level===2,records=visibleResults(),queue=translationQueue(records,detail);
 if(chinese){chinese=false;render();return;}
 if(!queue.length){chinese=true;render();return;}
 let c;try{c=requireKey();}catch(e){$('notice').textContent=e.message.replace('深入搜集','翻译');return;}
 const current=task;translationController=new AbortController();translating=true;chinese=true;render();let done=0;
 try{
  for(let i=0;i<queue.length;i+=5){
   const batch=queue.slice(i,i+5),timer=setTimeout(()=>translationController.abort(),120000);
   try{const items=await translateRecords(batch,detail,c,translationController.signal,current.request);translationController.signal.throwIfAborted();const n=applyTranslations(batch,items,detail);done+=n;render();if(n!==batch.length)throw Error('部分条目未返回译文，请再次点击中文按钮补译');}
   finally{clearTimeout(timer);}
   $('notice').textContent=`正在翻译 ${done}/${queue.length} 项，已完成部分已缓存。`;
  }
  $('notice').textContent='当前分类翻译完成，译文已缓存。点击“中文”可返回原文。';
 }
 catch(e){$('notice').textContent=translationController.signal.aborted?'翻译已取消，已有缓存保留。':e.message;}
 finally{translating=false;render();}

};
$('sort').onchange=render;
$('level').onclick=()=>{level=(level+1)%3;render();};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(snapshot(task),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='dreamscape_agent_task.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{const saved=localStorage.getItem('dreamscape_agent_task');if(saved){task=restore(JSON.parse(saved));flagExistingConflicts(task);$('request').value=task.request;$('type').value=task.type;$('target').value=task.target;filter=task.results.some(r=>r.status==='approved')?'approved':'pending';render();}}catch{$('notice').textContent='旧进度无法恢复，可以重新开始。';}

