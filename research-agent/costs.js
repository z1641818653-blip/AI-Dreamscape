export const VERIFIED='2026-10-29';
export const PRICES={
 'deepseek-flash':{input:[1,2],output:[4,8],hit:[.02,.04],url:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',note:'按空闲至高峰价格区间，不判断节假日'},
 'glm-5.3':{input:[8,8],output:[28,28],hit:[2,2],url:'https://open.bigmodel.cn/pricing',note:'标准 API 刊例价，不计活动折扣'},
 'glm-5.3-flash':{input:[.8,.8],output:[2.8,2.8],hit:[.23,.23],url:'https://open.bigmodel.cn/pricing',note:'标准 API 刊例价，不计限时五折'}
};
export const PRESETS={light:{steps:4,requests:6,minutes:1},standard:{steps:10,requests:14,minutes:3},deep:{steps:20,requests:30,minutes:6}};
export const money=n=>'¥'+n.toFixed(n<.01?4:3);
export function estimate(config,limits,{mode='agent',type='paper',quickCount=1}={}){const p=PRICES[config.model],rounds=mode==='agent'?limits.steps:0,input=[rounds*2000,rounds*48000],perRoundOutput=config.provider==='glm'?[1000,8000]:[300,1500],output=perRoundOutput.map(n=>n*rounds),paid=mode==='agent'?limits.requests:type==='web'?Math.min(limits.requests,Math.max(1,quickCount)):0;const coding=config.provider==='glm'&&config.apiMode==='coding';return {input,output,perRoundOutput,paid,coding,range:p&&!coding?[input[0]*p.input[0]/1e6+output[0]*p.output[0]/1e6,input[1]*p.input[1]/1e6+output[1]*p.output[1]/1e6+paid*.005]:[0,paid*.005],price:p};}
export function newUsage(){return {models:{},search:0,fetch:0,public:0};}
export function recordUsage(ledger,event){if(event.kind==='public'){ledger.public++;return;}if(event.kind==='search'||event.kind==='fetch'){ledger[event.kind]++;return;}
 const id=event.model+'|'+(event.apiMode||'standard'),row=ledger.models[id]??={model:event.model,apiMode:event.apiMode||'standard',calls:0,input:0,output:0,hit:0,reasoning:0,missing:0};row.calls++;
 const u=event.usage;if(!u||!Number.isFinite(u.prompt_tokens)||!Number.isFinite(u.completion_tokens)){row.missing++;return;}
 const input=Math.max(0,u.prompt_tokens),output=Math.max(0,u.completion_tokens);row.input+=input;row.output+=output;row.hit+=Math.min(input,Math.max(0,u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??0));row.reasoning+=Math.min(output,Math.max(0,u.completion_tokens_details?.reasoning_tokens||0));
}
export function mergeUsage(a,b){for(const [id,row] of Object.entries(b.models||{})){if(!a.models[id])a.models[id]=structuredClone(row);else for(const key of ['calls','input','output','hit','reasoning','missing'])a.models[id][key]+=row[key]||0;}for(const key of ['search','fetch','public'])a[key]+=(b[key]||0);return a;}
export function usageSummary(ledger){let input=0,output=0,missing=0,calls=0,coding=0,low=(ledger.search+ledger.fetch)*.005,high=low;for(const r of Object.values(ledger.models||{})){input+=r.input;output+=r.output;missing+=r.missing;calls+=r.calls;if(r.apiMode==='coding'){coding+=r.calls;continue;}const p=PRICES[r.model];if(!p){missing+=r.calls;continue;}for(const [index,key] of [[0,'low'],[1,'high']]){const cost=((r.input-r.hit)*p.input[index]+r.hit*p.hit[index]+r.output*p.output[index])/1e6;if(key==='low')low+=cost;else high+=cost;}}return {input,output,missing,calls,coding,range:[low,high]};}
