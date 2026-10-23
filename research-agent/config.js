export const defaults={steps:10,requests:14,minutes:3,relay:false};
export const MODELS={deepseek:{provider:'deepseek',model:'deepseek-flash'},glm:{provider:'glm',model:'glm-5.3'},'glm-flash':{provider:'glm',model:'glm-5.3-flash'}};
const read=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem(key)||'null')||fallback;}catch{return fallback;}};
const decode=s=>{try{return decodeURIComponent(atob(s||''));}catch{return '';}};
const encode=s=>btoa(encodeURIComponent(String(s||'').trim()));
export function loadConfig(storage=localStorage){const shared=read(storage,'dp0',{}),options=read(storage,'dreamscape_agent_settings',{});return {...defaults,...options,key:decode(shared.deepseek?.apiKey),glmKey:decode(shared.glm?.apiKey),apiMode:shared.glm?.apiMode||'standard',reasoningEffort:shared.glm?.reasoningEffort||'low'};}
export function saveConfig(value,storage=localStorage){
 for(const key of [value.key,value.glmKey])if(key&&!/^[\x21-\x7e]+$/.test(key.trim()))throw Error('API Key 包含空格或非英文字符，请重新粘贴');
 const shared=read(storage,'dp0',{});for(const [provider,key] of [['deepseek',value.key],['glm',value.glmKey]])shared[provider]={...(shared[provider]||{}),apiKey:encode(key)};
 storage.setItem('dp0',JSON.stringify(shared));storage.setItem('dreamscape_agent_settings',JSON.stringify({steps:Math.min(30,Math.max(1,Number(value.steps)||10)),requests:Math.min(50,Math.max(1,Number(value.requests)||14)),minutes:Math.min(10,Math.max(.5,Number(value.minutes)||3)),relay:Boolean(value.relay)}));
}
export function selectedConfig(selection,storage=localStorage){return {...loadConfig(storage),...(MODELS[selection]||MODELS.deepseek),relay:false};}
