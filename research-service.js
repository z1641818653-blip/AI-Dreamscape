(function(){
  'use strict';
  let available=false;
  const endpoint=action=>new URL(`api/research/${action}`,location.href).href;
  const ready=fetch(endpoint('health'),{credentials:'omit',signal:AbortSignal.timeout(2500)}).then(async response=>{if(response.ok){const data=await response.json();available=data.service==='dreamscape-research'&&data.version===1;}return available;}).catch(()=>false);
  async function request(action,data,signal){
    if(!await ready)throw new Error('采集服务未连接，请使用采集服务启动本站');
    const response=await fetch(endpoint(action),{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Research-Client':'1'},body:JSON.stringify(data),signal});
    if(!response.ok){let data={};try{data=await response.json();}catch{}const error=new Error(data.error||`采集服务 HTTP ${response.status}`);error.code=data.code;throw error;}
    return response;
  }
  window.DreamscapeResearchService={ready,isAvailable:()=>available,async source(url,signal){return (await request('source',{url},signal)).json();},async resolve(resource,signal){const data={url:resource.url,downloadUrl:resource.downloadUrl,doi:resource.doi,type:resource.type,format:resource.format,origins:(resource.origins||[]).map(o=>({downloadUrl:o.downloadUrl}))};const result=await (await request('resolve',data,signal)).json();if(!result.url){const error=new Error(result.message||'未发现公开文件');error.code=result.status;throw error;}return result;},download(resource,signal){return request('download',{url:resource.downloadUrl,format:resource.format},signal);}};
})();
