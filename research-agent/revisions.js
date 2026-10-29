const normalized=s=>String(s||'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const tokens=s=>{const text=normalized(s),out=new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g)||[]);for(let i=0;i<text.length-1;i++)if(/[\u3400-\u9fff]/.test(text[i]+text[i+1]))out.add(text.slice(i,i+2));return out;};
export function judgeRevision(task,request,type){
 if(!task)return {action:'new',reason:'首次搜集'};
 if(type!==task.type)return {action:'ask',reason:'资料类型发生变化，选择保留项目还是新建项目'};
 const a=normalized(task.request),b=normalized(request);
 if(a===b)return {action:'reuse',reason:'需求相同，复用已有资料'};
 if(/^(重新开始|新项目|换个主题|换一个主题|另一个项目)/.test(request.trim()))return {action:'new',reason:'明确要求切换项目'};
 if((a.length>5&&b.includes(a))||(b.length>5&&a.includes(b)))return {action:'reuse',reason:'原需求的补充或收缩，先检查已有资料'};
 const x=tokens(task.request),y=tokens(request);let shared=0;for(const word of x)if(y.has(word))shared++;const overlap=shared/Math.max(1,Math.min(x.size,y.size));
 if(overlap>=0.35||/^(补充|增加|加上|只要|优先|排除|不要|限定|改为|改成|细化|进一步|再找|继续)/.test(request.trim()))return {action:'reuse',reason:'识别为条件补充，保留结果并重新筛选'};
 return {action:'ask',reason:'无法确定是否仍属于当前项目，原结果已保留'};
}
export function reviseTask(task,{request,type,target}){
 task.revisions??=[];task.revisions.push({request:task.request,type:task.type,at:new Date().toISOString()});task.revisions=task.revisions.slice(-20);
 const previous=task.request;task.request=request.trim().slice(0,4000);task.type=type;task.target=Math.min(1000,Math.max(1,Number(target)||5));task.plan=null;
 // Complete outstanding tool messages before inserting the new user instruction.
 for(const c of task.pending||[])task.messages.push({role:'tool',tool_call_id:c.id,content:'{"error":"需求已更新，该调用取消"}'});task.pending=[];
 task.recheckIDs=task.results.filter(r=>!r.userRejected&&r.reason!=='网站图标或厂商标志不能代替主题图片').map(r=>r.id);
 for(const r of task.results)if(task.recheckIDs.includes(r.id)){r.status='pending';r.score=0;r.evidence='';r.reason='需求已更新，等待按新条件重新核验';}
 if(task.messages.length)task.messages.push({role:'user',content:JSON.stringify({instruction:'这是当前项目的新版本。先用已有标题、摘要和正文重新审核，缺少证据可阅读已有条目；完成已有资料审核后，仅针对缺口发起新检索。不得重新批准人工排除项。请更新计划。',previous,request:task.request,type,target:task.target,existing:task.results})});
 task.status='paused';task.summary=`已保留 ${task.results.length} 项已有资料，优先按新条件重新筛选。`;return task;
}
export function searchExisting(records,request){
 const query=String(request).toLowerCase();const terms=query.match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g)||[];
 const aliases={'苹果':['apple','malus'],'苹果公司':['apple inc','apple company'],'论文':[],'研究':[]};
 const expanded=terms.flatMap(t=>[t,...(aliases[t]||[])]).filter(t=>!['论文','研究','资料','找一下','搜索'].includes(t));
 if(!expanded.length)return [];
 return records.map(r=>({record:r,score:expanded.reduce((n,t)=>n+(String(r.title).toLowerCase().includes(t)?3:0)+(String(r.abstract).toLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.record);
}
