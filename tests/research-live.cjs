'use strict';
// Opt-in real network verification. No request mocks and no model/API credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const {createServer}=require('../server/research-service.cjs');
(async()=>{
  const dir=path.resolve(process.env.LIVE_REPORT_DIR||'test-results');fs.mkdirSync(dir,{recursive:true});
  const report={testedAt:new Date().toISOString(),mode:'real network; no mocks; no credentials',checks:[],limitations:[]};let browser;
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json','X-Research-Client':'1'};
  async function post(action,data){const response=await fetch(base+'/api/research/'+action,{method:'POST',headers,body:JSON.stringify(data),signal:AbortSignal.timeout(action==='download'?240000:60000)});if(!response.ok)throw new Error((await response.json()).error||String(response.status));return response;}
  async function check(name,fn){const started=Date.now();try{const data=await fn();report.checks.push({name,passed:true,durationMs:Date.now()-started,...data});console.log('PASS',name);}catch(e){report.checks.push({name,passed:false,error:e.message,durationMs:Date.now()-started});console.log('FAIL',name,e.message);}}
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/research.html');await page.waitForFunction(()=>DreamscapeResearchService.isAvailable());
    let record;
    await check('Europe PMC real search through the browser and collector',async()=>{
      const records=await page.evaluate(()=>DreamscapeResearch.search('Europe PMC','malaria AND OPEN_ACCESS:Y',0,undefined,['paper']));assert.ok(records.length>0);record=records[0];return {count:records.length,title:record.title,sourceURL:record.url};
    });
    if(record)await check('Europe PMC browser button discovers, verifies and saves real full text',async()=>{
      // Remove the initial direct link to exercise secondary discovery from its actual source record.
      const saved={...record,downloadUrl:'',available:false,origins:record.origins.map(o=>({...o,downloadUrl:''}))};
      await page.evaluate(record=>localStorage.setItem('dreamscape_research_v1',JSON.stringify({version:1,records:[record],topic:'真实 API 下载验证'})),saved);await page.reload();await page.waitForFunction(()=>DreamscapeResearchService.isAvailable());
      const pending=page.waitForEvent('download',{timeout:60000});await page.getByRole('button',{name:`查找文件 ${record.title}`,exact:true}).click();const download=await pending,bytes=fs.readFileSync(await download.path());assert.ok(bytes.length>1000);assert.ok(bytes.subarray(0,5).toString()==='%PDF-'||bytes.toString().includes('<article'));
      const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('dreamscape_research_v1')).records[0]);assert.equal(result.acquisition.status,'verified');
      await page.getByRole('button',{name:record.title,exact:true}).click();await page.screenshot({path:path.join(dir,'research-live.png')});await page.getByRole('button',{name:'关闭资源详情'}).click().catch(()=>{});
      return {filename:download.suggestedFilename(),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fileURL:result.downloadUrl,format:result.format,discovery:result.acquisition.discovery};
    });
    await check('Zenodo real metadata, PDF verification and complete binary download',async()=>{
      const resolved=await (await post('resolve',{url:'https://zenodo.org/records/6834336',type:'report'})).json();assert.equal(resolved.verified,true);assert.equal(resolved.format,'PDF');const response=await post('download',{url:resolved.url,format:resolved.format});const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.length,resolved.sizeBytes);
      return {fileURL:resolved.url,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),discovery:resolved.discovery};
    });
    const archive=await (await post('resolve',{url:'https://archive.org/details/BigBuckBunny_328',type:'video'})).json();
    if(archive.verified)report.checks.push({name:'Internet Archive real metadata and media validation',passed:true,fileURL:archive.url,format:archive.format,externalOnly:archive.externalOnly});else report.limitations.push({source:'Internet Archive',message:archive.message,attempts:archive.attempts});
  }catch(error){report.limitations.push({message:error.message});}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(dir,'research-live.json'),JSON.stringify(report,null,2));console.log('Report:',path.join(dir,'research-live.json'));if(report.checks.length<3||report.checks.some(c=>!c.passed))process.exitCode=1;}
})();
