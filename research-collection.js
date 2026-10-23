(function(){
  'use strict';
  const clamp=(value,fallback,min,max)=>Math.min(max,Math.max(min,Math.floor(Number(value)||fallback)));
  function limits(value={}){const maximum=clamp(value.maximum,200,1,200);return {target:clamp(value.target,60,1,maximum),maximum,rounds:clamp(value.rounds,5,1,20),requests:clamp(value.requests,50,1,200),minutes:clamp(value.minutes,5,1,15),discover:Boolean(value.discover),resolve:Boolean(value.resolve)};}
  async function collect({session,records,signal,wait=async()=>{},update=()=>{},log=()=>{},review,concurrency=2}){
    const R=DreamscapeResearch,S=window.DreamscapeResearchService,settings=limits(session.limits),controller=new AbortController();
    const abort=()=>controller.abort(signal.reason);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    let timedOut=false,used=0,round=0,stagnant=0,stop='来源已耗尽';
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},settings.minutes*60000),taskSignal=controller.signal;
    const knownPages=new Set(session.visited||[]),queue=[...(session.queue||[])];
    const rejected=new Map([...(session.rejectedRecords||[]),...records.filter(r=>r.reviewStatus==='rejected')].map(r=>[r.id,r]));
    if(review)records=records.filter(r=>r.reviewStatus!=='rejected');
    session.queryCursors=session.queryCursors||Object.create(null);session.lastRun=null;
    for(const states of [session.cursors,...Object.values(session.queryCursors)])for(const state of Object.values(states||{}))state.suspended=false;
    const count=()=>review?records.filter(r=>r.reviewStatus==='approved').length:records.length;
    const goalReached=()=>{const queries=session.queries?.length?session.queries:[session.query],covered=queries.filter((q,index)=>Object.values(index===(session.queryIndex||0)?session.cursors:session.queryCursors[index]||{}).some(p=>p.page>1||p.done)).length;return count()>=settings.target&&covered>=Math.min(2,queries.length);};
    const display=()=>review?[...records,...rejected.values()].slice(0,200):records;
    const publish=()=>update(display(),session);
    const totalSeen=()=>records.length+rejected.size;
    function nextQuery(){
      const queries=session.queries?.length?session.queries:[session.query],current=session.queryIndex||0;
      session.queryCursors[current]=session.cursors;
      for(let offset=1;offset<=queries.length;offset++){
        const index=(current+offset)%queries.length,states=session.queryCursors[index];
        if(index!==current&&(!states||session.sources.some(source=>!states[source]?.done&&!states[source]?.suspended))){session.queryIndex=index;session.cursors=states||Object.create(null);log('info','扩展检索关键词：'+queries[index]);return true;}
      }
      return false;
    }
    function report(){session.queryCursors[session.queryIndex||0]=session.cursors;session.visited=[...knownPages];session.queue=queue;session.rejectedRecords=[...rejected.values()].slice(-200);session.requests=(session.requests||0)+used;session.runRequests=0;
      const queries=session.queries?.length?session.queries:[session.query];session.canContinue=Boolean(session.overflow?.length||queue.length||queries.some((q,index)=>{const states=index===(session.queryIndex||0)?session.cursors:session.queryCursors[index];return !states||session.sources.some(source=>!states[source]?.done);}));
      session.lastRun={rounds:Math.min(round,settings.rounds),requests:used,stop,count:count()};publish();}
    async function permit(){await wait(taskSignal);taskSignal.throwIfAborted();if(used>=settings.requests){stop='达到采集请求上限';return false;}used++;session.runRequests=used;publish();return true;}
    function add(incoming){
      const merged=R.merge(records,R.screenImages(incoming,session.request||session.query).filter(r=>!review||!rejected.has(r.id)));
      records=merged.slice(0,Math.max(records.length,settings.maximum));
      session.overflow=R.merge(session.overflow||[],merged.slice(records.length)).filter(r=>!records.some(prior=>prior.id===r.id)&&!rejected.has(r.id)).slice(0,100);publish();
    }
    async function audit(){if(!review)return;if(records.some(r=>!r.reviewStatus))await review(records,taskSignal);taskSignal.throwIfAborted();for(const r of records)if(r.reviewStatus==='rejected')rejected.set(r.id,r);records=records.filter(r=>r.reviewStatus!=='rejected');publish();}
    try{
      if(session.overflow?.length)add(session.overflow);
      for(round=1;round<=settings.rounds;round++){
        if(goalReached()){stop='达到目标数量';break;}
        const before=totalSeen();let pending=false,visits=0;
        while(queue.length&&!goalReached()&&visits<8&&used<settings.requests){
          pending=true;const entry=queue.shift();let url;try{url=new URL(entry.url);url.hash='';}catch{continue;}
          if(knownPages.has(url.href))continue;if(!await permit()){queue.unshift(entry);break;}visits++;
          try{
            const page=await S.inspect(url.href,taskSignal,session.query);taskSignal.throwIfAborted();knownPages.add(url.href);
            const r=R.normalize('网页采集',{title:page.title,abstract:page.description,url:page.url,type:'web',format:'网页',license:page.license||'',downloadUrl:''},records.length);
            if(r&&session.types.includes('web'))add([r]);
            for(const file of page.files){const type=session.types.includes(file.type)?file.type:file.format==='PDF'?session.types.find(t=>['paper','report','book'].includes(t)):null;if(!type)continue;const row=R.normalize('网页采集',{title:`${page.title} · ${file.label||file.format}`,abstract:page.description,url:file.url,downloadUrl:file.url,type,format:file.format},records.length);if(row)add([row]);}
            log('success',`[网页采集] 已验证 ${page.title}，发现 ${page.files.length} 个候选文件。`);
            if(entry.depth<1)for(const link of page.links.slice(0,8))if(!knownPages.has(link.url)&&queue.length<80)queue.push({url:link.url,depth:entry.depth+1});
          }catch(error){taskSignal.throwIfAborted();session.failures=(session.failures||0)+1;log('warn',`[网页采集] ${url.hostname} 未验证通过：${error.message}`);}
        }
        const available=session.sources.filter(source=>!session.cursors[source]?.done&&!session.cursors[source]?.suspended);
        pending=pending||available.length>0;
        const workers=Math.min(4,Math.max(1,Number(concurrency)||2));
        for(let offset=0;offset<available.length;offset+=workers){
          if(goalReached())break;
          await Promise.all(available.slice(offset,offset+workers).map(async source=>{
            const state=session.cursors[source]||(session.cursors[source]={page:1,cursor:'*',done:false,errors:0});if(!await permit())return;
            const query=session.queries?.[session.queryIndex||0]||session.query;
            try{log('info',`[${source}] 第 ${state.page} 页，查询 ${query}`);const result=await R.searchPage(source,query,session.year,taskSignal,session.types,state);taskSignal.throwIfAborted();add(result.records);session.cursors[source]={...result.next,errors:0,total:result.total};log('success',`[${source}] 收到 ${result.records.length} 项，当前通过 ${count()} 项。`);}
            catch(error){taskSignal.throwIfAborted();state.errors=(state.errors||0)+1;session.failures=(session.failures||0)+1;log('warn',`[${source}] 本页失败，游标保留：${error.message}`);if(state.errors>=2)state.suspended=true;}
          }));
        }
        await audit();
        // Rejected candidates free space and never count towards the requested target.
        if(used>=settings.requests){stop='达到采集请求上限';break;}if(goalReached()){stop='达到目标数量';break;}
        if(totalSeen()===before)stagnant++;else stagnant=0;
        if(nextQuery()){stagnant=0;continue;}
        if(!pending){stop='来源已耗尽或失败来源暂时停用';break;}if(stagnant>=2){stop='连续两轮没有新增资料';break;}
        if(review&&records.length>=settings.maximum){stop='待确认资料达到保留上限，请检查审核状态';break;}
        stop='达到迭代轮次上限';
      }
      if(settings.resolve&&await S?.ready){for(const r of records){if(r.acquisition?.status==='verified'||review&&r.reviewStatus!=='approved')continue;if(used>=settings.requests){stop+='；文件查找达到请求上限';break;}if(!await permit())break;try{const result=await S.resolve(r,taskSignal);taskSignal.throwIfAborted();Object.assign(r,{downloadUrl:result.url,available:true,format:result.format,size:result.size||r.size,acquisition:{status:'verified',discovery:result.discovery||result.reason||'二次文件查找',checkedAt:new Date().toISOString()}});publish();}catch(error){taskSignal.throwIfAborted();r.acquisition={status:error.code||'not_found',message:error.message};log('warn',`[二次检索] ${r.title}：${error.message}`);}}}
    }catch(error){if(signal.aborted){stop='用户已停止，保留已完成资料与分页位置';throw error;}if(!timedOut)throw error;stop='达到运行时间上限，保留已完成资料';}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);report();}
    return {records:display(),session,stop};
  }
  window.DreamscapeCollection={limits,collect};
})();
