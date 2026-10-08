const assert=require('node:assert/strict');
const fs=require('node:fs');
module.exports=async function({browser,base,test}){
  const context=await browser.newContext();
  let page=await context.newPage(),modelRequests=[],sourceRequests=[],pdfBroken=false,sourceFailure=false,malformed=false,holdModel=false,releaseModel;
  const crossref={message:{items:[{DOI:'10.test/shared',title:['Urban heat evidence'],abstract:'Urban heat remote sensing',published:{'date-parts':[[2024]]},URL:'https://doi.org/10.test/shared'}]}};
  const pmc={resultList:{result:[{doi:'10.test/shared',title:'Urban heat evidence',pubYear:'2024',source:'MED',id:'123',abstractText:'<p>Urban heat evidence abstract</p>',fullTextUrlList:{fullTextUrl:[{documentStyle:'pdf',availabilityCode:'OA',url:'https://files.example.test/paper.pdf'}]}}]}};
  const datacite={data:[{id:'10.test/data',attributes:{doi:'10.test/data',titles:[{title:'Urban temperature data'}],publicationYear:2023,url:'https://example.test/dataset',formats:['CSV'],contentUrl:['https://files.example.test/data.csv'],types:{resourceTypeGeneral:'Dataset'},descriptions:[{descriptionType:'Abstract',description:'Urban heat observations'}]}}]};
  await context.addInitScript(()=>{
    const config={};for(const provider of ['deepseek','openai','claude','gemini','qwen'])config[provider]={apiKey:btoa(encodeURIComponent('integration-test-key')),model:'integration-custom',customModels:['integration-custom']};localStorage.setItem('dp0',JSON.stringify(config));localStorage.setItem('dcp0','deepseek');
  });
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.url().startsWith(base)){return route.continue();}
    if(['api.deepseek.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','dashscope.aliyuncs.com'].includes(url.hostname)){
      const body=req.postDataJSON();modelRequests.push({url:req.url(),body,headers:req.headers()});
      if(holdModel)await new Promise(resolve=>releaseModel=resolve);
      let payload;
      const last=body.messages?.at(-1)?.content||body.contents?.at(-1)?.parts?.[0]?.text||'{}';let input={};try{input=JSON.parse(last);}catch{}
      const content=malformed?'invalid model structure':JSON.stringify(input.candidates?{rankings:input.candidates.map((r,i)=>({id:r.id,score:96-i,reason:'Relevant to urban heat research'}))}:{query:'urban heat island',topic:'城市热岛',type:'all',year:2023,reply:'检索条件已解析'});
      if(url.hostname==='api.anthropic.com')payload={content:[{type:'text',text:content}]};else if(url.hostname==='generativelanguage.googleapis.com')payload={candidates:[{content:{parts:[{text:content}]}}]};else payload={choices:[{message:{content}}]};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}).catch(()=>{});
    }
    sourceRequests.push({url:req.url(),headers:req.headers()});
    if(url.hostname==='api.crossref.org')return route.fulfill({json:crossref});
    if(url.hostname==='www.ebi.ac.uk')return route.fulfill(sourceFailure?{status:503,body:'Service unavailable'}:{json:pmc});
    if(url.hostname==='api.datacite.org')return route.fulfill({json:datacite});
    if(url.hostname==='files.example.test')return route.fulfill({status:200,contentType:url.pathname.endsWith('.pdf')?(pdfBroken?'text/html':'application/pdf'):'text/csv',body:url.pathname.endsWith('.pdf')?(pdfBroken?'<html>Login required</html>':'%PDF-1.4\nfixture'): 'temperature,time\n30,2024\n'});
    return route.abort();
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function go(){await page.goto(base+'/research.html');}
  async function query(){await page.locator('#prompt').fill('城市热岛文献与数据，2023年以后');await page.locator('#chatForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('crawlStatus').textContent==='已完成');}
  await test('research: shared custom models and all five request adapters',async()=>{
    await go();assert.equal(await page.getByLabel('模型',{exact:true}).inputValue(),'integration-custom');
    for(const provider of ['deepseek','openai','claude','gemini','qwen']){
      const output=await page.evaluate(async provider=>DreamscapeAI.complete({provider,model:'integration-custom',messages:[{role:'system',content:'Parse query'},{role:'user',content:'{}'}]}),provider);
      assert.ok(JSON.parse(output).query);const request=modelRequests.at(-1);assert.equal(request.headers.authorization||request.headers['x-api-key']||request.headers['x-goog-api-key'],provider==='claude'||provider==='gemini'?'integration-test-key':'Bearer integration-test-key');
    }
  });
  await test('research: actual UI pipeline parses, retrieves, DOI-merges and ranks',async()=>{
    await query();assert.equal(await page.locator('#resourceBody tr').count(),2);assert.match(await page.locator('#resourceBody').innerText(),/模型匹配/);assert.match(await page.locator('#resourceBody').innerText(),/2 个来源已合并/);assert.equal(await page.locator('.file-link').count(),2);assert.equal(await page.locator('#year').inputValue(),'2023');
    assert.equal(sourceRequests.some(r=>r.headers.authorization||r.headers['x-api-key']||r.headers['x-goog-api-key']),false);
  });
  await test('research: single PDF validation and real batch ZIP payloads',async()=>{
    let pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Urban heat evidence',exact:true}).click();const download=await pending;assert.ok(fs.readFileSync(await download.path()).subarray(0,5).toString()==='%PDF-');
    await page.locator('#selectAll').check();pending=page.waitForEvent('download');await page.locator('#batchBtn').click();const zip=fs.readFileSync(await (await pending).path());assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt16LE(zip.length-12),2);assert.ok(zip.includes(Buffer.from('%PDF-1.4')));assert.ok(zip.includes(Buffer.from('temperature,time')));
  });
  await test('research: HTML responses fail downloads and preserve actual file link',async()=>{
    pdfBroken=true;await page.getByRole('button',{name:'下载 Urban heat evidence',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.download-hint').textContent==='下载失败');assert.match(await page.locator('#logList').innerText(),/地址返回网页/);assert.equal(await page.locator('.file-link').count(),2);pdfBroken=false;
  });
  await test('research: matching explanations cannot add invented resources or URLs',async()=>{
    const result=await page.evaluate(()=>{const rows=[{id:'known',score:2,scoreKind:'source',url:'https://example.test/original'}];DreamscapeResearch.applyRanking(rows,{rankings:[{id:'invented',score:100,reason:'Fake',url:'https://evil.test'},{id:'known',score:120,reason:'Bounded score'},{id:'known',score:0,reason:'Duplicate'}]});return rows;});assert.equal(result.length,1);assert.equal(result[0].score,100);assert.equal(result[0].url,'https://example.test/original');assert.equal(result[0].reason,'Bounded score');
  });
  await test('research: partial source failure preserves successful results',async()=>{
    sourceFailure=true;await page.locator('#useAI').uncheck();await query();assert.equal(await page.locator('#resourceBody tr').count(),2);assert.match(await page.locator('#logList').innerText(),/Europe PMC.*503/);assert.doesNotMatch(await page.locator('#resourceBody').innerText(),/模型匹配/);sourceFailure=false;
  });
  await test('research: stored results and key-free backups never duplicate credentials',async()=>{
    const backup=await page.evaluate(()=>({saved:localStorage.getItem('dreamscape_research_v1'),backup:DreamscapeBackup.snapshot()}));assert.equal(backup.saved.includes('integration-test-key'),false);assert.ok(backup.backup.dreamscape_research_v1);assert.equal(JSON.stringify(backup.backup).includes('integration-test-key'),false);await page.reload();assert.equal(await page.locator('#resourceBody tr').count(),2);
  });
  await test('research: malformed model output leaves prior valid results intact',async()=>{
    malformed=true;await page.locator('#useAI').check();await page.locator('#prompt').fill('New topic');await page.locator('#chatForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('crawlStatus').textContent==='检索失败');assert.equal(await page.locator('#resourceBody tr').count(),2);assert.match(await page.locator('#logList').innerText(),/结构化/);malformed=false;
  });
  await test('research: stop cancels in-flight model and prevents late source requests',async()=>{
    holdModel=true;const before=sourceRequests.length;await page.locator('#prompt').fill('New research');await page.locator('#chatForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('stopModel').hidden);await page.locator('#stopModel').click();releaseModel?.();holdModel=false;await page.waitForFunction(()=>document.getElementById('crawlStatus').textContent==='已停止');assert.equal(sourceRequests.length,before);
  });
  await test('research: standalone demonstration never calls external APIs',async()=>{
    const before=sourceRequests.length+modelRequests.length;await page.locator('#modeSelect').selectOption('demo');assert.equal(await page.locator('#resourceBody tr').count(),6);await page.getByRole('button',{name:'只看数据集',exact:true}).click();assert.equal(await page.locator('#resourceBody tr').count(),2);assert.equal(sourceRequests.length+modelRequests.length,before);await page.locator('#modeSelect').selectOption('live');assert.equal(await page.locator('#resourceBody tr').count(),2);
  });
  await test('research: resource choice retains focus and narrow layouts do not overflow',async()=>{
    await page.locator('#resourceBody [data-select]').first().check();assert.equal(await page.evaluate(()=>document.activeElement.matches('[data-select]')),true);for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}assert.deepEqual(errors,[]);
  });
  await context.close();
};
