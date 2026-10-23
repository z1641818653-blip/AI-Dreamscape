export function cachedTranslation(record){const t=record.translation;return t&&t.sourceTitle===record.title&&t.sourceAbstract===record.abstract?t:null;}
export function translationQueue(records,detail){return records.filter(r=>{const t=cachedTranslation(r);return !t?.title||(detail&&r.abstract&&!t.abstract);});}
export function applyTranslations(records,items,detail){
 if(!Array.isArray(items))throw Error('翻译返回格式无效');let applied=0;
 for(const r of records){const item=items.find(i=>i.id===r.id);if(!item||typeof item.title!=='string'||!item.title.trim())continue;
 if(detail&&r.abstract&&(typeof item.abstract!=='string'||!item.abstract.trim()))continue;
 const old=cachedTranslation(r);r.translation={sourceTitle:r.title,sourceAbstract:r.abstract,title:item.title.trim().slice(0,1500),abstract:detail?String(item.abstract||'').slice(0,18000):old?.abstract||''};applied++;}
 if(!applied)throw Error('没有获得可用译文，请重试');return applied;
}
