const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const results = [];
let browser, server;
async function test(name, task) {
  try { await task(); results.push({ name, passed:true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed:false, error:error.message }); console.error('FAIL', name, error.message); }
}
function source(name) {
  let text = fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
  if (name === 'chat.html') text = text.replace('  load(function(){ init();', '  window.__chat={StreamModule,S,send,createC,switchC,compareSend}; load(function(){ init();');
  if (name === 'chatroom.html') text = text.replace('  init();\n})();', '  window.__room={renderMD,streamAI,state,newRoom,callSingleAI}; init();\n})();');
  if (name === 'assets/latexfix.js') text = text.replace('  init();\n})();', '  window.__latex={state,compile,sendAi}; init();\n})();');
  return text;
}
(async () => {
  await test('first-party JavaScript parses and local page resources exist', () => {
    for (const name of [...fs.readdirSync(root).filter(x => /\.(html|js)$/.test(x)), 'assets/latexfix.js', 'assets/room-view.js', 'assets/room-classic.js', 'assets/room-role-assist.js', 'assets/workbench-view.js']) {
      const text = source(name);
      const scripts = name.endsWith('.js') ? [text] : [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !m[1].includes('src=')).map(m => m[2]);
      scripts.forEach(s => new vm.Script(s, { filename:name }));
      if (name.endsWith('.html')) for (const [, link] of text.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
        if (link.startsWith('#') || /^\w+:/.test(link) || link.startsWith('//')) continue;
        assert.ok(fs.existsSync(path.join(root, link.split(/[?#]/)[0])), name + ': ' + link);
      }
    }
  });
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(source(name));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext();
  await context.addInitScript(() => window.__nativeResponse = Response);
  let page = await context.newPage();
  const pageErrors = [];
  let acceptRestore = false;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => (dialog.type() === 'beforeunload' || acceptRestore) ? dialog.accept() : dialog.dismiss());
  async function go(name) { await page.goto(base + '/' + name + '.html', { waitUntil:'networkidle' }); }
  for (const name of ['index', 'settings', 'chat', 'chatroom', 'workflow', 'latex', 'mdtest', 'research']) {
    await test(name + ': desktop/mobile startup without runtime errors or width overflow', async () => {
      pageErrors.length = 0;
      await page.setViewportSize({ width:1280, height:720 }); await go(name);
      assert.deepEqual(pageErrors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width:390, height:844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }
  await page.setViewportSize({ width:1280, height:720 });
  await go('settings');
  await test('revealed API keys never enter cache or key-free downloaded backup', async () => {
    await page.locator('#key-deepseek').fill('dummy-secret');
    await page.locator('[data-provider="deepseek"] [data-reveal]').click();
    await page.locator('#model-deepseek').selectOption('deepseek-v4-flash');
    await page.evaluate(() => DreamscapeStorage.persist());
    const downloading = page.waitForEvent('download');
    await page.locator('#exportDataBtn').evaluate(el => el.click());
    const downloaded = await downloading;
    const content = fs.readFileSync(await downloaded.path(), 'utf8');
    assert.equal(JSON.parse(content).includesApiKeys, false);
    assert.equal(content.includes('dummy-secret'), false);
  });
  await test('backup scrub removes historical sensitive fields but retains ordinary drafts', async () => {
    const value = await page.evaluate(() => {
      localStorage.setItem('dreamscape_page_cache_v1', JSON.stringify({ legacy:{ fields:{ 'key-openai':{type:'text',value:'dummy-old-secret'}, userInput:{type:'textarea',value:'ordinary draft'} } } }));
      return DreamscapeBackup.snapshot();
    });
    assert.equal(JSON.stringify(value).includes('dummy-old-secret'), false);
    assert.equal(JSON.stringify(value).includes('ordinary draft'), true);
  });
  await test('backup restore preserves existing key and validates conflict plan', async () => {
    const value = await page.evaluate(() => {
      localStorage.setItem('dp0', JSON.stringify({ deepseek:{apiKey:DreamscapeConfig.encode('current-secret'),model:'original'} }));
      localStorage.setItem('dc0', JSON.stringify([{id:'original',messages:[]}]));
      const prepared = DreamscapeBackup.plan({kind:'ai-dreamscape-browser-backup',schemaVersion:1,includesApiKeys:false,storage:{dp0:JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('unexpected-secret'),model:'deepseek-v4-flash'}}),dc0:JSON.stringify([{id:'incoming',messages:[]}])}});
      DreamscapeBackup.restore(prepared);
      return { key:DreamscapeConfig.getKey('deepseek'), conflicts:prepared.conflicts, id:JSON.parse(localStorage.getItem('dc0'))[0].id };
    });
    assert.equal(value.key, 'current-secret'); assert.equal(value.id, 'incoming'); assert.ok(value.conflicts.includes('dc0'));
  });
  await test('quota failure rolls back all previously changed backup entries', async () => {
    const value = await page.evaluate(() => {
      localStorage.setItem('dl0', 'old-left'); localStorage.setItem('dr0', 'old-right');
      const prepared = DreamscapeBackup.plan({kind:'ai-dreamscape-browser-backup',schemaVersion:1,storage:{dl0:'new-left',dr0:'new-right'}});
      const original = Storage.prototype.setItem; let failed = false, message = '';
      Storage.prototype.setItem = function(key, value) { if (key === 'dr0' && !failed) { failed = true; throw new DOMException('quota', 'QuotaExceededError'); } return original.call(this, key, value); };
      try { DreamscapeBackup.restore(prepared); } catch (error) { message = error.message; }
      finally { Storage.prototype.setItem = original; }
      return {left:localStorage.getItem('dl0'),right:localStorage.getItem('dr0'),message};
    });
    assert.equal(value.left, 'old-left'); assert.equal(value.right, 'old-right'); assert.match(value.message, /回滚/);
  });
  await test('invalid backup records are rejected before any write', async () => {
    const value = await page.evaluate(() => {
      let rejected = 0;
      for (const storage of [{unknown:'x'}, {dc0:'not JSON'}, {dc0:'[{}]'}, {dp0:'{"deepseek":null}'}]) {
        try { DreamscapeBackup.plan({kind:'ai-dreamscape-browser-backup',schemaVersion:1,storage}); } catch { rejected++; }
      }
      return rejected;
    });
    assert.equal(value, 4);
  });
  await page.evaluate(() => {
    localStorage.setItem('dreamscape_global_storage_v1', JSON.stringify({exitProtection:false}));
    localStorage.setItem('dreamscape_page_cache_v1', JSON.stringify({ '/other.html':{fields:{draft:{type:'textarea',value:'keep me'}},dirty:true} }));
  });
  await go('chat');
  await test('chat startup retains shared protection and unrelated drafts', async () => {
    const value = await page.evaluate(() => ({settings:JSON.parse(localStorage.getItem('dreamscape_global_storage_v1')),cache:localStorage.getItem('dreamscape_page_cache_v1')}));
    assert.equal(value.settings.exitProtection, false); assert.match(value.cache, /keep me/);
  });
  await test('chat does not overwrite keys changed after page load', async () => {
    await page.evaluate(() => localStorage.setItem('dp0', JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('changed-secret'),model:'deepseek-v4-flash'}})));
    await page.locator('#themeToggleBtn').evaluate(el => el.click());
    assert.equal(await page.evaluate(() => DreamscapeConfig.getKey('deepseek')), 'changed-secret');
  });
  await test('real storage event refreshes model selection in another tab', async () => {
    const other = await context.newPage(); await other.goto(base + '/settings.html');
    await other.evaluate(() => localStorage.setItem('dp0', JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('other-tab-secret'),model:'deepseek-v4-pro'}})));
    await page.waitForFunction(() => __chat.S.providers.deepseek.model === 'deepseek-v4-pro');
    assert.equal(await page.locator('#chatModelSelector select').last().inputValue(), 'deepseek-v4-pro');
    await other.close();
  });
  await test('browser syntax highlighting loads and native Response remains intact', async () => {
    assert.deepEqual(await page.evaluate(() => ({hljs:typeof hljs,response:Response === __nativeResponse,python:Boolean(hljs.getLanguage('python'))})), {hljs:'object',response:true,python:true});
  });
  await test('shared SSE reads UTF-8 split chunks, CRLF, compact data and unterminated tail', async () => {
    const value = await page.evaluate(async () => {
      const encoded = new TextEncoder().encode('data:'+JSON.stringify({choices:[{delta:{content:'中文'}}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{content:'tail'}}]}));
      const response = new Response(new ReadableStream({start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); }}));
      let text = ''; await DreamscapeRequest.readSSE(response, data => text += data.choices[0].delta.content); return text;
    });
    assert.equal(value, '中文tail');
  });
  await test('shared SSE stops at DONE without waiting for connection close', async () => {
    assert.equal(await page.evaluate(async () => {
      let cancelled = false;
      const response = new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));},cancel(){cancelled=true;}}));
      await DreamscapeRequest.readSSE(response, () => {}); return cancelled;
    }), true);
  });
  await test('multiline SSE and explicit API error events are handled', async () => {
    const value = await page.evaluate(async () => {
      let first, error = '';
      await DreamscapeRequest.readSSE(new Response('data: {\ndata: "value":42\ndata: }\n\n'), item => first=item.value);
      try { await DreamscapeRequest.readSSE(new Response('data: {"error":{"message":"test failure"}}'), () => {}); } catch (caught) {error=caught.message;}
      return {first,error};
    });
    assert.equal(value.first, 42); assert.equal(value.error, 'test failure');
  });
  await test('idle timeout aborts a stalled request and releases its timer', async () => {
    assert.match(await page.evaluate(async () => {
      try { await DreamscapeRequest.withTimeout(null, 20, signal => new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped','AbortError'))))); }
      catch (error) {return error.message;}
    }), /未收到新数据/);
  });
  await test('upstream cancellation is propagated', async () => {
    assert.equal(await page.evaluate(async () => {
      const controller = new AbortController(); controller.abort();
      return DreamscapeRequest.withTimeout(controller.signal, 1000, async signal => signal.aborted);
    }), true);
  });
  await test('workbench parses stream tails, JSON fallbacks and all provider formats', async () => {
    const value = await page.evaluate(async () => {
      const output = [];
      for (const provider of ['deepseek','openai','qwen','claude','gemini']) {
        const data = provider === 'claude' ? {type:'content_block_delta',delta:{text:'reply'}} : provider === 'gemini' ? {candidates:[{content:{parts:[{text:'re'},{text:'ply'}]}}]} : {choices:[{delta:{content:'reply'}}]};
        window.fetch = async () => new Response('data:'+JSON.stringify(data),{headers:{'content-type':'text/event-stream'}});
        let text=''; await __chat.StreamModule.callStream(provider,'dummy',[],100,'dummy',{onContent:chunk=>text+=chunk},new AbortController().signal); output.push(text);
      }
      window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'json reply'}}]}),{headers:{'content-type':'application/json'}});
      let text='';await __chat.StreamModule.callStream('deepseek','dummy',[],100,'dummy',{onContent:chunk=>text+=chunk});output.push(text);
      return output;
    });
    assert.deepEqual(value, ['reply','reply','reply','reply','reply','json reply']);
  });
  await test('workbench treats an empty final response as a failure', async () => {
    assert.match(await page.evaluate(async () => {
      window.fetch=async()=>new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      try {await __chat.StreamModule.callStream('deepseek','dummy',[],100,'dummy',{onContent(){}});} catch(error){return error.message;}
    }), /没有最终正文/);
  });
  await test('normal send persists each user message exactly once', async () => {
    await page.evaluate(async () => {
      __chat.createC();window.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'mock reply'}}]}),{headers:{'content-type':'text/event-stream'}});
      document.getElementById('userInput').value='test single question';await __chat.send();
    });
    await page.waitForFunction(() => !__chat.S.ir);
    const messages=await page.evaluate(()=>__chat.S.cs.find(item=>item.id===__chat.S.cid).messages);
    assert.equal(messages.filter(item=>item.role==='user').length,1);assert.equal(messages[1].content,'mock reply');
  });
  await test('stream errors preserve partial workbench replies', async () => {
    await page.evaluate(async () => {
      __chat.createC();window.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'partial reply'}}]})+'\n\ndata: {"error":{"message":"broken stream"}}\n\n',{headers:{'content-type':'text/event-stream'}});
      document.getElementById('userInput').value='test partial';await __chat.send();
    });
    await page.waitForFunction(() => !__chat.S.ir);
    const message=await page.evaluate(()=>__chat.S.cs.find(item=>item.id===__chat.S.cid).messages.at(-1));
    assert.equal(message.content,'partial reply');assert.equal(message.incomplete,true);
  });
  await test('comparison sends complete with shared provider adapters', async () => {
    const value = await page.evaluate(async () => {
      localStorage.setItem('dp0', JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('dummy')},openai:{apiKey:DreamscapeConfig.encode('dummy')}}));
      __chat.createC();__chat.S.compareMode=true;__chat.S.compareEntries=[{providerKey:'deepseek',model:'dummy'},{providerKey:'openai',model:'dummy'}];
      window.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'comparison reply'}}]}),{headers:{'content-type':'text/event-stream'}});
      document.getElementById('userInput').value='compare';await __chat.send();
      __chat.S.compareMode=false;return __chat.S.cs.find(item=>item.id===__chat.S.cid).messages.at(-1).comparison.results;
    });
    assert.equal(value.entry_0.content,'comparison reply');assert.equal(value.entry_1.content,'comparison reply');
  });
  await test('drafts are scoped to their conversation and cleared after submit', async () => {
    acceptRestore=true;
    const oldId=await page.evaluate(()=>__chat.S.cid);
    await page.locator('#userInput').fill('draft for first conversation');await page.evaluate(()=>DreamscapeStorage.persist());
    await page.evaluate(()=>__chat.createC());assert.equal(await page.locator('#userInput').inputValue(),'');
    await page.evaluate(id=>__chat.switchC(id),oldId);assert.equal(await page.locator('#userInput').inputValue(),'draft for first conversation');
    await page.evaluate(()=>DreamscapeStorage.markSaved());acceptRestore=false;
  });
  for (const name of ['chat', 'chatroom', 'mdtest']) {
    await go(name);
    await test(name + ': HTML injection is blocked while Markdown survives', async () => {
      const value=await page.evaluate(async () => {
        window.__injected=false;
        const element=document.createElement('div');element.innerHTML=DreamscapeMarkdown.render('**bold**\n<img src="invalid" onerror="window.__injected=true"><a href="javascript:window.__injected=true">link</a>');document.body.append(element);
        await new Promise(resolve=>setTimeout(resolve,50));return {injected:window.__injected,bold:element.querySelector('strong')?.textContent,handler:Boolean(element.querySelector('[onerror]')),unsafeLink:Boolean(element.querySelector('[href^="javascript:"]'))};
      });
      assert.deepEqual(value,{injected:false,bold:'bold',handler:false,unsafeLink:false});
    });
  }
  await test('Markdown fallback escapes HTML if purifier fails to load', async () => {
    assert.equal(await page.evaluate(() => {
      const saved=window.DOMPurify;window.DOMPurify=undefined;const html=DreamscapeMarkdown.render('<img onerror="run()">');window.DOMPurify=saved;return html.includes('&lt;img');
    }),true);
  });
  await go('chatroom');
  await test('chatroom shares stream formats and preserves interrupted partial replies', async () => {
    const value = await page.evaluate(async () => {
      localStorage.setItem('dp0',JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('dummy')},claude:{apiKey:DreamscapeConfig.encode('dummy')},gemini:{apiKey:DreamscapeConfig.encode('dummy')}}));
      const replies=[];
      for(const provider of ['deepseek','claude','gemini']){
        const data=provider==='claude'?{type:'content_block_delta',delta:{text:'room reply'}}:provider==='gemini'?{candidates:[{content:{parts:[{text:'room reply'}]}}]}:{choices:[{delta:{content:'room reply'}}]};
        window.fetch=async()=>new Response('data:'+JSON.stringify(data),{headers:{'content-type':'text/event-stream'}});
        replies.push(await __room.streamAI({provider,model:'dummy',name:'test'},[],new AbortController().signal));
      }
      if (!__room.state.room.participants.some(participant=>participant.type!=='human')) __room.state.room.participants.push({name:'test AI',type:'ai',provider:'deepseek',model:'dummy',prompt:'test role',temp:0.7,enabled:true});
      const ai=__room.state.room.participants.findIndex(participant=>participant.type!=='human');
      __room.state.room.participants[ai].provider='deepseek';
      window.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'partial room reply'}}]})+'\n\ndata: {"error":{"message":"interrupted"}}\n\n',{headers:{'content-type':'text/event-stream'}});
      await __room.callSingleAI(ai,1,2);
      return {replies,message:__room.state.room.messages.at(-1)};
    });
    assert.deepEqual(value.replies,['room reply','room reply','room reply']);assert.equal(value.message.content,'partial room reply');assert.equal(value.message.incomplete,true);
  });
  await go('mdtest');
  await test('Markdown math leaves inline and fenced code unchanged', async () => {
    const html=await page.evaluate(()=>DreamscapeMarkdown.render('`$price$`\n\n```python\nx = "$value$"\n```\n\n$E=mc^2$',{math:true}));
    assert.match(html, /<code>\$price\$<\/code>/);assert.match(html,/\$value\$/);assert.match(html,/\$E=mc\^2\$/);
  });
  await test('Markdown autosave persists content without an unsaved draft prompt', async () => {
    await page.locator('#editor').fill('# Saved content');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('md_docs')).some(item=>item.content==='# Saved content'));
    assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('dreamscape_page_cache_v1')||'{}')).some(item=>item.path===location.pathname && item.dirty)),false);
  });
  await go('workflow');
  await test('workflow prefers the modern key even if an obsolete one exists', async () => {
    assert.equal(await page.evaluate(()=>{localStorage.setItem('dk30','obsolete');localStorage.setItem('dp0',JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('modern')}}));return readSharedDeepSeekConfig().apiKey;}),'modern');
  });
  await test('workflow executes an inherited dependency chain and stores outputs', async () => {
    const value=await page.evaluate(async () => {
      const wf=getActiveWorkflow(),main=ensureMainNode(wf);main.manualInput='root task';main.prompt='';
      const child=createNode('child',{inputType:'inherit',inheritFrom:main.id,prompt:'child task',_parentId:main.id});main.children.push(child);
      let calls=[];window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body).messages[0].content);return new Response('data:'+JSON.stringify({choices:[{delta:{content:calls.length===1?'parent output':'child output'}}]}),{headers:{'content-type':'text/event-stream'}});};
      await runExecutionQueue([main,child],{mode:'all'});return {calls,main:main.output,child:child.output,status:child.status,persisted:localStorage.getItem('wf_list')};
    });
    assert.deepEqual(value.calls,['root task','parent output\n\nchild task']);assert.equal(value.status,'done');assert.match(value.persisted,/child output/);
  });
  await test('workflow idle timeout ends execution and marks the node as error', async () => {
    const value=await page.evaluate(async () => {
      const original=DreamscapeRequest.withTimeout;DreamscapeRequest.withTimeout=(signal,ms,task)=>original(signal,20,task);
      window.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stalled','AbortError'))));
      const node=ensureMainNode(getActiveWorkflow());await runExecutionQueue([node],{mode:'single'});DreamscapeRequest.withTimeout=original;return {running:isRunning,status:node.status,error:node.error};
    });
    assert.equal(value.running,false);assert.equal(value.status,'error');assert.match(value.error,/未收到新数据/);
  });
  await page.setViewportSize({width:390,height:844});
  await test('workflow mobile tabs expose all three panels within viewport', async () => {
    for (const view of ['list','editor','tree']) {
      await page.locator(`.workflow-mobile-tabs [data-workflow-view="${view}"]`).click();
      const panel=view==='list'?'#panelLeft':view==='tree'?'#panelRight':'.panel-center';assert.equal(await page.locator(panel).isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
  });
  await go('latex');
  await test('LaTeX remote iframe load reports unverified result rather than success', async () => {
    const value=await page.evaluate(()=>{
      HTMLFormElement.prototype.submit=function(){};__latex.compile();
      const frame=document.getElementById('pdfFrame');frame.src='about:blank#mock-result';frame.onload();
      return {state:document.getElementById('compileDot').dataset.state,status:document.getElementById('compileStatus').textContent};
    });
    assert.notEqual(value.state,'success');assert.match(value.status,/未验证/);
  });
  await test('Claude browser header and Gemini nonstream URL are consistent', async () => {
    const value=await page.evaluate(()=>({header:DreamscapeConfig.providers.claude.authHeader('dummy')['anthropic-dangerous-direct-browser-access'],url:DreamscapeConfig.getUrl('gemini','dummy',false),openai:DreamscapeConfig.providers.openai.buildBody('dummy',[],100,0.7)}));
    assert.equal(value.header,'true');assert.match(value.url,/:generateContent$/);assert.equal(value.openai.max_completion_tokens,100);
  });
  await test('current reasoning models omit rejected sampling parameters and legacy models retain them', async () => {
    const bodies = await page.evaluate(() => {
      const p = DreamscapeConfig.providers;
      return ['gpt-6.1-sol','gpt-6-astra','gpt-6-luna','gpt-5.6-sol','gpt-4o'].map(id => p.openai.buildBody(id,[{role:'user',content:'hello'}],4000,0.4))
        .concat(['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-4-5'].map(id => p.claude.buildBody(id,[{role:'user',content:'hello'}],4000,0.4)));
    });
    for (const i of [0,1,2,3,5,6]) assert.equal('temperature' in bodies[i],false);
    for (const i of [4,7]) assert.equal(bodies[i].temperature,0.4);
    assert.equal(bodies[0].max_completion_tokens,4000);
  });
  await test('Claude and Gemini retain all system instructions and separate reasoning from final text', async () => {
    const value = await page.evaluate(() => {
      const p=DreamscapeConfig.providers, messages=[{role:'system',content:'role'},{role:'system',content:'protocol'},{role:'user',content:'question'}];
      return {claude:p.claude.buildBody('claude-sonnet-5-5',messages,4000,0.7),gemini:p.gemini.buildBody('gemini-3.8-flash',messages,4000,0.7),text:p.gemini.parseResponse({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:'answer'}]}}]}),claudeText:p.claude.parseResponse({content:[{type:'thinking',thinking:'reasoning'},{type:'text',text:'answer'}]})};
    });
    assert.equal(value.claude.system,'role\n\nprotocol');assert.equal(value.gemini.systemInstruction.parts[0].text,'role\n\nprotocol');
    assert.equal(value.text,'answer');assert.equal(value.claudeText,'answer');
  });
  await test('role-specific model snapshots survive selector rendering without changing global selection', async () => {
    const value=await page.evaluate(() => {
      const host=document.createElement('div');document.body.append(host);
      const before=localStorage.getItem('dp0');
      DreamscapeModelSelector.mount(host,{provider:'openai',model:'gpt-custom-snapshot',persist:false});
      const selected=host.querySelector('[aria-label="模型"]').value;host.remove();
      return {selected,unchanged:before===localStorage.getItem('dp0')};
    });
    assert.deepEqual(value,{selected:'gpt-custom-snapshot',unchanged:true});
  });
  await test('Gemini role assistance honors nonstream requests and excludes thought parts', async () => {
    await go('chatroom');
    const value=await page.evaluate(async () => {
      localStorage.setItem('dp0',JSON.stringify({gemini:{apiKey:DreamscapeConfig.encode('dummy')}}));
      const original=window.fetch;let request;
      try {
        window.fetch=async(url,opts)=>{request={url,body:JSON.parse(opts.body)};return new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'reasoning'},{text:'{"name":"role"}'}]}}]}),{headers:{'content-type':'application/json'}});};
        const text=await __room.streamAI({provider:'gemini',model:'gemini-3.8-flash',name:'test'},[{role:'user',content:'JSON please'}],new AbortController().signal,undefined,{stream:false,maxTokens:12000});
        return {request,text};
      } finally {window.fetch=original;}
    });
    assert.match(value.request.url,/:generateContent$/);assert.equal('stream' in value.request.body,false);assert.equal(value.text,'{"name":"role"}');
  });
  await test('legacy key migration is nondestructive and an explicit empty modern key stays empty', async () => {
    await page.evaluate(()=>{localStorage.removeItem('dp0');localStorage.setItem('dk30','legacy-dummy');});await go('settings');
    assert.equal(await page.evaluate(()=>DreamscapeConfig.getKey('deepseek')),'legacy-dummy');assert.equal(await page.evaluate(()=>localStorage.getItem('dk30')),null);
    await page.evaluate(()=>{localStorage.setItem('dp0',JSON.stringify({deepseek:{apiKey:''}}));localStorage.setItem('dk30','must-not-resurrect');});await go('settings');
    assert.equal(await page.evaluate(()=>DreamscapeConfig.getKey('deepseek')),'');
  });
  await test('malformed legacy configuration is retained for recovery', async () => {
    await page.evaluate(()=>localStorage.setItem('dp49','malformed legacy data'));await go('settings');
    assert.equal(await page.evaluate(()=>localStorage.getItem('dp49')),'malformed legacy data');
  });

  await go('settings');
  await test('custom model IDs are validated, deduplicated and persist across all model selectors', async () => {
    assert.deepEqual(await page.evaluate(()=>DreamscapeConfig.normalizeModels('custom-a, custom-a，bad<script>, models/custom-b')), ['custom-a','models/custom-b']);
    await page.locator('[data-provider="deepseek"] .custom-model-details summary').click();
    await page.locator('#custom-deepseek').fill('custom-a, custom-b');
    await page.locator('#custom-deepseek').dispatchEvent('change');
    await page.locator('#model-deepseek').selectOption('custom-a');
    await page.locator('#key-deepseek').fill('dummy');
    await page.locator('#saveApiBtn').click();
    await page.reload();
    assert.equal(await page.locator('#model-deepseek').inputValue(),'custom-a');
    for (const name of ['chat','chatroom','workflow','latex']) {
      await go(name);
      const value=await page.evaluate(()=>{
        const host=document.createElement('div');document.body.append(host);
        const selector=DreamscapeModelSelector.mount(host,{provider:'deepseek',model:'custom-a',persist:false});
        const models=[...host.querySelectorAll('select[aria-label="模型"] option')].map(x=>x.value);
        const selected=selector.getValue().model;selector.destroy();return {models,selected};
      });
      assert.ok(value.models.includes('custom-b'));assert.equal(value.selected,'custom-a');
    }
  });
  await go('settings');
  await test('connection diagnostic runs only on click and never saves unsaved keys', async () => {
    let requests=0;let sent;
    await page.route('https://api.deepseek.com/**',route=>{requests++;sent=route.request().postDataJSON();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'OK'}}]})});});
    const original=await page.evaluate(()=>localStorage.getItem('dp0'));
    await page.locator('#key-deepseek').fill('unsaved-test-only');
    assert.equal(requests,0);
    await page.locator('[data-provider="deepseek"] [data-test]').click();
    await page.waitForFunction(()=>document.querySelector('[data-provider="deepseek"] [data-test-status]').textContent.includes('连接成功'));
    assert.equal(requests,1);assert.equal(sent.model,'custom-a');assert.equal(sent.stream,false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('dp0')),original);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('connection diagnostic explains auth, permission, model and quota failures', async () => {
    for(const [status,expected] of [[401,'API Key'],[403,'权限'],[404,'模型'],[429,'额度']]) {
      await page.route('https://api.deepseek.com/**',route=>route.fulfill({status,body:'failure'}));
      await page.locator('[data-provider="deepseek"] [data-test]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-provider="deepseek"] [data-test]').disabled);
      assert.ok((await page.locator('[data-provider="deepseek"] [data-test-status]').textContent()).includes(expected));
      await page.unroute('https://api.deepseek.com/**');
    }
  });
  await go('latex');
  await test('LaTeX automatically selects Lua, Xe and pdf engines and can resume after manual selection', async () => {
    await page.locator('.mobile-tabs [data-mobile-view="source"]').click();
    const cases=[['\\directlua{print(1)}\\usepackage{fontspec}','lualatex'],['\\usepackage[UTF8]{ctex}','xelatex'],['% !TeX program = lualatex\n中文','lualatex'],['\\usepackage{amsmath}','pdflatex']];
    for(const [code,expected] of cases) {
      await page.locator('#texEditor').fill(code);
      await page.locator('#autoEngineBtn').click();
      assert.equal(await page.locator('#engineSelect').inputValue(),expected);
    }
    await page.locator('#engineSelect').selectOption('lualatex');
    await page.locator('#texEditor').fill('plain source');
    assert.equal(await page.locator('#engineSelect').inputValue(),'lualatex');
    await page.locator('#autoEngineBtn').click();
    assert.equal(await page.locator('#engineSelect').inputValue(),'pdflatex');
    assert.match(await page.locator('#engineHint').textContent(),/自动选择/);
  });
  await test('LaTeX source export retains exact text and compile shortcut submits once', async () => {
    const text='\\documentclass{article}\n\\begin{document}\nExample\n\\end{document}';
    await page.locator('#texEditor').fill(text);
    const downloading=page.waitForEvent('download');await page.locator('#downloadTexBtn').click();
    const download=await downloading;assert.equal(fs.readFileSync(await download.path(),'utf8'),text);
    await page.evaluate(()=>{window.__submitCount=0;HTMLFormElement.prototype.submit=function(){window.__submitCount++};});
    await page.locator('#texEditor').press('Control+Enter');
    assert.equal(await page.evaluate(()=>window.__submitCount),1);
    await page.locator('#cancelCompileBtn').click();
  });
  await go('index');
  await test('homepage setup status follows saved local configuration', async () => {
    assert.match(await page.locator('#setupTitle').textContent(),/就绪/);
    await page.evaluate(()=>{localStorage.removeItem('dp0');localStorage.removeItem('dp49');});
    await page.reload();assert.match(await page.locator('#setupTitle').textContent(),/首次使用/);
  });

  await page.close();
  const uiContext=await browser.newContext();page=await uiContext.newPage();
  page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
  async function newRoomFromHistory(){if(!await page.locator('#newRoomBtn').isVisible())await page.locator('#sidebarToggle').click();await page.locator('#newRoomBtn').click();if(!await page.evaluate(()=>DreamscapeRoom.getView().running))assert.equal(await page.locator('.drawer-backdrop').isVisible(),false);await page.keyboard.press('Escape');}
  async function speechPanel(){if(!await page.locator('#speakerFloat').isVisible())await page.locator('#openSpeaker').click();}
  async function roomMode(mode){await speechPanel();await page.locator('#quickSpeechMode').selectOption(mode);}
  async function clickSpeaker(index){await speechPanel();await page.locator('.speaker-names button').nth(index).click();}
  async function roomGoal(text,rounds){await page.locator('#openRoomSettings').click();await page.locator('#discussionGoalInput').fill(text);if(rounds)await page.locator('#roundsSelect').selectOption(rounds);await page.locator('#backToDiscussion').click();}
  await page.setViewportSize({width:1280,height:900});await go('chatroom');
  await page.evaluate(()=>{localStorage.removeItem('dp49');localStorage.setItem('dp0',JSON.stringify({deepseek:{apiKey:DreamscapeConfig.encode('dummy-manual')}}));DreamscapeRoom.preset('debate');});
  await roomGoal('Compare two proposals');
  await roomMode('manual');
  await test('room controls save after relocation and manual mode survives reload',async()=>{
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.speechMode),'manual');
    await page.reload();assert.equal(await page.locator('#quickSpeechMode').inputValue(),'manual');
    assert.equal(await page.locator('#discussionGoalInput').inputValue(),'Compare two proposals');
    assert.equal(await page.locator('#aiList .ai-card').count(),3);
    assert.equal(await page.locator('#startDiscussBtn').isVisible(),false);
  });
  await test('manual sends only save context and each clicked speaker makes exactly one request',async()=>{
    let count=0;let sent;
    await page.route('https://api.deepseek.com/**',r=>{count++;sent=r.request().postDataJSON();return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Manual answer"}}]}\n\ndata: [DONE]\n\n'});});
    await page.locator('#chatInput').fill('User background');await page.locator('#sendMsgBtn').click();assert.equal(count,0);
    await clickSpeaker(1);
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(count,1);assert.match(sent.messages[0].content,/反方/);assert.match(sent.messages[1].content,/User background/);
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.messages.at(-1).name),'反方');
    await clickSpeaker(1);await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(count,2);assert.match(sent.messages[1].content,/Manual answer/);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('inline speaker panel runs one reply or continues until explicit completion without opening settings',async()=>{
    await page.setViewportSize({width:855,height:740});
    assert.equal(await page.locator('#roomControls').evaluate(el=>el.classList.contains('open')),false);
    let count=0;const prompts=[];
    await page.route('https://api.deepseek.com/**',r=>{count++;prompts.push(r.request().postDataJSON());return r.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:count===3?'结论完整。【本次发言完毕】':'继续补充。'}}]})+'\n\ndata: [DONE]\n\n'});});
    await clickSpeaker(0);await page.waitForFunction(()=>!DreamscapeRoom.getView().running);assert.equal(count,1);
    await speechPanel();await page.locator('[data-policy="until_done"]').click();await clickSpeaker(1);
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);assert.equal(count,3);
    assert.match(prompts[1].messages[0].content,/连续发言模式/);assert.match(prompts[2].messages[0].content,/第 2 次发言/);
    assert.equal(await page.locator('#roomControls').evaluate(el=>el.classList.contains('open')),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.unroute('https://api.deepseek.com/**');
    count=0;await page.route('https://api.deepseek.com/**',r=>{count++;return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"还有补充"}}]}\n\ndata: [DONE]\n\n'});});
    await clickSpeaker(0);await page.waitForFunction(()=>!DreamscapeRoom.getView().running);assert.equal(count,12);
    await page.unroute('https://api.deepseek.com/**');await speechPanel();await page.locator('[data-policy="once"]').click();await page.setViewportSize({width:1280,height:900});
  });
  await test('continuous speaker can hand off to another name and stop prevents further continuations',async()=>{
    const calls=[];const held=[];
    await page.route('https://api.deepseek.com/**',r=>{calls.push(r.request().postDataJSON());held.push(r);});
    const reply=r=>r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"尚未讲完"}}]}\n\ndata: [DONE]\n\n'});
    await speechPanel();await page.locator('[data-policy="until_done"]').click();await clickSpeaker(0);await page.waitForTimeout(100);
    await speechPanel();await page.locator('[data-policy="once"]').click();await clickSpeaker(1);
    await reply(held[0]);await page.waitForTimeout(100);assert.equal(calls.length,2);assert.match(calls[1].messages[0].content,/反方/);assert.doesNotMatch(calls[1].messages[0].content,/连续发言模式/);
    await reply(held[1]);await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    await speechPanel();await page.locator('[data-policy="until_done"]').click();await clickSpeaker(0);await page.waitForTimeout(100);
    await page.locator('#stopDiscussBtn').click();await reply(held[2]).catch(()=>{});await page.waitForFunction(()=>!DreamscapeRoom.getView().running);await page.waitForTimeout(100);assert.equal(calls.length,3);
    await page.unroute('https://api.deepseek.com/**');await speechPanel();await page.locator('[data-policy="once"]').click();
  });
  await test('manual pending choice is visible, replaceable and uses new background after current speaker',async()=>{
    const sent=[];let held;
    await page.route('https://api.deepseek.com/**',r=>{sent.push(r.request().postDataJSON());if(sent.length===1){held=r;return;}return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Second answer"}}]}\n\ndata: [DONE]\n\n'});});
    await clickSpeaker(0);await page.waitForFunction(()=>DreamscapeRoom.getView().running);
    await clickSpeaker(1);await clickSpeaker(2);
    assert.match(await page.locator('#nextSpeaker').textContent(),/裁判/);
    await page.locator('#chatInput').fill('Additional requirement');await page.locator('#sendMsgBtn').click();
    assert.equal(await page.locator('#quickSpeechMode').isEnabled(),true);
    const roomID=await page.evaluate(()=>DreamscapeRoom.getView().room.id);await newRoomFromHistory();
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.id),roomID);
    await held.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"First answer"}}]}\n\ndata: [DONE]\n\n'});
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(sent.length,2);assert.match(sent[1].messages[0].content,/裁判/);assert.match(sent[1].messages[1].content,/Additional requirement/);
    assert.equal(await page.locator('#nextSpeaker').isVisible(),false);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('manual stop clears pending choice without launching it and preserves recorded messages',async()=>{
    let count=0;let held;
    await page.route('https://api.deepseek.com/**',r=>{count++;held=r;});
    const before=await page.evaluate(()=>DreamscapeRoom.getView().room.messages.length);
    await clickSpeaker(0);await page.waitForFunction(()=>DreamscapeRoom.getView().running);
    await clickSpeaker(1);await page.locator('#stopDiscussBtn').click();
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(count,1);assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().next),undefined);
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.messages.length),before);
    await held.abort().catch(()=>{});await page.unroute('https://api.deepseek.com/**');
  });
  await test('cancel next and explicit verdict operate independently',async()=>{
    let count=0;let held;let system;
    await page.route('https://api.deepseek.com/**',r=>{count++;system=r.request().postDataJSON().messages[0].content;if(count===1){held=r;return;}return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Verdict"}}]}\n\ndata: [DONE]\n\n'});});
    await clickSpeaker(0);await page.waitForFunction(()=>DreamscapeRoom.getView().running);
    await clickSpeaker(1);await page.locator('#cancelNext').click();
    await held.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: [DONE]\n\n'});
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);assert.equal(count,1);
    await speechPanel();await page.locator('.speaker-options summary').click();await page.locator('#speechPurpose').selectOption('verdict');await clickSpeaker(2);
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);assert.match(system,/用户明确要求最终裁决/);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('room file export preserves manual mode and never includes API secrets',async()=>{
    const downloading=page.waitForEvent('download');await page.locator('#exportFullRoomBtn').evaluate(el=>el.click());
    const file=await downloading;const text=fs.readFileSync(await file.path(),'utf8');const data=JSON.parse(text);
    assert.equal(data.room.speechMode,'manual');assert.equal(text.includes('dummy-manual'),false);
  });
  await test('saved discussions reload with a working role panel and new rooms restore template starters',async()=>{
    const errors=[];const listener=e=>errors.push(e.message);page.on('pageerror',listener);
    await page.reload();assert.deepEqual(errors,[]);assert.equal(await page.locator('#quickSpeechMode').inputValue(),'manual');
    assert.ok(await page.locator('.speaker-names button').count()>0);assert.equal(await page.locator('#speakerFloat').isVisible(),false);
    await newRoomFromHistory();assert.equal(await page.locator('[data-preset="debate"]').isVisible(),true);
    await page.locator('[data-preset="debate"]').click();assert.equal(await page.locator('#aiList .ai-card').count(),3);await page.locator('#backToDiscussion').click();
    page.removeListener('pageerror',listener);
  });
  await test('mobile management dialogs keep the conversation behind them, close on Escape, and restore focus',async()=>{
    await page.setViewportSize({width:390,height:844});await page.locator('#openControls').click();
    assert.equal(await page.locator('.manager-header h1').textContent(),'角色管理');assert.equal(await page.locator('#messagesArea').isVisible(),true);assert.equal(await page.locator('#roomControls').evaluate(el=>el.open),true);
    assert.equal(await page.locator('#discussionGoalInput').isVisible(),false);await page.keyboard.press('Escape');assert.equal(await page.locator('#roomControls').evaluate(el=>el.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'openControls');await page.locator('#openControls').click();for(let i=0;i<8;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('roomControls').contains(document.activeElement)),true);await page.mouse.click(1,1);assert.equal(await page.locator('#roomControls').evaluate(el=>el.open),false);await page.locator('#openControls').click();
    await page.locator('.role-picker button').nth(1).click();assert.equal(await page.locator('#aiList .ai-card:visible .ai-card-name').inputValue(),'反方');
    await page.locator('#aiList .ai-card:visible .ai-card-name').fill('反方测试');
    await page.locator('.manager-header [data-room-page="settings"]').click();assert.equal(await page.locator('#aiList').isVisible(),false);
    await page.locator('#discussionGoalInput').fill('Separate pages goal');await page.goBack();assert.equal(await page.locator('.manager-header h1').textContent(),'角色管理');
    await page.locator('#backToDiscussion').click();assert.equal(await page.locator('.speaker-names button').nth(1).textContent(),'反方测试');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#sidebarToggle').click();assert.equal(await page.locator('#historyList').isVisible(),true);await page.keyboard.press('Escape');
    await page.reload();assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.discussionGoal),'Separate pages goal');assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.participants[1].name),'反方测试');
  });
  await page.setViewportSize({width:1280,height:900});
  await test('live mode switching finishes current speaker and hands off without duplicate requests',async()=>{
    await page.evaluate(()=>DreamscapeRoom.preset('debate'));
    await roomGoal('Switch while speaking','1');
    const calls=[];const held=[];let thirdReady;
    const thirdRequest=new Promise(resolve=>thirdReady=resolve);
    await page.route('https://api.deepseek.com/**',r=>{calls.push(r.request().postDataJSON());held.push(r);if(held.length===3)thirdReady();});
    const reply=r=>r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Completed turn"}}]}\n\ndata: [DONE]\n\n'});
    await page.locator('#startDiscussBtn').click();await page.waitForFunction(()=>DreamscapeRoom.getView().speaker==='正方');
    await roomMode('manual');await clickSpeaker(1);
    assert.equal(calls.length,1);assert.equal(await page.locator('#nextSpeaker').isVisible(),true);
    await reply(held[0]);await page.waitForFunction(()=>DreamscapeRoom.getView().speaker==='反方');
    assert.equal(calls.length,2);assert.match(calls[1].messages[0].content,/【手动指定发言】/);
    await clickSpeaker(0);await roomMode('auto');
    assert.equal(await page.locator('#nextSpeaker').isVisible(),false);assert.equal(calls.length,2);
    await reply(held[1]);await thirdRequest;await page.waitForFunction(()=>DreamscapeRoom.getView().speaker==='裁判');
    assert.equal(calls.length,3);assert.match(calls[2].messages[0].content,/【最终裁决阶段】/);
    await roomMode('manual');await reply(held[2]);
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(calls.length,3);assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.messages.length),3);
    await page.reload();assert.equal(await page.locator('#quickSpeechMode').inputValue(),'manual');
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('switching a paused human turn to manual releases the automatic loop',async()=>{
    await page.evaluate(()=>{DreamscapeRoom.preset('free');const r=DreamscapeRoom.getView().room;r.participants.unshift({type:'human',name:'你',enabled:true});});
    await roomGoal('Human opening','1');await page.locator('#startDiscussBtn').click();
    await page.waitForFunction(()=>DreamscapeRoom.getView().paused);
    await roomMode('manual');await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().paused),false);
    await page.locator('#chatInput').fill('Background after switching');await page.locator('#sendMsgBtn').click();
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.messages.at(-1).content),'Background after switching');
    let calls=0;
    await page.route('https://api.deepseek.com/**',r=>{calls++;return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Resumed answer"}}]}\n\ndata: [DONE]\n\n'});});
    await roomMode('auto');await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(calls,3);assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().paused),false);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('stop after live mode switches prevents an automatic handoff',async()=>{
    await page.evaluate(()=>DreamscapeRoom.preset('debate'));await roomGoal('Stop handoff');
    let calls=0;let held;
    await page.route('https://api.deepseek.com/**',r=>{calls++;held=r;});
    await page.locator('#startDiscussBtn').click();await page.waitForFunction(()=>DreamscapeRoom.getView().speaker==='正方');
    await roomMode('manual');await clickSpeaker(1);
    await roomMode('auto');await page.locator('#stopDiscussBtn').click();
    await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    await held.fulfill({contentType:'text/event-stream',body:'data: [DONE]\n\n'}).catch(()=>{});
    await roomMode('manual');await roomMode('auto');
    assert.equal(calls,1);assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().running),false);
    assert.equal(await page.locator('#nextSpeaker').isVisible(),false);await page.unroute('https://api.deepseek.com/**');
  });
  await test('automatic one-round goal-only discussion still runs in order and opens judge verdict stage',async()=>{
    await page.evaluate(()=>DreamscapeRoom.preset('debate'));
    await roomGoal('One round review','1');
    const calls=[];
    await page.route('https://api.deepseek.com/**',r=>{calls.push(r.request().postDataJSON());return r.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Round response"}}]}\n\ndata: [DONE]\n\n'});});
    await page.locator('#startDiscussBtn').click();await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(calls.length,3);assert.match(calls[0].messages[0].content,/正方/);assert.match(calls[1].messages[0].content,/反方/);assert.match(calls[2].messages[0].content,/【最终裁决阶段】/);
    await page.unroute('https://api.deepseek.com/**');
  });
  await test('relocated theme and role action buttons still work and persist',async()=>{
    const before=await page.locator('html').getAttribute('data-theme');
    const after=before==='dark'?'light':'dark';
    await page.locator('.room-menu summary').click();await page.locator('#themeBtn').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),after);
    await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),after);
    await page.locator('#openRoomSettings').click();await page.locator('.advanced-settings summary').click();await page.locator('#roomDeepThinkingBtn').click();
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.deepThinking),true);
    await page.locator('.manager-header [data-room-page="roles"]').click();await page.locator('.add-role-menu summary').click();await page.locator('#addAiBtn').click();
    assert.equal(await page.locator('#aiList .ai-card').count(),4);
    await page.locator('#addHumanBtn').click();assert.equal(await page.locator('#aiList .human-card').count(),1);
    await page.locator('#openRoleCreatorBtn').click();assert.equal(await page.locator('#roleCreatorOverlay').isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#roleCreatorOverlay').isVisible(),false);assert.equal(await page.locator('#roomControls').evaluate(el=>el.open),true);await page.reload();
    assert.equal(await page.locator('#aiList .ai-card').count(),5);
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.deepThinking),true);await page.locator('#backToDiscussion').click();
  });
  await test('existing role AI assistance previews editable suggestions and applies only to the original role',async()=>{
    await page.locator('#openControls').click();await page.locator('.role-picker button').nth(0).click();
    const card=page.locator('#aiList .ai-card:visible');const before=await page.evaluate(()=>JSON.parse(JSON.stringify(DreamscapeRoom.getView().room.participants[0])));const count=await page.locator('#aiList .ai-card').count();
    assert.equal(await card.locator('.role-ai-assist').getAttribute('open'),null);await card.locator('.role-ai-assist > summary').click();await card.locator('.assist-instruction').fill('语气温和，保留原职责');
    let sent;await page.route('https://api.deepseek.com/**',r=>{sent=r.request().postDataJSON();return r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({name:'温和审查者',prompt:'温和地分析风险并给出具体改进建议。',temp:0.45,tags:['judge'],message:'保留职责，调整表达。'})}}]})});});
    await card.locator('.assist-generate').click();await card.locator('.assist-preview').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.participants[0].prompt),before.prompt);assert.match(sent.messages[1].content,/语气温和/);assert.match(sent.messages[1].content,new RegExp(before.name));
    await card.locator('.assist-prompt').fill('温和地分析风险，给出三条具体建议。');await card.locator('.assist-apply').click();
    const after=await page.evaluate(()=>DreamscapeRoom.getView().room.participants[0]);assert.equal(after.name,'温和审查者');assert.equal(after.prompt,'温和地分析风险，给出三条具体建议。');assert.equal(after.temp,0.45);
    for(const key of ['provider','model','enabled','locked','fixedProtocol'])assert.equal(after[key],before[key]);assert.deepEqual(after.roleTags,before.roleTags);assert.equal(await page.locator('#aiList .ai-card').count(),count);
    await page.unroute('https://api.deepseek.com/**');await page.reload();assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.participants[0].prompt),after.prompt);await page.locator('#backToDiscussion').click();
  });
  await test('role AI assistance rejects stale suggestions and retains the original on error or cancellation',async()=>{
    await page.locator('#openControls').click();await page.locator('.role-picker button').nth(0).click();const card=page.locator('#aiList .ai-card:visible');await card.locator('.role-ai-assist > summary').click();await card.locator('.assist-instruction').fill('补充职责');
    let held;await page.route('https://api.deepseek.com/**',r=>{held=r;});await card.locator('.assist-generate').click();await page.waitForTimeout(100);await card.locator('.ai-prompt').fill('用户刚刚手动编辑的内容');
    await held.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({name:'过时建议',prompt:'过时的提示',temp:0.5,tags:[]})}}]})});await card.locator('.assist-preview').waitFor({state:'visible'});await card.locator('.assist-apply').click();assert.match(await card.locator('.assist-status').textContent(),/已有修改/);assert.equal(await card.locator('.ai-prompt').inputValue(),'用户刚刚手动编辑的内容');
    await card.locator('.assist-discard').click();await card.locator('.assist-generate').click();await page.waitForTimeout(100);await card.locator('.assist-cancel').click();await card.locator('.assist-cancel').waitFor({state:'hidden'});await held.abort().catch(()=>{});assert.equal(await card.locator('.ai-prompt').inputValue(),'用户刚刚手动编辑的内容');await page.unroute('https://api.deepseek.com/**');
    await page.route('https://api.deepseek.com/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'invalid role'}}]})}));await card.locator('.assist-generate').click();await card.locator('.assist-cancel').waitFor({state:'hidden'});assert.equal(await card.locator('.assist-preview').isVisible(),false);assert.equal(await card.locator('.ai-prompt').inputValue(),'用户刚刚手动编辑的内容');await page.unroute('https://api.deepseek.com/**');
    await card.locator('.ai-lock-btn').click();assert.equal(await card.locator('.assist-generate').isDisabled(),true);await card.locator('.ai-lock-btn').click();await page.locator('#backToDiscussion').click();
  });
  await test('speaker control is a single launcher, floats without resizing messages, and leaves manual mode active when closed',async()=>{
    await page.evaluate(()=>DreamscapeRoom.setMode('manual'));
    assert.equal(await page.locator('#speakerFloat').isVisible(),false);
    const before=await page.locator('#messagesArea').boundingBox();await page.locator('#openSpeaker').click();assert.equal(await page.locator('#speakerFloat').isVisible(),true);
    assert.equal(await page.locator('#quickSpeechMode').inputValue(),'manual');const after=await page.locator('#messagesArea').boundingBox();assert.deepEqual(after,before);
    await page.locator('#closeSpeaker').click();assert.equal(await page.locator('#speakerFloat').isVisible(),false);assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.speechMode),'manual');
    await page.locator('#openSpeaker').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#speakerFloat').isVisible(),false);
  });
  await test('role editor keeps selection after reorder and page navigation preserves the live request and input draft',async()=>{
    await page.locator('#openControls').click();await page.locator('.role-picker button').nth(1).click();
    const name=await page.locator('#aiList .ai-card:visible .ai-card-name').inputValue();await page.locator('#orderRoles').click();await page.locator('#aiList .ai-card:visible [data-action="up"]').click();
    assert.equal(await page.locator('#aiList .ai-card:visible .ai-card-name').inputValue(),name);await page.locator('#backToDiscussion').click();
    await roomMode('manual');await page.locator('#chatInput').fill('Keep this unsent draft');
    let held,calls=0;await page.route('https://api.deepseek.com/**',r=>{calls++;held=r;});await clickSpeaker(0);await page.waitForFunction(()=>DreamscapeRoom.getView().running);
    await page.locator('#openControls').click();assert.equal(await page.locator('#aiList .ai-card:visible .ai-card-name').isDisabled(),true);
    await page.locator('.manager-header [data-room-page="settings"]').click();assert.equal(await page.locator('#discussionGoalInput').isDisabled(),true);
    await page.locator('#backToDiscussion').click();assert.equal(await page.locator('#chatInput').inputValue(),'Keep this unsent draft');assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().running),true);assert.equal(calls,1);
    await page.locator('#openClassic').click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.roomPage),'chat');assert.equal(calls,1);
    await held.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"Finished without restarting"}}]}\n\ndata: [DONE]\n\n'});await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    await page.unroute('https://api.deepseek.com/**');await page.locator('#chatInput').fill('');
  });
  await test('classic layout shares saved rooms and returns to the new version without losing history or manual mode',async()=>{
    await roomMode('manual');await page.locator('#chatInput').fill('Shared history across layouts');await page.locator('#sendMsgBtn').click();
    const id=await page.evaluate(()=>DreamscapeRoom.getView().room.id);await page.locator('#openClassic').click();
    await page.waitForFunction(()=>document.documentElement.dataset.roomPage==='classic');assert.equal(await page.locator('#classicSpeechMode').inputValue(),'manual');
    assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.id),id);assert.equal(await page.locator('#roomNameInput').isVisible(),true);
    assert.match(await page.locator('#messagesArea').textContent(),/Shared history across layouts/);await page.getByRole('link',{name:'返回新版',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.dataset.roomPage==='chat');assert.equal(await page.evaluate(()=>DreamscapeRoom.getView().room.id),id);assert.match(await page.locator('#messagesArea').textContent(),/Shared history across layouts/);
  });
  await test('streaming and subsequent speakers preserve reading position until user returns to bottom',async()=>{
    await page.evaluate(()=>{DreamscapeRoom.preset('debate');DreamscapeRoom.setMode('manual');});
    await roomGoal('Scroll control');
    await page.locator('#chatInput').fill(Array(60).fill('Earlier discussion background.').join('\n'));await page.locator('#sendMsgBtn').click();
    await page.waitForFunction(()=>{const a=document.getElementById('messagesArea');return a.scrollHeight-a.clientHeight-a.scrollTop<25;});
    await page.evaluate(()=>{
      window.__scrollFetch=window.fetch;window.__scrollCalls=0;
      window.fetch=(url,options)=>String(url).startsWith('https://api.deepseek.com/')?new Response(new ReadableStream({start(controller){window.__scrollController=controller;window.__scrollCalls++;}}),{headers:{'content-type':'text/event-stream'}}):window.__scrollFetch(url,options);
      window.__scrollChunk=text=>window.__scrollController.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n'));
      window.__scrollDone=()=>{window.__scrollController.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));window.__scrollController.close();};
    });
    await clickSpeaker(0);await page.waitForFunction(()=>window.__scrollCalls===1);
    await page.evaluate(()=>__scrollChunk(Array(60).fill('Streaming answer.').join('\n')));
    await page.waitForFunction(()=>{const a=document.getElementById('messagesArea');return a.scrollHeight>2000&&a.scrollHeight-a.clientHeight-a.scrollTop<25;});
    await page.locator('#messagesArea').evaluate(el=>el.scrollTop=120);await page.waitForFunction(()=>document.getElementById('messagesArea').scrollTop===120);
    await page.evaluate(()=>__scrollChunk('\nNew text while reading history.'));await page.waitForFunction(()=>document.querySelector('#messagesArea .msg:last-child').textContent.includes('New text while reading history.'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#messagesArea').evaluate(el=>el.scrollTop),120);
    await page.evaluate(()=>__scrollDone());await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    await clickSpeaker(1);await page.waitForFunction(()=>window.__scrollCalls===2);
    await page.evaluate(()=>{__scrollChunk('Next speaker.');__scrollDone();});await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
    assert.equal(await page.locator('#messagesArea').evaluate(el=>el.scrollTop),120);
    await page.locator('#jumpLatest').click();await page.waitForFunction(()=>{const a=document.getElementById('messagesArea');return a.scrollHeight-a.clientHeight-a.scrollTop<25;});
    await clickSpeaker(2);await page.waitForFunction(()=>window.__scrollCalls===3);
    await page.evaluate(()=>__scrollChunk(Array(40).fill('Follow latest again.').join('\n')));
    await page.waitForFunction(()=>{const a=document.getElementById('messagesArea');return a.lastElementChild.textContent.includes('Follow latest again.')&&a.scrollHeight-a.clientHeight-a.scrollTop<25;});
    await page.evaluate(()=>{__scrollDone();window.fetch=window.__scrollFetch;});await page.waitForFunction(()=>!DreamscapeRoom.getView().running);
  });
  await page.setViewportSize({width:1280,height:900});await go('chat');
  await page.locator('#updateCloseBtn').evaluate(el=>el.click());
  await test('workbench parameter group and global search stay operable after button consolidation',async()=>{
    await page.locator('.wb-answer summary').click();await page.locator('#tempSelect').selectOption('0.3');
    assert.equal(await page.evaluate(()=>__chat.S.temp),0.3);
    await page.getByRole('button',{name:'搜索全部对话'}).click();assert.equal(await page.locator('#globalSearchInput').isVisible(),true);
  });

  await test('provider disclosures retain unsaved edits and save state survives model and default changes',async()=>{
    await go('settings');
    const openai=page.locator('[data-provider="openai"]');
    if(!(await openai.getAttribute('open')))await openai.locator(':scope > summary').click();
    await openai.locator('[data-key]').fill('ui-disclosure-test');
    await openai.locator(':scope > summary').click();await openai.locator(':scope > summary').click();
    assert.equal(await openai.locator('[data-key]').inputValue(),'ui-disclosure-test');
    assert.match(await page.locator('#configSaveState').textContent(),/未保存/);
    await openai.locator('[data-default]').click();
    assert.equal(await openai.locator('[data-key]').inputValue(),'ui-disclosure-test');
    await page.locator('#saveApiBtn').click();assert.doesNotMatch(await page.locator('#configSaveState').textContent(),/未保存/);
    await page.reload();assert.equal(await openai.locator('[data-key]').inputValue(),'ui-disclosure-test');
  });
  await test('Markdown export contains current editor text and displays its saved title',async()=>{
    await go('mdtest');const text='# 布局优化验收\n\nUnicode: 你好，灵境。\n';await page.locator('#editor').fill(text);
    await page.waitForFunction(()=>document.getElementById('documentTitle').textContent==='布局优化验收');
    assert.match(await page.locator('#documentSaveState').textContent(),/已保存/);
    const pending=page.waitForEvent('download');await page.locator('#exportMarkdown').click();const file=await pending;
    assert.equal(fs.readFileSync(await file.path(),'utf8'),text);
  });
  await test('role switching and close remain visible while the editor scrolls on narrow screens',async()=>{
    await go('chatroom');await page.setViewportSize({width:390,height:740});await page.locator('#openControls').click();
    const before=await page.locator('#closeManager').boundingBox();const card=page.locator('#aiList .ai-card:visible');
    await card.locator('.role-ai-assist > summary').click();await card.locator('.model-parameters > summary').click();
    await page.locator('#aiList').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.deepEqual(await page.locator('#closeManager').boundingBox(),before);
    const picker=await page.locator('.role-picker').boundingBox();assert.ok(picker.y>0&&picker.y+picker.height<740);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.role-picker button').nth(1).click();await page.locator('#closeManager').click();assert.equal(await page.locator('#roomControls').isVisible(),false);
  });
  await require('./research.cjs')({browser,base,test});
  if (process.env.VISUAL_REPORT_DIR) {
    await page.screenshot({path:path.join(process.env.VISUAL_REPORT_DIR,'optimization-home-mobile.png'),fullPage:true});
    await go('settings');await page.screenshot({path:path.join(process.env.VISUAL_REPORT_DIR,'optimization-settings-mobile.png'),fullPage:true});
    await go('latex');await page.locator('.mobile-tabs [data-mobile-view="source"]').click();
    await page.screenshot({path:path.join(process.env.VISUAL_REPORT_DIR,'optimization-latex-mobile.png'),fullPage:true});
  }
  if (process.env.TEST_REPORT) fs.writeFileSync(process.env.TEST_REPORT,JSON.stringify(results,null,2));
  const failed=results.filter(item=>!item.passed);console.log(`${results.length-failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.close();});
