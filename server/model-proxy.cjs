'use strict';
const https=require('node:https');
const ENDPOINTS={standard:'https://open.bigmodel.cn/api/paas/v4/chat/completions',coding:'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'};
function createModelProxy({origin='',request=https.request,maxActive=12,timeoutMs=120000}={}){
 let active=0;
 return async function handle(req,res,target){
  if(target.pathname!=='/api/models/glm')return false;
  const incoming=req.headers.origin,host=req.headers.host||'',local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  const own=origin||(local?`http://${host}`:'');
  const allowed=new Set([own,'https://z1641818653-blip.github.io'].filter(Boolean));
  const json=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message}}));};
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
  if(!own||(incoming&&!allowed.has(incoming))){json(403,'模型转发来源未获允许');return true;}
  if(incoming)res.setHeader('Access-Control-Allow-Origin',incoming);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Dreamscape-Client','Access-Control-Max-Age':'600'});res.end();return true;}
  if(req.method!=='POST'||req.headers['x-dreamscape-client']!=='1'||!String(req.headers['content-type']).startsWith('application/json')){json(400,'模型转发请求格式不正确');return true;}
  const auth=req.headers.authorization||'';
  if(!/^Bearer [\x21-\x7e]{1,4096}$/.test(auth)){json(401,'API Key 格式无效，请只粘贴 Key 本身');return true;}
  const mode=target.searchParams.get('mode')||'standard';
  if(!Object.hasOwn(ENDPOINTS,mode)){json(400,'接口类型无效');return true;}
  if(active>=maxActive){json(429,'模型转发繁忙，请稍后重试');return true;}
  active++;let upstream,timer;
  try{
   req.setTimeout(10000,()=>req.destroy());const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){json(413,'请求内容过大');return true;}chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{json(400,'请求 JSON 无效');return true;}
   if(!body||!/^glm-[a-zA-Z0-9.-]{1,80}$/.test(body.model)||!Array.isArray(body.messages)||!body.messages.length){json(400,'GLM 模型或消息无效');return true;}
   req.setTimeout(0);
   await new Promise(resolve=>{
    let complete=false;const finish=()=>{if(complete)return;complete=true;clearTimeout(timer);resolve();};
    const fail=()=>{if(!res.headersSent)json(502,'智谱连接失败或超时，请稍后重试');else res.destroy();finish();};
    upstream=request(ENDPOINTS[mode],{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth,Accept:'text/event-stream'}},response=>{
     res.writeHead(response.statusCode||502,{'Content-Type':response.headers['content-type']||'application/json','X-Accel-Buffering':'no'});res.flushHeaders();
     response.on('error',fail);response.on('aborted',fail);response.on('end',finish);response.pipe(res);
    });
    upstream.on('error',fail);res.on('close',()=>{upstream.destroy();finish();});
    timer=setTimeout(()=>{upstream.destroy();fail();},timeoutMs);upstream.end(JSON.stringify(body));
   });
  }catch{if(!res.headersSent&&!res.destroyed)json(502,'模型转发失败，请稍后重试');}
  finally{clearTimeout(timer);active--;}
  return true;
 };
}
module.exports={createModelProxy};
