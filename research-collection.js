(function(){
  'use strict';
  const clamp=(value,fallback,min,max)=>Math.min(max,Math.max(min,Math.floor(Number(value)||fallback)));
  function limits(value={}){const maximum=clamp(value.maximum,200,1,200);return {target:clamp(value.target,60,1,maximum),maximum,rounds:clamp(value.rounds,5,1,20),requests:clamp(value.requests,50,1,200),minutes:clamp(value.minutes,5,1,15),discover:Boolean(value.discover),resolve:Boolean(value.resolve)};}
  async function collect({session,records,signal,wait=async()=>{},update=()=>{},log=()=>{}}){
    const R=DreamscapeResearch,S=window.DreamscapeResearchService,settings=limits(session.limits),controller=new AbortController(),abort=()=>controller.abort(signal.reason);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},settings.minutes*60000);session.lastRun=null;let used=0,round=0,stagnant=0,stop='来源已耗尽';
    const taskSignal=controller.signal,knownPages=new Set(session.visited||[]),queue=[...(session.queue||[])];for(const state of Object.values(session.cursors))state.suspended=false;
    const report=()=>{session.visited=[...knownPages];session.queue=queue;session.requests=(session.requests||0)+used;session.runRequests=0;session.canContinue=Boolean(session.overflow?.length||queue.length||(session.queryIndex||0)+1<(session.queries?.length||0)||session.sources.some(source=>!session.cursors[source]?.done));session.lastRun={rounds:round,requests:used,stop,count:records.length};update(records,session);};
    async function permit(){await wait(taskSignal);taskSignal.throwIfAborted();if(used>=settings.requests){stop='达到采集请求上限';return false;}used++;session.runRequests=used;update(records,session);return true;}
    function add(incoming){const merged=R.merge(records,incoming);records=merged.slice(0,Math.max(records.length,settings.maximum));session.overflow=R.merge(session.overflow||[],merged.slice(records.length)).filter(r=>!records.some(prior=>prior.id===r.id)).slice(0,100);update(records,session);}
    try{
      if(session.overflow?.length)add(session.overflow);
      for(round=1;round<=settings.rounds;round++){
        if(records.length>=settings.target){stop='达到目标数量';break;}const before=records.length;let pending=false;
        let visits=0;
        while(queue.length&&records.length<settings.target&&visits<8&&used<settings.requests){pending=true;const entry=queue.shift();let url;try{url=new URL(entry.url);url.hash='';}catch{continue;}if(knownPages.has(url.href))continue;if(!await permit()){queue.unshift(entry);break;}knownPages.add(url.href);visits++;
          try{const page=await S.inspect(url.href,taskSignal,session.query);taskSignal.throwIfAborted();const r=R.normalize('网页采集',{title:page.title,abstract:page.description,url:page.url,type:'web',format:'网页',license:page.license||'',downloadUrl:''},records.length);if(r&&session.types.includes('web')){r.reason='来自已实际访问的公开网页；主题相关性请结合内容核对。';add([r]);}log('success',`[网页采集] 已验证 ${page.title}，发现 ${page.files.length} 个候选文件。`);for(const file of page.files){const type=session.types.includes(file.type)?file.type:file.format==='PDF'?session.types.find(t=>['paper','report','book'].includes(t)):null;if(!type)continue;const row=R.normalize('网页采集',{title:`${page.title} · ${file.label||file.format}`,abstract:page.description,url:file.url,downloadUrl:file.url,type,format:file.format},records.length);if(row){row.reason='从已访问页面发现的文件链接，下载前仍需验证内容。';add([row]);}}
            if(entry.depth<1)for(const link of page.links.slice(0,8))if(!knownPages.has(link.url)&&queue.length<80)queue.push({url:link.url,depth:entry.depth+1});
          }catch(error){taskSignal.throwIfAborted();session.failures=(session.failures||0)+1;log('warn',`[网页采集] ${url.hostname} 未验证通过：${error.message}`);}
        }
        for(const source of session.sources){
          if(records.length>=settings.target)break;const state=Object.hasOwn(session.cursors,source)?session.cursors[source]:(session.cursors[source]={page:1,cursor:'*',done:false,errors:0});if(state.done||state.suspended)continue;pending=true;if(!await permit())break;
          const query=session.queries?.[session.queryIndex||0]||session.query;
          try{log('info',`[${source}] 第 ${state.page} 页，查询 ${query}`);const result=await R.searchPage(source,query,session.year,taskSignal,session.types,state);taskSignal.throwIfAborted();add(result.records);session.cursors[source]={...result.next,errors:0,total:result.total};log('success',`[${source}] 本页 ${result.records.length} 项，来源命中 ${result.total??'未知'} 项，去重后 ${records.length} 项。`);}catch(error){taskSignal.throwIfAborted();state.errors=(state.errors||0)+1;session.failures=(session.failures||0)+1;log('warn',`[${source}] 第 ${state.page} 页失败，游标保留：${error.message}`);if(state.errors>=2)state.suspended=true;}
        }
        if(used>=settings.requests){stop='达到采集请求上限';break;}if(records.length>=settings.target){stop='达到目标数量';break;}
        if(records.length===before)stagnant++;else stagnant=0;
        if((!pending||stagnant>=2||session.sources.every(source=>session.cursors[source]?.done))&&(session.queryIndex||0)+1<(session.queries?.length||0)){session.queryIndex=(session.queryIndex||0)+1;session.cursors=Object.create(null);stagnant=0;log('info','切换模型建议的扩展关键词：'+session.queries[session.queryIndex]);continue;}
        if(!pending){stop='来源已耗尽或失败来源暂时停用';break;}if(stagnant>=2){stop='连续两轮没有新增资料';break;}stop='达到迭代轮次上限';
      }
      if(settings.resolve&&await S?.ready){for(const r of records){if(r.acquisition?.status==='verified')continue;if(used>=settings.requests){stop+='；文件查找达到请求上限';break;}if(!await permit())break;try{const result=await S.resolve(r,taskSignal);taskSignal.throwIfAborted();r.downloadUrl=result.url;r.available=true;r.format=result.format;r.size=result.size||r.size;r.acquisition={status:'verified',discovery:result.discovery||result.reason||'二次文件查找',checkedAt:new Date().toISOString()};log('success',`[二次检索] 已验证文件：${r.title}`);update(records,session);}catch(error){taskSignal.throwIfAborted();r.acquisition={status:error.code||'not_found',message:error.message,checkedAt:new Date().toISOString()};log('warn',`[二次检索] ${r.title}：${error.message}`);}}}
    }catch(error){if(signal.aborted){stop='用户已停止，保留已完成资料与分页位置';throw error;}if(!timedOut)throw error;stop='达到运行时间上限，保留已完成资料';}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);round=Math.min(round,settings.rounds);report();}
    return {records,session,stop};
  }
  window.DreamscapeCollection={limits,collect};
})();
