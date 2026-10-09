'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {LIMIT,ServiceError,publicURL,publicAddress,fetchPublic,extractCandidates,fileInfo,discoverResource,createServer}=require('../server/research-service.cjs');
function response(url,body,mime='application/json',headers={}){return {url,status:200,headers:{'content-type':mime,...headers},bytes:Buffer.from(body)};}
test('collector rejects private, encoded and mapped addresses before connecting',async()=>{
  for(const url of ['http://example.org/a','https://user:pass@example.org/a','https://127.0.0.1/a','https://2130706433/a','https://[::ffff:127.0.0.1]/a','https://[fd00::1]/a','https://localhost/a','https://example.org:8443/a'])assert.throws(()=>publicURL(url));
  for(const ip of ['10.0.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','2001:db8::1','::ffff:10.0.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('1.1.1.1'),true);await assert.rejects(fetchPublic('https://127.0.0.1/file'),/私网/);
});
test('HTML discovery handles relative links, citation metadata, media and JSON-LD without scripts',()=>{
  const rows=extractCandidates('<base href="https://attacker.test/"><meta name="citation_pdf_url" content="../paper.pdf"><a href="javascript:alert(1)" download>bad</a><a href="https://127.0.0.1/file.pdf">private</a><script type="application/ld+json">{"encoding":{"contentUrl":"/files/data.csv"}}</script><video><source src="/movie.mp4"></video>','https://public.test/articles/1','paper');
  assert.equal(rows[0].url,'https://public.test/paper.pdf');assert.ok(rows.some(r=>r.url==='https://public.test/files/data.csv'));assert.ok(rows.some(r=>r.url==='https://public.test/movie.mp4'));assert.equal(rows.some(r=>/127\.0\.0\.1|javascript:|attacker/.test(r.url)),false);
});
test('file verification rejects HTML, corrupt PDFs and empty responses',()=>{
  assert.throws(()=>fileInfo(response('https://public.test/paper.pdf','<html>login</html>','text/html'),'pdf'),/网页/);
  assert.throws(()=>fileInfo(response('https://public.test/paper.pdf','bad','application/pdf'),'pdf'),/PDF/);
  assert.throws(()=>fileInfo(response('https://public.test/file','','text/plain')),/为空/);
  const info=fileInfo(response('https://public.test/file','%PDF-1.4','application/octet-stream',{'content-range':`bytes 0-7/${LIMIT+1}`,'content-length':'8'}));assert.equal(info.format,'PDF');assert.equal(info.externalOnly,true);
});
test('Archive prefers compatible small derivatives and verifies the actual response',async()=>{
  const seen=[];const fetcher=async(url,options)=>{seen.push(url);if(url.includes('/metadata/'))return response(url,JSON.stringify({files:[{name:'huge.mp4',size:LIMIT+1,source:'original'},{name:'small.webm',size:1000,source:'derivative'},{name:'private.mp4',size:10,private:true}]}));assert.equal(options.probe,true);return response(url,'webm-file','video/webm',{'content-length':'1000'});};
  const info=await discoverResource({url:'https://archive.org/details/test',type:'video'},{fetcher});assert.match(info.url,/small.webm$/);assert.equal(info.verified,true);assert.equal(seen.length,2);
});
test('Europe PMC falls back from restricted PDFs to explicitly open full-text XML',async()=>{
  const fetcher=async url=>{if(url.includes('/search?'))return response(url,JSON.stringify({resultList:{result:[{isOpenAccess:'Y',pmcid:'PMC123',fullTextUrlList:{fullTextUrl:[{availabilityCode:'F',documentStyle:'pdf',url:'https://public.test/paper.pdf'}]}}]}}));if(url.endsWith('.pdf'))throw new ServiceError('来源限制访问','restricted');return response(url,'<?xml version="1.0"?><article/>','application/xml');};
  const info=await discoverResource({url:'https://europepmc.org/article/MED/123',type:'paper'},{fetcher});assert.equal(info.format,'XML');assert.equal(info.verified,true);assert.equal(info.attempts[0].code,'restricted');
});
test('generic discovery recovers stale direct links and preserves restricted status',async()=>{
  const fetcher=async url=>url.endsWith('/article')?response(url,'<meta name="citation_pdf_url" content="/real.pdf">','text/html'):url.endsWith('real.pdf')?response(url,'%PDF-1.4','application/pdf'):response(url,'<html>expired</html>','text/html');
  const info=await discoverResource({url:'https://public.test/article',downloadUrl:'https://public.test/expired',type:'paper'},{fetcher});assert.equal(info.url,'https://public.test/real.pdf');assert.equal(info.attempts[0].code,'not_file');
  const denied=await discoverResource({url:'https://public.test/article',type:'paper'},{fetcher:async()=>{throw new ServiceError('来源需要登录','needs_login');}});assert.equal(denied.status,'needs_login');
});
test('Zenodo chooses a compatible attachment instead of a webpage or thumbnail',async()=>{
  const fetcher=async url=>url.includes('/api/records/')?response(url,JSON.stringify({files:[{key:'preview.html',size:10,links:{self:'https://public.test/preview.html'}},{key:'report.pdf',size:100,links:{content:'https://public.test/report.pdf'}}]})):response(url,'%PDF-1.4','application/pdf');
  const info=await discoverResource({url:'https://zenodo.org/records/123',type:'report'},{fetcher});assert.equal(info.url,'https://public.test/report.pdf');
});
test('streamed downloads preserve bytes and reject interrupted transfers',async()=>{
  const meta=response('https://public.test/paper.pdf','','application/pdf');
  const fetcher=async(url,options)=>{options.onChunk(Buffer.from('%PDF-1.4\n'),meta);if(url.endsWith('/broken'))throw new Error('Connection interrupted');options.onChunk(Buffer.from('final bytes'),meta);return meta;};
  const server=createServer({fetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const download=url=>fetch(base+'/api/research/download',{method:'POST',headers:{'Content-Type':'application/json','X-Research-Client':'1'},body:JSON.stringify({url,format:'PDF'})});
  try{const result=await download('https://public.test/ok');assert.equal(await result.text(),'%PDF-1.4\nfinal bytes');await assert.rejects(async()=>{const result=await download('https://public.test/broken');await result.arrayBuffer();});}finally{await new Promise(resolve=>server.close(resolve));}
});
test('same-origin API guards and browser discovery, download, ZIP and stale-link recovery',async()=>{
  const seen=[],fetcher=async(url,options)=>{publicURL(url);seen.push(url);if(url==='https://public.test/article')return response(url,'<meta name="citation_pdf_url" content="/paper.pdf">','text/html');if(url==='https://public.test/stale')return response(url,'<html>expired</html>','text/html');if(url==='https://public.test/paper.pdf')return response(url,'%PDF-1.4\nreal-fixture','application/pdf',{'content-length':'21'});throw new ServiceError('未找到文件','not_found');};
  const server=createServer({fetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    const headers={'Content-Type':'application/json','X-Research-Client':'1'};
    assert.equal((await fetch(base+'/api/research/download',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/research/download',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
    assert.equal((await fetch(base+'/server/research-service.cjs')).status,404);assert.equal((await fetch(base+'/package.json')).status,404);
    assert.equal((await fetch(base+'/api/research/download',{method:'POST',headers,body:JSON.stringify({url:'https://127.0.0.1/private'})})).status,422);
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/research.html');await page.waitForFunction(()=>DreamscapeResearchService.isAvailable());
    await page.evaluate(()=>{const record={id:'test:paper',title:'Public attachment',source:'Crossref',type:'paper',url:'https://public.test/article',downloadUrl:'',available:false,format:'论文',origins:[{source:'Crossref',url:'https://public.test/article',downloadUrl:''}]};localStorage.setItem('dreamscape_research_v1',JSON.stringify({version:1,records:[record],topic:'test'}));});await page.reload();await page.waitForFunction(()=>DreamscapeResearchService.isAvailable());
    let pending=page.waitForEvent('download');await page.getByRole('button',{name:'查找文件 Public attachment',exact:true}).click();const file=await pending;assert.match(file.suggestedFilename(),/\.pdf$/);assert.ok(require('fs').readFileSync(await file.path()).subarray(0,5).toString()==='%PDF-');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dreamscape_research_v1')).records[0].acquisition.status),'verified');
    await page.locator('#selectAll').check();pending=page.waitForEvent('download');await page.locator('#batchBtn').click();const zip=await pending;assert.ok(require('fs').readFileSync(await zip.path()).includes(Buffer.from('%PDF-')));
    await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('dreamscape_research_v1'));saved.records[0].downloadUrl='https://public.test/stale';saved.records[0].available=true;localStorage.setItem('dreamscape_research_v1',JSON.stringify(saved));});await page.reload();await page.waitForFunction(()=>DreamscapeResearchService.isAvailable());pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Public attachment',exact:true}).click();await pending;assert.match(await page.locator('#logList').innerText(),/查找备用文件/);assert.deepEqual(errors,[]);assert.ok(seen.length>5);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
