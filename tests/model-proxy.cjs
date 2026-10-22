'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {PassThrough}=require('node:stream');const {EventEmitter}=require('node:events');
const {createServer}=require('../server/research-service.cjs');
test('GLM relay validates origins and endpoints, forwards streaming and HTTP errors, and excludes secrets from local errors',async()=>{
 const calls=[];let fail=false;
 const request=(url,options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=body=>{calls.push({url,options,body:JSON.parse(body)});queueMicrotask(()=>{if(fail){req.emit('error',new Error('upstream dummy-test-key'));return;}const stream=new PassThrough();stream.statusCode=options.headers.Authorization==='Bearer invalid'?401:200;stream.headers={'content-type':stream.statusCode===401?'application/json':'text/event-stream'};callback(stream);stream.end(stream.statusCode===401?'{}':'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');});};return req;};
 const server=createServer({modelRequest:request});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const headers={'Content-Type':'application/json','X-Dreamscape-Client':'1',Authorization:'Bearer dummy-test-key',Origin:base};const body=JSON.stringify({model:'glm-5.3-flash',messages:[{role:'user',content:'hello'}],stream:true,reasoning_effort:'low'});
 const post=(path='/api/models/glm',extra={},data=body)=>fetch(base+path,{method:'POST',headers:{...headers,...extra},body:data});
 try{
  let r=await fetch(base+'/api/models/glm',{method:'OPTIONS',headers:{Origin:'https://z1641818653-blip.github.io','Access-Control-Request-Headers':'authorization,content-type,x-dreamscape-client'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://z1641818653-blip.github.io');
  assert.equal((await post(undefined,{Origin:'https://evil.test'})).status,403);assert.equal((await post('/api/models/glm?mode=https://evil.test')).status,400);assert.equal((await post(undefined,{'X-Dreamscape-Client':''})).status,400);assert.equal((await post(undefined,{},'{')).status,400);assert.equal((await post(undefined,{},JSON.stringify({model:'gpt-test',messages:[]}))).status,400);assert.equal(calls.length,0);
  r=await post();assert.equal(r.status,200);assert.match(await r.text(),/\[DONE\]/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(calls[0].url,'https://open.bigmodel.cn/api/paas/v4/chat/completions');assert.equal(calls[0].options.headers.Authorization,headers.Authorization);assert.equal(calls[0].body.reasoning_effort,'low');
  r=await post('/api/models/glm?mode=coding');await r.text();assert.match(calls[1].url,/\/coding\/paas/);
  r=await post(undefined,{Authorization:'Bearer invalid'});assert.equal(r.status,401);await r.text();
  fail=true;r=await post();assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/dummy-test-key/);
 }finally{await new Promise(r=>server.close(r));}
});

test('browser settings and shared client use the actual same-origin relay with normalized keys',async()=>{
 const {chromium}=require('playwright');let called=[];
 const request=(url,options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=body=>{called.push({url,headers:options.headers,body:JSON.parse(body)});queueMicrotask(()=>{const stream=new PassThrough();stream.statusCode=200;stream.headers={'content-type':'text/event-stream'};callback(stream);stream.end('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\ndata: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');});};return req;};
 const server=createServer({modelRequest:request});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;
 try{browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});const page=await browser.newPage();await page.goto(base+'/settings.html');await page.locator('[data-provider="glm"] summary.provider-head').click();await page.locator('#key-glm').fill(' Bearer dummy\u200b-test-key ');await page.locator('#effort-glm').selectOption('low');await page.locator('#mode-glm').selectOption('coding');await page.locator('[data-provider="glm"] [data-test]').click();await page.waitForFunction(()=>document.querySelector('[data-provider="glm"] [data-test-status]').textContent.includes('连接成功'));assert.equal(called.length,1);assert.match(called[0].url,/coding/);assert.equal(called[0].headers.Authorization,'Bearer dummy-test-key');assert.equal(called[0].body.stream,true);assert.equal(called[0].body.reasoning_effort,'low');
 await page.locator('#saveApiBtn').click();await page.goto(base+'/research.html');assert.equal(await page.evaluate(()=>DreamscapeAI.complete({provider:'glm',model:'glm-5.3',messages:[{role:'user',content:'hello'}]})),'OK');assert.equal(called.length,2);assert.match(called[1].url,/coding/);assert.equal(called[1].body.reasoning_effort,'low');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
test('GitHub Pages selects the trusted relay and key validation rejects non-ASCII before header construction',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const storage=new Map(),context={window:{},location:{hostname:'z1641818653-blip.github.io',pathname:'/AI-Dreamscape/chat.html'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../providers-config.js'),'utf8'),context);const config=context.window.DreamscapeConfig;
 assert.equal(config.getUrl('glm','glm-5.3'),'https://ai-dreamscape-research.onrender.com/api/models/glm');assert.match(config.getUrl('glm','glm-5.3',true,{apiMode:'coding'}),/\?mode=coding$/);
 assert.equal(config.providers.glm.authHeader(' Bearer dummy\u200b-key ').Authorization,'Bearer dummy-key');assert.throws(()=>config.providers.glm.authHeader('dummy中文'),/格式无效/);
});
