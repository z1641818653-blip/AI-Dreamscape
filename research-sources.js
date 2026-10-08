(function () {
  'use strict';
  const sources = {
    Crossref:{url:'https://www.crossref.org/',domain:'api.crossref.org',type:'paper'},
    'Europe PMC':{url:'https://europepmc.org/',domain:'europepmc.org',type:'paper'},
    DataCite:{url:'https://datacite.org/',domain:'api.datacite.org',type:'dataset'}
  };
  const text = value => String(value || '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,12000);
  function safeURL(value) { try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
  function normalize(source, item, index) {
    let r;
    if (source==='Crossref') {
      const pdf=(item.link||[]).find(link=>link['content-type']==='application/pdf'&&safeURL(link.URL));
      r={doi:item.DOI,title:text(item.title?.[0]),abstract:text(item.abstract),year:item.published?.['date-parts']?.[0]?.[0]||item.issued?.['date-parts']?.[0]?.[0],authors:(item.author||[]).map(a=>text([a.given,a.family].filter(Boolean).join(' '))).join(', '),url:safeURL(item.URL),downloadUrl:pdf?safeURL(pdf.URL):'',type:'paper',format:pdf?'PDF':'文献',license:text(item.license?.[0]?.URL)};
    } else if (source==='Europe PMC') {
      const links=item.fullTextUrlList?.fullTextUrl||[];
      const pdf=links.find(link=>link.documentStyle==='pdf'&&link.availabilityCode==='OA'&&safeURL(link.url));
      r={doi:item.doi,title:text(item.title),abstract:text(item.abstractText),year:item.pubYear,authors:text(item.authorString),url:`https://europepmc.org/article/${encodeURIComponent(item.source)}/${encodeURIComponent(item.id)}`,downloadUrl:pdf?safeURL(pdf.url):'',type:'paper',format:pdf?'PDF':'文献',license:text(item.license)};
    } else {
      const a=item.attributes||{};
      const urls=Array.isArray(a.contentUrl)?a.contentUrl:[a.contentUrl];
      r={doi:a.doi,title:text(a.titles?.[0]?.title),abstract:text(a.descriptions?.find(d=>d.descriptionType==='Abstract')?.description||a.descriptions?.[0]?.description),year:a.publicationYear,authors:(a.creators||[]).map(c=>text(c.name)).join(', '),url:safeURL(a.url)||safeURL(`https://doi.org/${a.doi}`),downloadUrl:urls.map(safeURL).find(Boolean)||'',type:'dataset',format:text(a.formats?.[0])||'数据集',license:text(a.rightsList?.[0]?.rights),size:text(a.sizes?.[0])};
    }
    if (!r.title) return null;
    r.source=source;r.year=Number(r.year)||0;r.doi=text(r.doi).toLowerCase();
    r.id=r.doi?`doi:${r.doi}`:`${source}:${r.url||index}`;
    r.size=r.size||'大小未知';r.available=Boolean(r.downloadUrl);r.sourceRank=index+1;
    r.origins=[{source,url:r.url,downloadUrl:r.downloadUrl}];r.score=Math.max(1,100-index*3);r.reason='按来源内检索顺序排列，尚未经过模型排序。';r.scoreKind='source';
    return r;
  }
  function requestURL(source, query, year=0) {
    let url;
    if(source==='Crossref'){
      url=new URL('https://api.crossref.org/works');url.searchParams.set('query',query);url.searchParams.set('rows','20');
      url.searchParams.set('select','DOI,title,abstract,published,issued,author,URL,link,license,type');
      if(year)url.searchParams.set('filter',`from-pub-date:${year}-01-01`);
    }else if(source==='Europe PMC'){
      url=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');url.searchParams.set('query',year?`(${query}) AND FIRST_PDATE:[${year}-01-01 TO 3000-12-31]`:query);url.searchParams.set('format','json');url.searchParams.set('resultType','core');url.searchParams.set('pageSize','20');
    }else if(source==='DataCite'){
      url=new URL('https://api.datacite.org/dois');url.searchParams.set('query',year?`(${query}) AND publicationYear:[${year} TO *]`:query);url.searchParams.set('resource-type-id','dataset');url.searchParams.set('page[size]','20');
    }else throw new Error('未知检索来源');
    return url.href;
  }
  async function search(source, query, year, signal) {
    const url=requestURL(source,query,year);
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,30000);
    try{
      const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error(`${source} HTTP ${response.status}`);
      const data=await response.json(),items=source==='Crossref'?data.message?.items:source==='Europe PMC'?data.resultList?.result:data.data;
      if(!Array.isArray(items))throw new Error(`${source} 返回格式不正确`);
      return items.map((item,index)=>normalize(source,item,index)).filter(Boolean);
    }catch(error){if(signal?.aborted)throw error;if(error.name==='AbortError')throw new Error(`${source} 查询超时`);throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function merge(existing, incoming) {
    const map=new Map(existing.map(r=>[r.id,r]));
    for(const r of incoming){
      const prior=map.get(r.id);
      if(!prior){map.set(r.id,r);continue;}
      prior.origins=[...prior.origins,...r.origins.filter(o=>!prior.origins.some(p=>p.source===o.source&&p.url===o.url))];
      if(!prior.abstract&&r.abstract)prior.abstract=r.abstract;
      if(!prior.downloadUrl&&r.downloadUrl){prior.downloadUrl=r.downloadUrl;prior.available=true;prior.format=r.format;}
      prior.score=Math.max(prior.score,r.score);
    }
    return [...map.values()];
  }
  function plan(value, fallback) {
    return {query:text(value?.query||fallback).slice(0,300),topic:text(value?.topic||fallback).slice(0,100),reply:text(value?.reply||'检索条件已整理。'),type:['paper','dataset','all'].includes(value?.type)?value.type:'all',year:Number.isInteger(value?.year)&&value.year>=1900&&value.year<=2100?value.year:0};
  }
  function applyRanking(records, value) {
    const ranked=Array.isArray(value?.rankings)?value.rankings:[];
    const map=new Map(records.map(r=>[r.id,r]));const seen=new Set();
    for(const item of ranked){const r=map.get(item.id);if(!r||seen.has(item.id)||!Number.isFinite(item.score))continue;seen.add(item.id);r.score=Math.round(Math.max(0,Math.min(100,item.score)));r.reason=text(item.reason)||'模型未提供匹配理由';r.scoreKind='model';}
    // Unranked records follow ranked ones; never fabricate IDs or source URLs.
    return records;
  }
  window.DreamscapeResearch={sources,safeURL,text,normalize,requestURL,search,merge,plan,applyRanking};
})();
