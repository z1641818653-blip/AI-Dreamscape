// Native Gemini requests preserve model parts and signatures across tool turns.
export async function geminiRequest(config,messages,signal,{tools,json=false}={}){
 const shared=globalThis.DreamscapeConfig,adapter=shared?.providers.gemini;
 if(!adapter)throw Error('Gemini 配置尚未加载，请刷新页面');
 const key=config.geminiKey||'';if(!/^[\x21-\x7e]+$/.test(key))throw Error('请在全局配置填写有效的 Gemini API Key');
 const body=adapter.buildBody(config.model,messages,16384,1,{reasoningEffort:config.reasoningEffort});
 if(json)body.generationConfig.responseMimeType='application/json';
 if(tools){body.tools=[{functionDeclarations:tools.map(t=>({name:t.function.name,description:t.function.description,parametersJsonSchema:t.function.parameters}))}];
 const planned=messages.some(m=>m.role==='tool'&&(()=>{try{return Boolean(JSON.parse(m.content).plan);}catch{return false;}})());
 body.toolConfig={functionCallingConfig:planned?{mode:'AUTO'}:{mode:'ANY',allowedFunctionNames:['plan_research']}};}
 let response;try{response=await fetch(shared.getUrl('gemini',config.model,false),{method:'POST',headers:{'Content-Type':'application/json',...adapter.authHeader(key)},body:JSON.stringify(body),signal,credentials:'omit',referrerPolicy:'no-referrer'});}catch(e){if(signal?.aborted)throw e;throw Error('Gemini 网络连接失败，请检查网络与服务可达性');}
 const data=await response.json();if(!response.ok||data.error)throw Error('Gemini HTTP '+response.status+'：'+String(data.error?.message||'请求失败').replaceAll(key,'***').slice(0,200));
 const content=data.candidates?.[0]?.content;if(!content)throw Error('Gemini 未返回内容：'+(data.promptFeedback?.blockReason||'请检查模型权限与输出限制'));
 const tool_calls=(content.parts||[]).filter(p=>p.functionCall).map(p=>({id:globalThis.crypto.randomUUID(),type:'function',function:{name:p.functionCall.name,arguments:JSON.stringify(p.functionCall.args||{})}}));
 return {content:adapter.parseResponse(data),geminiContent:content,...(tool_calls.length?{tool_calls}:{})};
}
