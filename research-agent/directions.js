export const GROUPS=['对象','方向','时间','语言','关键词','排除项'];
export function normalizeOptions(options){const rows=[],seen=new Set();for(const o of options||[]){if(!GROUPS.includes(o?.group)||typeof o.label!=='string'||typeof o.value!=='string')continue;const row={group:o.group,label:o.label.trim().slice(0,80),value:o.value.trim().slice(0,160)};const id=row.group+'|'+row.value.toLowerCase();const labelId=row.group+'|label:'+row.label.toLowerCase();if(row.value&&row.label&&!seen.has(id)&&!seen.has(labelId)){rows.push(row);seen.add(id);seen.add(labelId);}if(rows.length===72)break;}return rows;}
export function mergeOptions(current,incoming){return normalizeOptions([...current,...incoming]);}
export function selectionContext(request,choices,extra=''){const lines=[request];for(const group of GROUPS){const values=choices.filter(o=>o.group===group).map(o=>o.value);if(values.length)lines.push(group==='排除项'?'排除（优先）：'+values.join('；'):group+'（任一符合）：'+values.join(' OR '));}if(extra.trim())lines.push('用户补充：'+extra.trim());if(choices.length)lines.push('组合规则：同组取并集、不同组同时满足；时间区间合并，不叠加为相互矛盾的要求；排除项优先。多个对象分别搜集、分别说明覆盖情况。');return lines.join('\n');}
export function initialOptions(request){const base=[
 ...(/苹果|apple/i.test(request)?[{group:'对象',label:'苹果公司',value:'苹果公司 Apple Inc.'},{group:'对象',label:'苹果果实 / 果树',value:'苹果果实 apple fruit Malus domestica'}]:[{group:'对象',label:'当前主题',value:request.slice(0,160)}]),
 ...['理论与机制','实证研究','案例分析','方法与工具','对比研究','发展趋势','产品与设计','管理与创新'].map(label=>({group:'方向',label,value:label})),
 ...['近三年','近五年','近十年'].map(label=>({group:'时间',label,value:label})),
 ...['中文','英文'].map(label=>({group:'语言',label,value:label})),
 ...['广告与宣传','新闻报道','预印本','非目标同名对象'].map(label=>({group:'排除项',label,value:label}))];return normalizeOptions(base);}
