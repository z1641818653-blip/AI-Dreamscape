// Conservative guard for a common entity collision; other topics still require model review.
export function scopeConflict(request,record){
 const q=String(request),text=[record.title,record.abstract].join(' ');
 const company=/(苹果公司|苹果企业|Apple\s*(?:Inc\.?|company)|(?:苹果|Apple).{0,12}(?:商业|企业|管理|营销|创新战略|供应链|business|corporate|marketing))/i.test(q);
 const fruit=/(果实|果树|果园|苹果酒|苹果种植|植物|fruit|orchard|cider|botan)/i.test(q);
 if(company&&!fruit&&/(?:\bcider\b|\bapple and pear\b|\banthracnose\b|\bapple\s+(?:fruit|orchard|cultivar)\b|苹果.{0,5}(?:炭疽|果实|果树|种植)|苹果酒)/i.test(text))return '主题冲突：需求指向苹果公司，资料主要涉及苹果果实、种植或植物病害';
 return '';
}
export function flagExistingConflicts(task){for(const r of task.results){const reason=scopeConflict(task.request,r);if(reason&&r.status==='approved'&&!r.userRejected){r.status='pending';r.score=0;r.reason=reason+'，需重新审核';}}}
