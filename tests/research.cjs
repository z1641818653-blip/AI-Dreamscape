const assert=require('node:assert/strict');
const fs=require('node:fs');
module.exports=async function({browser,base,test}){
  const context=await browser.newContext();
  let page=await context.newPage(),modelRequests=[],sourceRequests=[],pdfBroken=false,sourceFailure=false,malformed=false,holdModel=false,releaseModel,archiveFiles=null,pendingModels=[];
  const crossref={message:{items:[{DOI:'10.test/shared',title:['Urban heat evidence'],abstract:'Urban heat remote sensing',published:{'date-parts':[[2024]]},URL:'https://doi.org/10.test/shared'}]}};
  const pmc={resultList:{result:[{doi:'10.test/shared',title:'Urban heat evidence',pubYear:'2024',source:'MED',id:'123',abstractText:'<p>Urban heat evidence abstract</p>',fullTextUrlList:{fullTextUrl:[{documentStyle:'pdf',availabilityCode:'OA',url:'https://files.example.test/paper.pdf'}]}}]}};
  const datacite={data:[{id:'10.test/data',attributes:{doi:'10.test/data',titles:[{title:'Urban temperature data'}],publicationYear:2023,url:'https://example.test/dataset',formats:['CSV'],contentUrl:['https://files.example.test/data.csv'],types:{resourceTypeGeneral:'Dataset'},descriptions:[{descriptionType:'Abstract',description:'Urban heat observations'}]}},{id:'10.test/image',attributes:{doi:'10.test/image',titles:[{title:'Unrelated dental clinic logo'}],publicationYear:2024,url:'https://example.test/unrelated-image',formats:['JPEG'],types:{resourceTypeGeneral:'Image'},descriptions:[{descriptionType:'Abstract',description:'Decorative brand asset with no relation to climate research'}]}}]};
  const custom={items:[{name:'Custom urban heat video',summary:'Video from a user-defined JSON source',published:2025,author:'Open course team',page:'https://custom.test/items/1',kind:'movie',format:'MP4'}]};
  await context.addInitScript(()=>{
    const config={};for(const provider of ['deepseek','openai','claude','gemini','qwen'])config[provider]={apiKey:btoa(encodeURIComponent('integration-test-key')),model:'integration-custom',customModels:['integration-custom']};localStorage.setItem('dp0',JSON.stringify(config));localStorage.setItem('dcp0','deepseek');
  });
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.url().startsWith(base)){return route.continue();}
    if(['api.deepseek.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','dashscope.aliyuncs.com'].includes(url.hostname)){
      const body=req.postDataJSON();modelRequests.push({url:req.url(),body,headers:req.headers()});
      if(holdModel)await new Promise(resolve=>{pendingModels.push(resolve);releaseModel=()=>pendingModels.splice(0).forEach(done=>done());});
      let payload;
      const last=body.messages?.at(-1)?.content||body.contents?.at(-1)?.parts?.[0]?.text||'{}';let input={};try{input=JSON.parse(last);}catch{}
      const system=body.messages?.[0]?.content||body.system_instruction?.parts?.[0]?.text||'';
      const sourceDraft={name:'Custom Video API',description:'User-defined public video API',homepage:'https://custom.test/',searchUrl:'https://api.custom.test/search?q={query}&page={page}',resultPath:'items',types:['video'],defaultType:'video',fields:{title:'name',abstract:'summary',year:'published',authors:'author',url:'page',downloadUrl:'',doi:'',type:'kind',format:'format',license:'',size:''},typeMap:{movie:'video'}};
      const content=malformed?'invalid model structure':JSON.stringify(system.includes('公开 JSON 检索接口配置助手')?sourceDraft:system.includes('学术资料介绍助手')?{overview:'这项资料介绍城市热岛的遥感证据，并整理检索元数据中可确认的研究主题。',points:['关注城市热环境','使用遥感相关资料'],limits:'当前介绍仅依据题名与摘要，具体方法和结论需阅读原文。'}:system.includes('资料检索结果审核员')?{reviews:input.candidates.map((r,i)=>({id:r.id,decision:/Unrelated dental/.test(r.title)?'reject':'keep',score:/Unrelated dental/.test(r.title)?5:96-i,reason:/Unrelated dental/.test(r.title)?'与城市热岛主题无关':'与城市热岛研究直接相关'}))}:input.candidates?{rankings:input.candidates.map((r,i)=>({id:r.id,score:96-i,reason:'Relevant to urban heat research'}))}:{query:'urban heat island',topic:'城市热岛',type:'all',year:2023,reply:'检索条件已解析'});
      if(url.hostname==='api.anthropic.com')payload={content:[{type:'text',text:content}]};else if(url.hostname==='generativelanguage.googleapis.com')payload={candidates:[{content:{parts:[{text:content}]}}]};else payload={choices:[{message:{content}}]};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}).catch(()=>{});
    }
    sourceRequests.push({url:req.url(),headers:req.headers()});
    if(url.hostname==='api.crossref.org')return route.fulfill({json:crossref});
    if(url.hostname==='www.ebi.ac.uk')return route.fulfill(sourceFailure?{status:503,body:'Service unavailable'}:{json:pmc});
    if(url.hostname==='api.datacite.org')return route.fulfill({json:datacite});
    if(url.hostname==='archive.org')return route.fulfill({json:url.pathname.startsWith('/metadata/')?{files:archiveFiles||[{name:'urban-heat.mp4',format:'MPEG4',size:'1048576',source:'original'},{name:'item_meta.xml',format:'Metadata',size:'100',source:'original'}]}:{response:{docs:[]}}});
    if(url.hostname==='api.custom.test')return route.fulfill({json:custom});
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
  await test('research: actual UI pipeline audits every candidate before display',async()=>{
    await query();assert.equal(await page.locator('#resourceBody tr').count(),2);assert.match(await page.locator('#resourceBody').innerText(),/模型通过/);assert.match(await page.locator('#resourceBody').innerText(),/2 个来源已合并/);assert.equal(await page.locator('.file-link').count(),2);assert.equal(await page.locator('#year').inputValue(),'2023');assert.equal(await page.locator('#rejectedCount').innerText(),'1');assert.doesNotMatch(await page.locator('#resourceBody').innerText(),/dental clinic/);await page.locator('#showRejected').check();assert.equal(await page.locator('#resourceBody tr').count(),3);assert.match(await page.locator('#resourceBody').innerText(),/审核过滤/);await page.locator('#showRejected').uncheck();
    assert.equal(sourceRequests.some(r=>r.headers.authorization||r.headers['x-api-key']||r.headers['x-goog-api-key']),false);
  });
  await test('research: multi-type registry exposes media types and dispatches compatible sources',async()=>{
    const value=await page.evaluate(()=>({types:Object.keys(DreamscapeResearch.resourceTypes),videoSources:Object.keys(DreamscapeResearch.sources).filter(source=>DreamscapeResearch.sourceSupports(source,['video'])),archiveUrl:DreamscapeResearch.requestURL('Internet Archive','urban heat',2024,['video','audio'])}));
    assert.ok(value.types.includes('video'));assert.ok(value.types.includes('software'));assert.deepEqual(value.videoSources.sort(),['DataCite','Internet Archive']);assert.match(value.archiveUrl,/advancedsearch/);assert.match(new URL(value.archiveUrl).searchParams.get('q'),/mediatype:\(movies OR audio\)/);
  });
  await test('research: single PDF validation and real batch ZIP payloads',async()=>{
    let pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Urban heat evidence',exact:true}).click();const download=await pending;assert.ok(fs.readFileSync(await download.path()).subarray(0,5).toString()==='%PDF-');
    await page.locator('#selectAll').check();pending=page.waitForEvent('download');await page.locator('#batchBtn').click();const zip=fs.readFileSync(await (await pending).path());assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt16LE(zip.length-12),2);assert.ok(zip.includes(Buffer.from('%PDF-1.4')));assert.ok(zip.includes(Buffer.from('temperature,time')));
  });
  await test('research: secondary Archive discovery selects a real media file',async()=>{
    const result=await page.evaluate(()=>DreamscapeDownload.resolveFile({title:'Archive video',type:'video',url:'https://archive.org/details/demo-item',downloadUrl:''},new AbortController().signal));assert.match(result.url,/archive\.org\/download\/demo-item\/urban-heat\.mp4$/);assert.equal(result.externalOnly,false);assert.equal(result.size,'1 MB');
  });
  await test('research: downloadable media derivatives outrank oversized originals',async()=>{
    archiveFiles=[{name:'original.mp4',format:'MPEG4',size:String(100*1024*1024),source:'original'},{name:'small.webm',format:'WebM',size:'1048576',source:'derivative'},{name:'private.mp4',size:'1000',source:'original',private:true}];
    try{const result=await page.evaluate(()=>DreamscapeDownload.resolveFile({type:'video',url:'https://archive.org/details/demo-item'}));assert.match(result.url,/small\.webm$/);assert.equal(result.externalOnly,false);
      archiveFiles=archiveFiles.slice(0,1);const large=await page.evaluate(()=>DreamscapeDownload.resolveFile({type:'video',url:'https://archive.org/details/demo-item'}));assert.equal(large.externalOnly,true);
    }finally{archiveFiles=null;}
  });
  await test('research: fetched media and ZIP entries retain their file extensions',async()=>{
    const result=await page.evaluate(async()=>{const file=await DreamscapeDownload.fetchFile({title:'Video',format:'MPEG4',downloadUrl:'https://files.example.test/video.mp4'});return {name:file.name,zip:Array.from(DreamscapeDownload.zip([file])),audio:DreamscapeDownload.filename('Audio','MP3'),book:DreamscapeDownload.filename('Book','EPUB'),image:DreamscapeDownload.filename('Image','JPEG'),compound:DreamscapeDownload.filename('Data','unknown','https://files.example.test/data.tar.gz?download=1')};});
    assert.equal(result.name,'Video.mp4');assert.ok(Buffer.from(result.zip).includes(Buffer.from('01-Video.mp4')));assert.equal(result.audio,'Audio.mp3');assert.equal(result.book,'Book.epub');assert.equal(result.image,'Image.jpg');assert.equal(result.compound,'Data.tar.gz');
  });
  await test('research: HTML responses fail downloads and preserve actual file link',async()=>{
    pdfBroken=true;await page.getByRole('button',{name:'再下载 Urban heat evidence',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.download-hint').textContent.includes('地址返回网页'));assert.match(await page.locator('#logList').innerText(),/地址返回网页/);assert.equal(await page.getByRole('button',{name:'直接打开 Urban heat evidence',exact:true}).count(),1);assert.equal(await page.locator('.file-link').count(),2);pdfBroken=false;
  });
  await test('research: per-resource AI overview uses metadata and persists',async()=>{
    await page.getByRole('button',{name:'AI 总结 Urban heat evidence',exact:true}).click();await page.waitForFunction(()=>document.getElementById('summaryContent').textContent.includes('这项资料介绍城市热岛'));assert.match(await page.locator('#summaryContent').innerText(),/具体方法和结论需阅读原文/);const request=modelRequests.at(-1);assert.match(JSON.stringify(request.body),/学术资料介绍助手/);assert.doesNotMatch(JSON.stringify(request.body),/integration-test-key/);await page.getByRole('button',{name:'关闭 AI 资料介绍'}).click();assert.equal(await page.getByRole('button',{name:'AI 总结 Urban heat evidence',exact:true}).innerText(),'查看总结');
  });
  await test('research: switching summaries cancels the old task and allows retry',async()=>{
    await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('dreamscape_research_v1'));saved.records.forEach(r=>delete r.aiSummary);localStorage.setItem('dreamscape_research_v1',JSON.stringify(saved));const projectKey='dreamscape_research_projects_v1',projectData=JSON.parse(localStorage.getItem(projectKey)||'null');if(projectData){projectData.projects.find(p=>p.id===projectData.activeId).current=saved;localStorage.setItem(projectKey,JSON.stringify(projectData));}});await page.reload();
    const button=page.getByRole('button',{name:'AI 总结 Urban temperature data',exact:true});holdModel=true;
    try{await button.click();await page.waitForFunction(()=>document.querySelector('[data-summary].running'));
      await page.getByRole('button',{name:'关闭 AI 资料介绍'}).click();
      await page.getByRole('button',{name:'AI 总结 Urban heat evidence',exact:true}).click();
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[data-summary]')).find(b=>b.getAttribute('aria-label')==='AI 总结 Urban temperature data').disabled);
      assert.equal(await button.isEnabled(),true);
    }finally{holdModel=false;releaseModel?.();}
    await page.waitForFunction(()=>!document.querySelector('[data-summary].running'));
    await page.getByRole('button',{name:'关闭 AI 资料介绍'}).click();await button.click();await page.waitForFunction(()=>document.getElementById('summaryContent').textContent.includes('这项资料介绍城市热岛'));await page.getByRole('button',{name:'关闭 AI 资料介绍'}).click();
  });
  await test('research: matching explanations cannot add invented resources or URLs',async()=>{
    const result=await page.evaluate(()=>{const rows=[{id:'known',score:2,scoreKind:'source',url:'https://example.test/original'}];DreamscapeResearch.applyRanking(rows,{rankings:[{id:'invented',score:100,reason:'Fake',url:'https://evil.test'},{id:'known',score:120,reason:'Bounded score'},{id:'known',score:0,reason:'Duplicate'}]});return rows;});assert.equal(result.length,1);assert.equal(result[0].score,100);assert.equal(result[0].url,'https://example.test/original');assert.equal(result[0].reason,'Bounded score');
  });
  await test('research: partial source failure preserves successful results',async()=>{
    sourceFailure=true;await page.locator('#useAI').uncheck();await query();assert.equal(await page.locator('#resourceBody tr').count(),2);assert.match(await page.locator('#logList').innerText(),/Europe PMC.*503/);assert.doesNotMatch(await page.locator('#resourceBody').innerText(),/模型通过/);sourceFailure=false;
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
  await test('research: declarative sources reject private or credential-bearing endpoints',async()=>{
    const messages=await page.evaluate(()=>['https://127.0.0.1/search?q={query}','https://[::1]/search?q={query}','https://[fd00::1]/search?q={query}','https://api.example.test/search?api_key=secret&q={query}'].map(searchUrl=>{try{DreamscapeResearch.sanitizeDefinition({name:'Unsafe source',homepage:'https://example.test/',searchUrl,resultPath:'items',types:['other'],defaultType:'other',fields:{title:'title'}});return '';}catch(error){return error.message;}}));
    assert.match(messages[0],/公开 HTTPS/);assert.match(messages[1],/公开 HTTPS/);assert.match(messages[2],/公开 HTTPS/);assert.match(messages[3],/密钥|认证/);
  });
  await test('research: AI drafts, tests and persists a declarative custom source',async()=>{
    await page.setViewportSize({width:1280,height:900});await page.locator('#configBtn').click();await page.locator('#manageSourcesBtn').click();await page.locator('#sourceBrief').fill('Add the public custom video API described in its JSON documentation.');await page.locator('#sourceAiBtn').click();await page.waitForFunction(()=>document.getElementById('sourceManagerStatus').textContent.includes('模型草案已生成'));assert.equal(await page.locator('#sourceName').inputValue(),'Custom Video API');
    await page.locator('#sourceTestQuery').fill('urban heat');await page.locator('#sourceTestBtn').click();await page.waitForFunction(()=>document.getElementById('sourceManagerStatus').textContent.includes('测试通过'));assert.match(await page.locator('#sourcePreview').innerText(),/Custom urban heat video/);await page.locator('#sourceSaveBtn').click();assert.match(await page.locator('#sourceManagerStatus').innerText(),/已保存/);assert.equal(await page.evaluate(()=>Boolean(DreamscapeResearch.sources['Custom Video API']?.custom)),true);assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('dreamscape_research_sources_v1'))).sources.length,1);
    await page.getByRole('button',{name:'关闭自定义来源管理'}).click();await page.locator('#configBtn').click();assert.equal(await page.locator('[data-source="Custom Video API"]').isChecked(),true);for(const source of ['Crossref','Europe PMC','DataCite','Internet Archive'])await page.locator(`[data-source="${source}"]`).uncheck();await page.getByRole('button',{name:'关闭采集设置'}).click();await page.locator('#useAI').uncheck();await page.locator('#prompt').fill('urban heat video');await page.locator('#chatForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('crawlStatus').textContent==='已完成');assert.equal(await page.locator('#resourceBody tr').count(),1);assert.match(await page.locator('#resourceBody').innerText(),/Custom urban heat video/);
    await page.reload();assert.equal(await page.evaluate(()=>Boolean(DreamscapeResearch.sources['Custom Video API']?.custom)),true);assert.deepEqual(errors,[]);
  });
  await context.close();
};
