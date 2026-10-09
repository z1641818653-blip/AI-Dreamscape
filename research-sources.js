(function () {
  'use strict';
  const resourceTypes = {
    paper:{label:'论文',aliases:['论文','文献','预印本','paper','article','preprint']},
    dataset:{label:'数据集',aliases:['数据集','数据','dataset','data']},
    video:{label:'视频',aliases:['视频','课程','录像','video','movie']},
    web:{label:'网页',aliases:['网页','网站','文章','web','website']},
    book:{label:'图书',aliases:['图书','书籍','章节','book']},
    report:{label:'报告',aliases:['报告','白皮书','政策文件','report','whitepaper']},
    image:{label:'图片',aliases:['图片','图像','地图','图表','image','map']},
    audio:{label:'音频',aliases:['音频','播客','录音','audio','podcast']},
    software:{label:'代码与软件',aliases:['代码','软件','仓库','源码','code','software','repository']},
    other:{label:'其他',aliases:['其他','文件','other','file']}
  };
  const sources = Object.create(null);
  const text = value => String(value || '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,12000);
  function safeURL(value) { try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
  function validType(value) { return Object.hasOwn(resourceTypes,value); }
  function normalizeTypes(value) {const values=Array.isArray(value)?value:[value],types=[...new Set(values.filter(validType))];return !types.length||values.includes('all')?Object.keys(resourceTypes):types;}
  function matchTypes(value) {const input=String(value||'').toLowerCase();return Object.entries(resourceTypes).filter(([,meta])=>meta.aliases.some(alias=>input.includes(alias.toLowerCase()))).map(([id])=>id);}
  function normalizeRecord(source, value, index) {
    const r={...value};if(!r.title)return null;
    r.source=source;r.title=text(r.title);r.abstract=text(r.abstract);r.authors=text(r.authors);r.type=validType(r.type)?r.type:'other';r.format=text(r.format)||resourceTypes[r.type].label;
    r.year=Number(r.year)||0;r.doi=text(r.doi).toLowerCase();r.url=safeURL(r.url);r.downloadUrl=safeURL(r.downloadUrl);r.id=r.doi?`doi:${r.doi}`:(r.url?`url:${r.url.replace(/[?#].*$/,'')}`:`${source}:${index}:${r.title}`);
    r.size=text(r.size)||'大小未知';r.available=Boolean(r.downloadUrl);r.sourceRank=index+1;r.origins=[{source,url:r.url,downloadUrl:r.downloadUrl}];r.score=Math.max(1,100-index*3);r.reason='按来源内检索顺序排列，尚未经过模型排序。';r.scoreKind='source';return r;
  }
  function registerSource(name, config) {
    if(!/^[\w .-]{2,80}$/i.test(name)||!config||!safeURL(config.url)||!Array.isArray(config.types)||!config.types.every(validType)||typeof config.buildURL!=='function'||typeof config.items!=='function'||typeof config.normalize!=='function')throw new Error('来源配置不完整');
    sources[name]=Object.freeze({name,description:'',...config,types:[...new Set(config.types)]});return sources[name];
  }
  function sourceSupports(source, types) {const config=sources[source];return Boolean(config&&config.types.some(type=>normalizeTypes(types).includes(type)));}
  const crossrefType=value=>({'book':'book','book-chapter':'book','book-section':'book','edited-book':'book','monograph':'book','reference-book':'book','report':'report','report-series':'report','standard':'report','standard-series':'report','dataset':'dataset'})[String(value||'').toLowerCase()]||'paper';
  const dataciteType=value=>({audiovisual:'video',book:'book',bookchapter:'book',collection:'other',computationalnotebook:'software',dataset:'dataset',dissertation:'paper',event:'other',image:'image',interactiveresource:'web',journal:'paper',journalarticle:'paper',model:'dataset',outputmanagementplan:'report',peerreview:'paper',physicalobject:'other',preprint:'paper',report:'report',service:'web',software:'software',sound:'audio',standard:'report',text:'report',workflow:'software',other:'other'})[String(value||'').replace(/\s+/g,'').toLowerCase()]||'other';
  const archiveType=value=>({movies:'video',audio:'audio',texts:'book',image:'image',software:'software',web:'web'})[String(value||'').toLowerCase()]||'other';
  registerSource('Crossref',{
    url:'https://www.crossref.org/',domain:'api.crossref.org',description:'论文、图书与报告的 DOI 元数据',types:['paper','book','report','dataset'],
    buildURL(query,year){const url=new URL('https://api.crossref.org/works');url.searchParams.set('query',query);url.searchParams.set('rows','20');url.searchParams.set('select','DOI,title,abstract,published,issued,author,URL,link,license,type');if(year)url.searchParams.set('filter',`from-pub-date:${year}-01-01`);return url.href;},items:data=>data.message?.items,
    normalize(item){const pdf=(item.link||[]).find(link=>link['content-type']==='application/pdf'&&safeURL(link.URL));return {doi:item.DOI,title:item.title?.[0],abstract:item.abstract,year:item.published?.['date-parts']?.[0]?.[0]||item.issued?.['date-parts']?.[0]?.[0],authors:(item.author||[]).map(a=>[a.given,a.family].filter(Boolean).join(' ')).join(', '),url:item.URL,downloadUrl:pdf?.URL,type:crossrefType(item.type),format:pdf?'PDF':'出版物',license:item.license?.[0]?.URL};}
  });
  registerSource('Europe PMC',{
    url:'https://europepmc.org/',domain:'europepmc.org',description:'生命科学论文、摘要与开放全文',types:['paper'],
    buildURL(query,year){const url=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');url.searchParams.set('query',year?`(${query}) AND FIRST_PDATE:[${year}-01-01 TO 3000-12-31]`:query);url.searchParams.set('format','json');url.searchParams.set('resultType','core');url.searchParams.set('pageSize','20');return url.href;},items:data=>data.resultList?.result,
    normalize(item){const links=item.fullTextUrlList?.fullTextUrl||[],pdf=links.find(link=>link.documentStyle==='pdf'&&link.availabilityCode==='OA'&&safeURL(link.url));return {doi:item.doi,title:item.title,abstract:item.abstractText,year:item.pubYear,authors:item.authorString,url:`https://europepmc.org/article/${encodeURIComponent(item.source)}/${encodeURIComponent(item.id)}`,downloadUrl:pdf?.url,type:'paper',format:pdf?'PDF':'论文',license:item.license};}
  });
  registerSource('DataCite',{
    url:'https://datacite.org/',domain:'api.datacite.org',description:'数据、软件、报告及其他 DOI 资料',types:Object.keys(resourceTypes),
    buildURL(query,year){const url=new URL('https://api.datacite.org/dois');url.searchParams.set('query',year?`(${query}) AND publicationYear:[${year} TO *]`:query);url.searchParams.set('page[size]','20');return url.href;},items:data=>data.data,
    normalize(item){const a=item.attributes||{},urls=Array.isArray(a.contentUrl)?a.contentUrl:[a.contentUrl];return {doi:a.doi,title:a.titles?.[0]?.title,abstract:a.descriptions?.find(d=>d.descriptionType==='Abstract')?.description||a.descriptions?.[0]?.description,year:a.publicationYear,authors:(a.creators||[]).map(c=>c.name).join(', '),url:a.url||`https://doi.org/${a.doi}`,downloadUrl:urls.map(safeURL).find(Boolean),type:dataciteType(a.types?.resourceTypeGeneral),format:a.formats?.[0]||a.types?.resourceType||'资料',license:a.rightsList?.[0]?.rights,size:a.sizes?.[0]};}
  });
  registerSource('Internet Archive',{
    url:'https://archive.org/',domain:'archive.org',description:'公开视频、音频、图书、图片、软件与网页资料',types:['video','audio','book','image','software','web'],
    buildURL(query,year,types){const url=new URL('https://archive.org/advancedsearch.php'),map={video:'movies',audio:'audio',book:'texts',report:'texts',image:'image',software:'software',web:'web'},media=[...new Set(normalizeTypes(types).map(type=>map[type]).filter(Boolean))],clean=String(query||'').replace(/["\\]/g,' ').trim();let q=`(${clean})`;if(media.length)q+=` AND mediatype:(${media.join(' OR ')})`;if(year)q+=` AND date:[${year}-01-01 TO 9999-12-31]`;url.searchParams.set('q',q);['identifier','title','description','date','year','creator','mediatype','format','licenseurl'].forEach(field=>url.searchParams.append('fl[]',field));url.searchParams.set('rows','20');url.searchParams.set('page','1');url.searchParams.set('output','json');return url.href;},items:data=>data.response?.docs,
    normalize(item){const id=text(item.identifier),format=Array.isArray(item.format)?item.format[0]:item.format;return {title:Array.isArray(item.title)?item.title[0]:item.title,abstract:Array.isArray(item.description)?item.description[0]:item.description,year:item.year||String(item.date||'').slice(0,4),authors:Array.isArray(item.creator)?item.creator.join(', '):item.creator,url:id?`https://archive.org/details/${encodeURIComponent(id)}`:'',downloadUrl:'',type:archiveType(item.mediatype),format:format||resourceTypes[archiveType(item.mediatype)].label,license:item.licenseurl};}
  });
  function normalize(source,item,index){const config=sources[source];return config?normalizeRecord(source,config.normalize(item,index),index):null;}
  function requestURL(source,query,year=0,types=['all']){const config=sources[source];if(!config)throw new Error('未知检索来源');return config.buildURL(query,year,types);}
  async function search(source,query,year,signal,types=['all']){const config=sources[source],url=requestURL(source,query,year,types),controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);try{const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error(`${source} HTTP ${response.status}`);const data=await response.json(),items=config.items(data);if(!Array.isArray(items))throw new Error(`${source} 返回格式不正确`);const wanted=normalizeTypes(types);return items.map((item,index)=>normalize(source,item,index)).filter(record=>record&&wanted.includes(record.type));}catch(error){if(signal?.aborted)throw error;if(error.name==='AbortError')throw new Error(`${source} 查询超时`);throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
  function merge(existing,incoming){const map=new Map(existing.map(r=>[r.id,r]));for(const r of incoming){const prior=map.get(r.id);if(!prior){map.set(r.id,r);continue;}prior.origins=[...prior.origins,...r.origins.filter(o=>!prior.origins.some(p=>p.source===o.source&&p.url===o.url))];if(!prior.abstract&&r.abstract)prior.abstract=r.abstract;if(!prior.downloadUrl&&r.downloadUrl){prior.downloadUrl=r.downloadUrl;prior.available=true;prior.format=r.format;}prior.score=Math.max(prior.score,r.score);}return [...map.values()];}
  function plan(value,fallback){const types=normalizeTypes(value?.types||value?.type||'all');return {query:text(value?.query||fallback).slice(0,300),topic:text(value?.topic||fallback).slice(0,100),reply:text(value?.reply||'检索条件已整理。'),types,type:types.length===1?types[0]:'all',year:Number.isInteger(value?.year)&&value.year>=1900&&value.year<=2100?value.year:0};}
  function applyRanking(records,value){const ranked=Array.isArray(value?.rankings)?value.rankings:[],map=new Map(records.map(r=>[r.id,r])),seen=new Set();for(const item of ranked){const r=map.get(item.id);if(!r||seen.has(item.id)||!Number.isFinite(item.score))continue;seen.add(item.id);r.score=Math.round(Math.max(0,Math.min(100,item.score)));r.reason=text(item.reason)||'模型未提供匹配理由';r.scoreKind='model';}return records;}
  window.DreamscapeResearch={resourceTypes,sources,registerSource,sourceSupports,normalizeTypes,matchTypes,validType,safeURL,text,normalize,requestURL,search,merge,plan,applyRanking};
})();
