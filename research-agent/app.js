import {MATERIALS,materialList} from './materials.js';
import {GROUPS,initialOptions,normalizeOptions,mergeOptions,selectionContext} from './directions.js';
import {PRICES,VERIFIED,estimate,newUsage,recordUsage,mergeUsage,usageSummary,money} from './costs.js';
import {qualityLabels} from './presentation.js';
import {loadConfig,selectedConfig} from './config.js';
import {makeTask,snapshot,restore,ResearchAgent,rejectResult} from './agent.js';
import {createTools,createModel,translateRecords,suggestDirections} from './tools.js';
import {judgeRevision,reviseTask,searchExisting} from './revisions.js';
import {flagExistingConflicts} from './scope.js';
import {cachedTranslation,translationQueue,applyTranslations} from './translation.js';
import {demoAdapters} from './demo.js';
const $=id=>document.getElementById(id);let task,agent,filter='pending',busy=false,level=0,chinese=false,translating=false,translationController,localMatchIDs=null;
let preparationUsage=newUsage(),confirmedDirections=[],directionOptions=[],chosenDirections=new Map();
let selectedMaterials=['paper'];
function syncMaterials(ids=selectedMaterials){selectedMaterials=ids.length?ids:['paper'];$('type').value=selectedMaterials.includes('paper')?'paper':selectedMaterials.includes('image')?'image':'web';$('material-label').textContent=materialList(selectedMaterials).map(m=>m.label).join('、');for(const n of document.querySelectorAll('[name=material]'))n.checked=selectedMaterials.includes(n.value);updateCosts();}
document.addEventListener('click',e=>{if(!$('material-picker').contains(e.target))$('material-picker').open=false;});
function materialSelection(){const rows=materialList(selectedMaterials),extra=$('material-extra').value.trim();return extra?[...rows,{id:'custom',label:extra,tool:'search_web',hint:extra}]:rows;}
const labels={idle:'准备就绪',running:'正在搜集',complete:'本轮完成',partial:'部分完成',paused:'已暂停',budget:'已到运行上限',error:'请求失败'};
const visibleResults=()=>task.results.filter(r=>(filter==='all'||r.status===filter)&&(!localMatchIDs||localMatchIDs.includes(r.id)));
const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
for(const m of MATERIALS){const label=el('label','','material-choice'),input=document.createElement('input');input.type='checkbox';input.name='material';input.value=m.id;input.checked=m.id==='paper';input.onchange=()=>{const ids=[...document.querySelectorAll('[name=material]:checked')].map(n=>n.value);syncMaterials(ids);};label.append(input,document.createTextNode(m.label));$('material-options').append(label);}
function render(){if(!task)return;$('workspace').hidden=false;$('status').textContent=(task.demo?'演示 · ':'')+(labels[task.status]||task.status)+` · 本次调用 ${Math.max(0,(task.used.calls??task.used.steps+task.used.requests)-(task.runStartCalls||0))} 次`;$('counts').textContent=`${task.results.filter(r=>r.status==='approved').length} 项通过 / ${task.results.length} 项候选`;$('summary').textContent=task.summary;$('plan').textContent=task.plan?['检索计划：'+task.plan.topic,'筛选：'+(task.plan.criteria.join('；')||'按原需求'),'排除：'+(task.plan.exclusions.join('；')||'无额外限制'),'查询：'+task.plan.queries.join(' / ')].join('\n'):'';$('gaps').textContent=task.gaps.length?'待补充：'+task.gaps.join('；'):'';$('start').disabled=busy;$('start').textContent=busy?'正在处理…':'搜索 ↗';$('demo').disabled=busy;$('stop').hidden=!busy;$('continue').disabled=busy;$('continue').textContent=task.demo?'继续演示':'继续深入';
 updateCosts();$('progress-strip').textContent=busy?(task.events.at(-1)?.text||'正在准备检索…'):`${task.results.length} 项候选 · ${task.results.filter(r=>r.status==='approved').length} 项主题符合 · ${task.results.filter(r=>r.status==='pending').length} 项待确认`;$('active-conditions').hidden=!(task.directionChoices?.length);$('condition-tags').replaceChildren(...(task.directionChoices||[]).map(o=>el('span',o.group+'：'+o.label,'condition-tag')));
 const missing=translationQueue(visibleResults(),level===2).length;$('language').textContent=translating?'取消翻译':chinese?(missing?'中文 · '+missing+'待译':'中文'):'原文';$('language').title=chinese?'点击返回原文；未翻译内容暂显示原文':'点击分批翻译当前分类全部结果；使用模型 API 计费';$('language').disabled=busy;
 $('level').textContent=['名称','基础','详细'][level]+' ▾';
 const list=$('results');list.replaceChildren();const rows=task.results.filter(r=>(filter==='all'||r.status===filter)&&(!localMatchIDs||localMatchIDs.includes(r.id)));const sort=$('sort').value;
 rows.sort((a,b)=>sort==='score'?b.score-a.score:sort==='year'?b.year-a.year:String(sort==='source'?a.source:a.title).localeCompare(String(sort==='source'?b.source:b.title),'zh-CN'));
 if(!rows.length)list.append(el('p','此分类暂无条目','empty'));
 const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 for(const [index,r] of rows.entries()){
  const c=el('details','','card record-shell');c.dataset.id=r.id;c.open=level>0;const head=el('summary','','record-head');head.tabIndex=-1;head.onclick=e=>e.preventDefault();head.append(el('span',String(index+1).padStart(2,'0'),'record-number'));
  const title=el('div','','record-title');title.append(el('span',(r.demo?'[演示] ':'')+(chinese?cachedTranslation(r)?.title||r.title:r.title)));if(chinese&&!cachedTranslation(r)?.title)title.append(el('small',' 原文 · 待译','translation-pending'));const sourceLink=link(r.url,r.url);sourceLink.className='source-link';sourceLink.title='打开原始来源：'+r.url;sourceLink.onclick=e=>e.stopPropagation();title.append(sourceLink);head.append(title,el('span',({approved:'已通过',pending:'待确认',rejected:'已排除'})[r.status],'badge '+r.status));const feedback=el('button',r.userRejected?'已排除':'不相关','feedback-button');feedback.disabled=busy||r.userRejected;feedback.onclick=e=>{e.preventDefault();e.stopPropagation();$('feedback-id').value=r.id;$('feedback-reason').value='';$('feedback-dialog').showModal();};head.append(feedback);c.append(head);
  const d=el('details','','record-detail');d.dataset.id=r.id;d.open=level===2;const detailLabel=el('summary','详细信息');detailLabel.hidden=true;d.append(detailLabel);d.hidden=level<2;
  const basic=el('div','','record-basic');
  if(r.previewURL){const img=document.createElement('img');img.src=r.previewURL;img.alt=r.title;img.loading='lazy';img.referrerPolicy='no-referrer';basic.append(img);}
  const meta=el('dl','','metadata');for(const [key,value] of [['来源',r.source||'未知'],['年份',r.year||'未提供'],['资料类型',r.materialType||({paper:'论文',image:'图片',web:'网页'})[r.type]||'资料'],...(r.queryGroups?.length?[['检索方向',r.queryGroups.join('；')]]:[]),['作者',r.authors||'未提供'],['期刊 / 出版来源',r.journal||'未提供'],['相关评分',r.score?r.score+'/100（模型判断）':'尚未评分'],...(r.license?[['许可',r.license]]:[])])meta.append(el('dt',key),el('dd',String(value)));
  basic.append(meta,el('p',(r.status==='approved'?'符合原因：':r.status==='rejected'?'排除原因：':'待确认：')+r.reason,'review-reason'));basic.append(el('p',qualityLabels(r).join(' · '),'quality-labels'));c.append(basic);
  for(const [label,value] of [['摘要 / 图片描述',(chinese?cachedTranslation(r)?.abstract||r.abstract:r.abstract)||'来源未提供摘要或描述'],['审核依据',r.evidence||'尚无可追溯的审核摘录'],['已读取正文',r.excerpt||'尚未阅读全文']]){d.append(el('h3',label),el('p',value,'detail-text'));}
  if(chinese&&cachedTranslation(r)){d.append(el('h3','原文标题'),el('p',r.title,'detail-text'));if(cachedTranslation(r).abstract)d.append(el('h3','原文摘要'),el('p',r.abstract,'detail-text'));}
  if(r.doi)d.append(el('h3','DOI'),el('p',r.doi));const links=el('div','','record-links');links.append(link('打开原始来源 ↗',r.url));if(r.downloadURL)links.append(link('原始文件 ↗',r.downloadURL));d.append(links);c.append(d);list.append(c);
 }

 for(const b of document.querySelectorAll('[data-filter]')){b.classList.toggle('active',b.dataset.filter===filter);b.textContent=({approved:'已通过',pending:'待确认',rejected:'已排除'})[b.dataset.filter]+` ${task.results.filter(r=>r.status===b.dataset.filter).length}`;}
 $('events').replaceChildren(...task.events.slice(-30).map(e=>el('li',e.text)));
 try{localStorage.setItem('dreamscape_agent_task',JSON.stringify(snapshot(task)));}catch{$('notice').textContent='浏览器存储空间不足，建议导出进度。';}
}
function runLimits(){const calls=Number($('run-calls').value),minutes=Number($('run-minutes').value);if(!Number.isInteger(calls)||calls<1||calls>10000)throw Error('调用次数请输入 1–10000 的整数');if(!Number.isFinite(minutes)||minutes<.5||minutes>1440)throw Error('运行时间请输入 0.5–1440 分钟');return {calls,steps:calls,requests:calls,minutes};}
function validateTarget(){const n=Number($('target').value);if(!Number.isInteger(n)||n<1||n>1000)throw Error('目标数量请输入 1–1000 的整数');return n;}
function updateCosts(){
 let limits;try{limits=runLimits();$('limit-error').textContent='';}catch(error){$('limit-error').textContent=error.message;$('cost-brief').textContent='请检查输入';$('cost-estimate').textContent='';return;}
 try{localStorage.setItem('dreamscape_agent_run_limits',JSON.stringify({calls:limits.calls,minutes:limits.minutes}));}catch{}
 const c=selectedConfig($('provider').value),mode=document.querySelector('[name=mode]:checked').value,type=materialSelection().some(m=>m.tool==='search_web')?'web':$('type').value,e=estimate(c,limits,{mode,type,quickCount:Math.max(1,materialSelection().filter(m=>m.tool==='search_web').length)*($('direction-dialog').open?[...chosenDirections.values()]:task?.directionChoices||[]).filter(o=>o.group==='对象').length||1}),range=e.range.map(money).join('–');
 $('cost-brief').textContent=e.coding?'套餐积分另计':e.range[1]===0?'公共来源免费':'约 '+range;
 $('cost-estimate').textContent=e.coding?'套餐积分另计；网页调用最多 '+range:mode==='quick'&&type!=='web'?'公共来源检索免费。':`按 ${limits.calls} 次调用估算：${range}。`;
 $('cost-assumptions').textContent=`每次按输入 2,000–48,000、输出 ${e.perRoundOutput[0].toLocaleString()}–${e.perRoundOutput[1].toLocaleString()} Token估算；实际按用量计费。网页搜索/阅读 ¥0.005 / 成功请求。`;
 const ref=$('price-reference');ref.replaceChildren(document.createTextNode(`价格核对 ${VERIFIED} · `));const a=el('a','官方价格 ↗');a.href=e.price?.url||'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';a.target='_blank';a.rel='noopener noreferrer';ref.append(a);
 const ledger=mergeUsage(newUsage(),task?.usage||newUsage());mergeUsage(ledger,preparationUsage);const u=usageSummary(ledger);$('usage-summary').textContent=u.calls||ledger.search||ledger.fetch||ledger.public?`累计 ${u.calls+ledger.search+ledger.fetch+ledger.public} 次（含拆解 / 翻译） · 输入 ${u.input.toLocaleString()} / 输出 ${u.output.toLocaleString()} Token · 约 ${u.range.map(money).join('–')}`+(u.missing?'（部分用量未返回）':'')+(u.coding?'；套餐积分另计':''):'';
}
let savedRun={};try{savedRun=JSON.parse(localStorage.getItem('dreamscape_agent_run_limits')||'{}');}catch{}$('run-calls').value=savedRun.calls||20;$('run-minutes').value=savedRun.minutes||loadConfig().minutes;
for(const id of ['run-calls','run-minutes']){$(id).oninput=updateCosts;$(id).onchange=updateCosts;}
function targetChanged(){try{validateTarget();$('notice').textContent='';}catch(e){$('notice').textContent=e.message;}$('target-minus').disabled=Number($('target').value)<=1;$('target-plus').disabled=Number($('target').value)>=1000;}
$('target').oninput=targetChanged;for(const [id,step] of [['target-minus',-1],['target-plus',1]])$(id).onclick=()=>{$('target').value=Math.min(1000,Math.max(1,(Number($('target').value)||5)+step));targetChanged();};
for(const radio of document.querySelectorAll('[name=mode]'))radio.onchange=updateCosts;$('type').onchange=()=>syncMaterials([$('type').value]);$('material-extra').oninput=updateCosts;
try{const selected=localStorage.getItem('dreamscape_agent_model');if(['deepseek','glm','glm-flash'].includes(selected))$('provider').value=selected;}catch{}
$('provider').onchange=()=>{updateCosts();try{localStorage.setItem('dreamscape_agent_model',$('provider').value);}catch{}};
const config=()=>({...selectedConfig($('provider').value),onUsage:event=>{const ledger=$('direction-dialog').open||!task?preparationUsage:(task.usage??=newUsage());recordUsage(ledger,event);updateCosts();if(task)try{localStorage.setItem('dreamscape_agent_task',JSON.stringify(snapshot(task)));}catch{}}});
function requireKey(){const c=config();if(!(c.provider==='glm'?c.glmKey:c.key))throw Error('深入搜集需要模型 Key，请前往右上角“全局配置”填写。');return c;}
async function runAgent(extend=false){if(!task.demo){const lim=runLimits();task.used.calls??=task.used.steps+task.used.requests;task.runStartCalls=task.used.calls;task.limits.calls=task.used.calls+lim.calls;task.limits.steps=task.used.steps+lim.calls;task.limits.requests=task.used.requests+lim.calls;task.limits.ms=lim.minutes*60000;}const c=task.demo?{}:requireKey();const a=task.demo?demoAdapters(task):{tools:createTools(c),model:createModel(c)};agent=new ResearchAgent({task,...a,onChange:render});await agent.run();filter=task.results.some(r=>r.status==='approved')?'approved':'pending';}
async function action(fn){if(busy)return;if(translating){$('notice').textContent='请先取消或等待翻译完成。';return;}busy=true;$('start').disabled=true;$('start').textContent='正在处理…';$('notice').textContent='';render();try{await fn();}catch(e){$('notice').textContent=e.message;if(task){task.status='error';task.summary=e.message;}}finally{busy=false;$('start').disabled=false;$('start').textContent='搜索 ↗';render();}}
let resolveDirection,directionRequest='',directionAbort,lastDirectionExtra='',directionRound=0;
function chosenKey(o){return o.group+'|'+o.value.toLowerCase();}
function updateChosenSummary(){const rows=[...chosenDirections.values()];$('direction-count').textContent=`${rows.length} 已选 / ${directionOptions.length} 选项`;$('direction-selected').replaceChildren(...rows.map(o=>{const b=el('button',o.label+' ×','condition-tag');b.type='button';b.title='移除 '+o.group+'：'+o.label;b.onclick=()=>{chosenDirections.delete(chosenKey(o));showDirectionOptions(directionOptions,true);};return b;}));}
function showDirectionOptions(options,preserve=false){if(!preserve)chosenDirections.clear();directionOptions=mergeOptions([...chosenDirections.values()],normalizeOptions(options));const box=$('direction-options');box.replaceChildren();const query=$('direction-filter').value.trim().toLowerCase();
 for(const group of GROUPS){const all=directionOptions.filter(o=>o.group===group),rows=all.filter(o=>!query||(o.label+' '+o.value).toLowerCase().includes(query));if(!rows.length)continue;const field=el('details','','direction-section');field.open=Boolean(query)||['对象','方向'].includes(group);field.append(el('summary',`${group} · ${[...chosenDirections.values()].filter(o=>o.group===group).length} 已选 / ${all.length} 项`));const body=el('div','','direction-grid');for(const o of rows){const label=el('label','','direction-choice'),input=document.createElement('input');input.type='checkbox';input.name='direction-'+group;input.value=o.value;input.checked=chosenDirections.has(chosenKey(o));input.onchange=()=>{if(input.checked)chosenDirections.set(chosenKey(o),o);else chosenDirections.delete(chosenKey(o));field.querySelector('summary').textContent=`${group} · ${[...chosenDirections.values()].filter(o=>o.group===group).length} 已选 / ${all.length} 项`;updateChosenSummary();updateCosts();};label.append(input,document.createTextNode(o.label));body.append(label);}field.append(body);box.append(field);}updateChosenSummary();updateCosts();}
$('direction-filter').oninput=()=>showDirectionOptions(directionOptions,true);
$('direction-add').onclick=()=>{const label=$('direction-custom').value.trim();if(!label)return;const o={group:$('direction-group').value,label:label.slice(0,80),value:label.slice(0,160)};chosenDirections.set(chosenKey(o),o);$('direction-custom').value='';$('direction-filter').value='';showDirectionOptions(mergeOptions(directionOptions,[o]),true);};
function chooseDirections(request){directionRequest=task&&request===task.request&&task.baseRequest?task.baseRequest:request;lastDirectionExtra='';directionRound=0;$('direction-filter').value='';$('direction-confirm').textContent='确定并搜索';$('direction-original').textContent='原需求：'+directionRequest;$('direction-extra').value='';$('direction-status').textContent='';$('direction-ai').disabled=false;chosenDirections.clear();const existing=task&&request===task.request?task.directionChoices||[]:[];for(const o of existing)chosenDirections.set(chosenKey(o),o);showDirectionOptions(mergeOptions(existing,initialOptions(request)),true);return new Promise(resolve=>{resolveDirection=resolve;$('direction-dialog').showModal();});}
function closeDirections(value){directionAbort?.abort();$('direction-dialog').close();resolveDirection?.(value);}
$('direction-cancel').onclick=()=>closeDirections(null);$('direction-dialog').addEventListener('cancel',()=>{directionAbort?.abort();resolveDirection?.(null);});
const directionSelection=()=>[...chosenDirections.values()].map(o=>o.value);
function directionContext(){return selectionContext(directionRequest,[...chosenDirections.values()],$('direction-extra').value);}
async function updateDirectionOptions(){
 let c;try{c=requireKey();}catch{$('direction-status').textContent='更新选项需要模型 Key，请先填写；补充内容已保留，尚未开始搜索。';return false;}
 directionAbort?.abort();directionAbort=new AbortController();const controller=directionAbort,extra=$('direction-extra').value.trim(),context=directionContext();$('direction-ai').disabled=true;$('direction-confirm').disabled=true;$('direction-status').textContent='正在根据已选方向和补充生成下一轮选项…';const timer=setTimeout(()=>controller.abort(),60000);
 try{const options=await suggestDirections(context,c,controller.signal);controller.signal.throwIfAborted();showDirectionOptions(mergeOptions(directionOptions,options),true);lastDirectionExtra=extra;directionRound++;$('direction-status').textContent=`第 ${directionRound} 轮选项已更新，已选项保留。可继续补充，也可确定并搜索。`;return true;}
 catch(e){if($('direction-dialog').open)$('direction-status').textContent=controller.signal.aborted?'更新已取消或超时，补充与选择保留。':e.message;return false;}
 finally{clearTimeout(timer);$('direction-ai').disabled=false;$('direction-confirm').disabled=false;}
}
$('direction-extra').oninput=()=>{$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';};
$('direction-confirm').onclick=async()=>{if($('direction-extra').value.trim()!==lastDirectionExtra){await updateDirectionOptions();$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';return;}confirmedDirections=[...chosenDirections.values()];closeDirections(directionContext());};
$('direction-ai').onclick=async()=>{await updateDirectionOptions();$('direction-confirm').textContent=$('direction-extra').value.trim()!==lastDirectionExtra?'继续细化选项':'确定并搜索';};
let resolveRoute;
function chooseRoute(reason){$('route-reason').textContent=reason;return new Promise(resolve=>{resolveRoute=resolve;$('route-dialog').showModal();});}
for(const b of document.querySelectorAll('[data-route]'))b.onclick=()=>{$('route-dialog').close();resolveRoute(b.dataset.route);};
$('route-dialog').addEventListener('cancel',()=>resolveRoute('cancel'));
function archiveCurrent(){if(task)localStorage.setItem('dreamscape_agent_previous',JSON.stringify(snapshot(task)));}
$('start').onclick=()=>action(async()=>{
 let request=$('request').value.trim();const type=$('type').value,mode=document.querySelector('[name=mode]:checked').value;
 if(!request)throw Error('请先输入需求');validateTarget();runLimits();
 const materials=materialSelection();request=await chooseDirections(request);if(request===null)return;
 localMatchIDs=null;let route=judgeRevision(task,request,type);let decision=route.action;
 if(decision==='ask')decision=await chooseRoute(route.reason);if(decision==='cancel')return;
 if(mode==='agent')requireKey();$('request').value=request;
 if(decision==='reuse'){
  archiveCurrent();reviseTask(task,{request,type,target:$('target').value});const nextLimits=runLimits();task.used.calls??=task.used.steps+task.used.requests;task.runStartCalls=task.used.calls;task.limits.calls=task.used.calls+nextLimits.calls;task.limits.requests=task.used.requests+nextLimits.calls;task.limits.steps=task.used.steps+nextLimits.calls;task.limits.ms=nextLimits.minutes*60000;task.materials=materials;task.directionChoices=confirmedDirections;task.baseRequest=directionRequest;task.usage??=newUsage();mergeUsage(task.usage,preparationUsage);preparationUsage=newUsage();filter='pending';render();
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
 const next=makeTask({request,type,mode,target:$('target').value,maxSteps:runLimits().steps,maxRequests:runLimits().requests,minutes:runLimits().minutes});
 next.materials=materials;next.limits.calls=runLimits().calls;next.directionChoices=confirmedDirections;next.baseRequest=directionRequest;next.usage=mergeUsage(newUsage(),preparationUsage);preparationUsage=newUsage();archiveCurrent();task=next;filter='pending';render();
 if(mode==='agent')await runAgent();else{
  await quickSearch();
 }
});
async function quickSearch(){
 const tools=createTools(config());agent=new ResearchAgent({task,tools,onChange:render});agent.controller=new AbortController();task.status='running';render();const signal=agent.controller.signal;
 const timeout=setTimeout(()=>agent.stop(),task.limits.ms),objects=(task.directionChoices||[]).filter(o=>o.group==='对象'),topics=objects.length?objects.map(o=>o.value):[task.baseRequest||task.request];
 const additions=(task.directionChoices||[]).filter(o=>['方向','关键词'].includes(o.group)).map(o=>o.value).join(' OR ');let completed=0;const before=task.results.length;
 try{
  const materials=task.materials?.length?task.materials:materialList([task.type]);const jobs=materials.flatMap(material=>topics.map(topic=>({material,topic})));const total=jobs.length;
  for(const {material,topic} of jobs){const name=material.tool;if(task.used.requests>=task.limits.requests)break;signal.throwIfAborted();const query=[topic,additions,material.hint].filter(Boolean).join(' ').slice(0,300);if(task.limits.calls!=null&&(task.used.calls||0)>=task.limits.calls)break;task.used.calls=(task.used.calls||0)+1;task.used.requests++;agent.emit('tool',`正在检索 ${completed+1}/${total} 个方向：${query}`);const rows=await tools[name]({query,source:'crossref',page:1},signal);signal.throwIfAborted();agent.add(rows.map(r=>({...r,queryGroup:topic+' · '+material.label,materialType:material.label})));completed++;agent.emit('result',`已检索 ${completed}/${total} 个方向，累计 ${task.results.length} 项候选`);}
  task.status=completed<total?'budget':'partial';task.summary=`快速检索完成：新增 ${task.results.length-before} 项，保留已有资料；已检索 ${completed}/${total} 个方向，尚未按完整条件审核。`+(completed<total?' 已达到请求上限，可调整运行限制后继续。':'');$('notice').textContent=task.summary;
 }finally{clearTimeout(timeout);}
}
$('restore-previous').onclick=()=>{if(busy)return;try{const saved=localStorage.getItem('dreamscape_agent_previous');if(!saved){$('notice').textContent='暂无上一版项目';return;}const previous=restore(JSON.parse(saved));archiveCurrent();task=previous;localMatchIDs=null;$('request').value=task.request;syncMaterials(task.materials?.map(m=>m.id).filter(id=>MATERIALS.some(m=>m.id===id))||[task.type]);$('material-extra').value=task.materials?.find(m=>m.id==='custom')?.label||'';filter='pending';render();}catch{$('notice').textContent='上一版项目无法恢复';}};
$('demo').onclick=()=>action(async()=>{localMatchIDs=null;task=makeTask({request:'找城市树冠和街道植被缓解热岛的论文，兼顾不同气候。',target:2,demo:true});$('request').value=task.request;await runAgent();});
$('continue').onclick=()=>action(async()=>{document.querySelector('[name=mode][value=agent]').checked=true;updateCosts();const lim=runLimits();if(task.used.steps>=task.limits.steps||task.used.requests>=task.limits.requests){task.limits.steps=task.used.steps+lim.steps;task.limits.requests=task.used.requests+lim.requests;}task.limits.ms=lim.minutes*60000;await runAgent();});
$('edit-conditions').onclick=()=>{if(!busy&&!translating)$('start').click();};
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
try{const saved=localStorage.getItem('dreamscape_agent_task');if(saved){task=restore(JSON.parse(saved));flagExistingConflicts(task);const modeRadio=document.querySelector('[name=mode][value="'+(task.mode==='quick'?'quick':'agent')+'"]');if(modeRadio)modeRadio.checked=true;$('request').value=task.request;syncMaterials(task.materials?.map(m=>m.id).filter(id=>MATERIALS.some(m=>m.id===id))||[task.type]);$('material-extra').value=task.materials?.find(m=>m.id==='custom')?.label||'';$('target').value=task.target;filter=task.results.some(r=>r.status==='approved')?'approved':'pending';render();}}catch{$('notice').textContent='旧进度无法恢复，可以重新开始。';}


updateCosts();
