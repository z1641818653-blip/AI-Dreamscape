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
  function identityURL(value){const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);return url.href;}
  function normalizeRecord(source, value, index) {
    const r={...value};if(!r.title)return null;
    r.source=source;r.title=text(r.title);r.abstract=text(r.abstract);r.authors=text(r.authors);r.type=validType(r.type)?r.type:'other';r.format=text(r.format)||resourceTypes[r.type].label;
    r.year=Number(r.year)||0;r.doi=text(r.doi).toLowerCase();r.url=safeURL(r.url);r.downloadUrl=safeURL(r.downloadUrl);r.id=r.doi?`doi:${r.doi}`:(r.url?`url:${identityURL(r.url)}`:`${source}:${index}:${r.title}`);
    r.size=text(r.size)||'大小未知';r.available=Boolean(r.downloadUrl);r.sourceRank=index+1;r.origins=[{source,url:r.url,downloadUrl:r.downloadUrl}];r.score=Math.max(1,100-index*3);r.reason='按来源内检索顺序排列，尚未经过模型排序。';r.scoreKind='source';return r;
  }
  function registerSource(name, config) {
    if(!/^[\p{L}\p{N} ._-]{2,80}$/u.test(name)||!config||!safeURL(config.url)||!Array.isArray(config.types)||!config.types.every(validType)||typeof config.buildURL!=='function'||typeof config.items!=='function'||typeof config.normalize!=='function')throw new Error('来源配置不完整');
    sources[name]=Object.freeze({name,description:'',...config,types:[...new Set(config.types)]});return sources[name];
  }
  function publicURL(value) {
    const href=safeURL(value);if(!href)return '';
    const url=new URL(href),host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    if(host==='localhost'||host==='::'||host==='::1'||host.endsWith('.local'))return '';
    if(host.includes(':')){
      const first=host.split(':').find(Boolean)||'';
      if(/^f[cd]/.test(first)||/^fe[89ab]/.test(first)||host.startsWith('::ffff:'))return '';
    }
    const parts=host.split('.').map(Number);
    if(parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
      const [a,b]=parts;if(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19)))return '';
    }
    return href;
  }
  const PATH=/^(?:[A-Za-z_$][\w$-]*|\d+)(?:\.(?:[A-Za-z_$][\w$-]*|\d+))*$/;
  function cleanPath(value,required=false){const path=String(value||'').trim();if(!path&&!required)return '';if(!path||path.length>200||!PATH.test(path)||/(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(path))throw new Error('字段路径格式不正确');return path;}
  function resolvePath(value,path){if(!path)return value;return path.split('.').reduce((item,key)=>item==null?undefined:item[key],value);}
  function sanitizeDefinition(value) {
    if(!value||typeof value!=='object')throw new Error('来源配置不是对象');
    const name=text(value.name).slice(0,40);if(!/^[\p{L}\p{N} ._-]{2,40}$/u.test(name))throw new Error('来源名称应为 2–40 个文字、数字、空格或连接符');
    const homepage=publicURL(value.homepage);if(!homepage)throw new Error('来源主页必须是公开 HTTPS 地址');
    const searchUrl=String(value.searchUrl||'').trim();if(searchUrl.length>2000||!searchUrl.includes('{query}'))throw new Error('查询地址必须包含 {query}，且不超过 2000 字符');
    const probe=searchUrl.replaceAll('{query}','test').replaceAll('{year}','2024').replaceAll('{page}','1');if(/[{}]/.test(probe)||!publicURL(probe))throw new Error('查询地址只允许 {query}、{year}、{page} 占位符，并须指向公开 HTTPS 地址');
    const probeURL=new URL(probe);if([...probeURL.searchParams.keys()].some(key=>/(?:api.?key|token|secret|auth)/i.test(key)))throw new Error('本版自定义来源不保存密钥或认证参数');
    const rawTypes=Array.isArray(value.types)?value.types:[];if(!rawTypes.length||rawTypes.length>10||rawTypes.some(type=>!validType(type)))throw new Error('请至少选择一种有效资料类型');
    const defaultType=validType(value.defaultType)&&rawTypes.includes(value.defaultType)?value.defaultType:rawTypes[0];
    const fields=value.fields&&typeof value.fields==='object'?value.fields:{},cleanFields={};
    for(const key of ['title','abstract','year','authors','url','downloadUrl','doi','type','format','license','size'])cleanFields[key]=cleanPath(fields[key],key==='title');
    const typeMap={};if(value.typeMap&&typeof value.typeMap==='object')for(const [key,type] of Object.entries(value.typeMap).slice(0,50))if(validType(type))typeMap[text(key).slice(0,80)]=type;
    return {version:1,name,description:text(value.description).slice(0,200),homepage,searchUrl,resultPath:cleanPath(value.resultPath),types:[...new Set(rawTypes)],defaultType,fields:cleanFields,typeMap};
  }
  function compileDefinition(value) {
    const definition=sanitizeDefinition(value),absolute=input=>{try{return publicURL(new URL(String(input||''),definition.homepage).href);}catch{return '';}};
    return {definition,url:definition.homepage,domain:new URL(definition.homepage).hostname,description:definition.description||'用户添加的公开 JSON 来源',types:definition.types,custom:true,
      buildURL(query,year,page=1){return definition.searchUrl.replaceAll('{query}',encodeURIComponent(String(query||''))).replaceAll('{year}',year?String(year):'').replaceAll('{page}',String(Number(page)||1));},
      items:data=>resolvePath(data,definition.resultPath),
      normalize(item){const get=key=>resolvePath(item,definition.fields[key]),rawType=text(get('type')),mapped=validType(rawType)?rawType:definition.typeMap[rawType]||definition.defaultType;return {title:get('title'),abstract:get('abstract'),year:get('year'),authors:Array.isArray(get('authors'))?get('authors').join(', '):get('authors'),url:absolute(get('url')),downloadUrl:absolute(get('downloadUrl')),doi:get('doi'),type:mapped,format:get('format')||resourceTypes[mapped].label,license:get('license'),size:get('size')};}
    };
  }
  function registerDeclarativeSource(value){const compiled=compileDefinition(value),prior=sources[compiled.definition.name];if(prior&&!prior.custom)throw new Error('不能覆盖内置来源');return registerSource(compiled.definition.name,compiled);}
  function removeDeclarativeSource(name){if(sources[name]?.custom)delete sources[name];}
  async function testDeclarativeSource(value,query='test',signal){const compiled=compileDefinition(value),url=compiled.buildURL(query,0,1),controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,15000);try{const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error(`测试请求 HTTP ${response.status}`);const length=Number(response.headers.get('content-length'))||0;if(length>2*1024*1024)throw new Error('测试响应超过 2 MB');const body=await response.text();if(body.length>2*1024*1024)throw new Error('测试响应超过 2 MB');let data;try{data=JSON.parse(body);}catch{throw new Error('来源未返回有效 JSON');}const items=compiled.items(data);if(!Array.isArray(items))throw new Error('结果路径没有指向数组');const records=items.slice(0,3).map((item,index)=>normalizeRecord(compiled.definition.name,compiled.normalize(item,index),index)).filter(Boolean);if(!records.length)throw new Error('没有从前三条结果中解析出标题');return {definition:compiled.definition,records,url};}catch(error){if(error.name==='AbortError')throw new Error('来源测试超时');throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
  function sourceSupports(source, types) {const config=sources[source];return Boolean(config&&!config.discovery&&config.types.some(type=>normalizeTypes(types).includes(type)));}
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
    normalize(item){const links=item.fullTextUrlList?.fullTextUrl||[],pdf=links.find(link=>link.documentStyle==='pdf'&&(link.availabilityCode==='OA'||item.isOpenAccess==='Y'&&link.availabilityCode==='F')&&safeURL(link.url));return {doi:item.doi,title:item.title,abstract:item.abstractText,year:item.pubYear,authors:item.authorString,url:`https://europepmc.org/article/${encodeURIComponent(item.source)}/${encodeURIComponent(item.id)}`,downloadUrl:pdf?.url,type:'paper',format:pdf?'PDF':'论文',license:item.license};}
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
  registerSource('网页采集',{url:'https://example.org/',domain:'已验证公开网页',description:'模型辅助发现并实际访问的公开页面',types:Object.keys(resourceTypes),discovery:true,buildURL:()=>'',items:data=>[],normalize:item=>item});
  async function searchPage(source,query,year,signal,types=['all'],position={page:1,cursor:'*'}){
    const config=sources[source];let address=requestURL(source,query,year,types);const url=new URL(address),page=Number(position.page)||1;
    if(source==='Crossref')url.searchParams.set('cursor',position.cursor||'*');
    else if(source==='Europe PMC')url.searchParams.set('cursorMark',position.cursor||'*');
    else if(source==='DataCite')url.searchParams.set('page[number]',String(page));
    else if(source==='Internet Archive')url.searchParams.set('page',String(page));
    else if(config.custom)address=config.buildURL(query,year,page);
    const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
    try{let data;if(await window.DreamscapeResearchService?.ready)data=await DreamscapeResearchService.source(config.custom?address:url.href,controller.signal);else{const response=await fetch(config.custom?address:url.href,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error(source+' HTTP '+response.status);data=await response.json();}
      controller.signal.throwIfAborted();const items=config.items(data);if(!Array.isArray(items))throw new Error(source+' 返回格式不正确');
      const wanted=normalizeTypes(types),records=items.map((item,index)=>normalize(source,item,(page-1)*20+index)).filter(record=>record&&wanted.includes(record.type));
      const rawTotal=source==='Crossref'?data.message?.['total-results']:source==='Europe PMC'?data.hitCount:source==='DataCite'?data.meta?.total:source==='Internet Archive'?data.response?.numFound:null,total=Number.isFinite(Number(rawTotal))&&rawTotal!==null?Number(rawTotal):null;
      const cursor=source==='Crossref'?data.message?.['next-cursor']:source==='Europe PMC'?data.nextCursorMark:null;
      const customPaged=config.custom&&config.definition.searchUrl.includes('{page}');let done=!items.length;
      if(['Crossref','Europe PMC'].includes(source))done=done||!cursor||(source==='Europe PMC'&&cursor===position.cursor)||items.length<20;
      else if(config.custom)done=done||!customPaged;else done=done||items.length<20||(total!==null&&page*20>=total);
      return {records,total,rawCount:items.length,next:{page:page+1,cursor:typeof cursor==='string'?cursor.slice(0,10000):'',done}};
    }catch(error){if(signal?.aborted)throw error;if(error.name==='AbortError')throw new Error(source+' 查询超时');throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function search(source,query,year,signal,types=['all']){return (await searchPage(source,query,year,signal,types)).records;}
  function merge(existing,incoming){const map=new Map(existing.map(r=>[r.id,r]));for(const r of incoming){const prior=map.get(r.id);if(!prior){map.set(r.id,r);continue;}prior.origins=[...prior.origins,...r.origins.filter(o=>!prior.origins.some(p=>p.source===o.source&&p.url===o.url))];if(!prior.abstract&&r.abstract)prior.abstract=r.abstract;if(!prior.downloadUrl&&r.downloadUrl){prior.downloadUrl=r.downloadUrl;prior.available=true;prior.format=r.format;}prior.score=Math.max(prior.score,r.score);}return [...map.values()];}
  function plan(value,fallback){const types=normalizeTypes(value?.types||value?.type||'all');return {query:text(value?.query||fallback).slice(0,300),topic:text(value?.topic||fallback).slice(0,100),reply:text(value?.reply||'检索条件已整理。'),types,type:types.length===1?types[0]:'all',year:Number.isInteger(value?.year)&&value.year>=1900&&value.year<=2100?value.year:0};}
  function applyRanking(records,value){const ranked=Array.isArray(value?.rankings)?value.rankings:[],map=new Map(records.map(r=>[r.id,r])),seen=new Set();for(const item of ranked){const r=map.get(item.id);if(!r||seen.has(item.id)||!Number.isFinite(item.score))continue;seen.add(item.id);r.score=Math.round(Math.max(0,Math.min(100,item.score)));r.reason=text(item.reason)||'模型未提供匹配理由';r.scoreKind='model';}return records;}
  window.DreamscapeResearch={resourceTypes,sources,registerSource,registerDeclarativeSource,removeDeclarativeSource,testDeclarativeSource,sanitizeDefinition,sourceSupports,normalizeTypes,matchTypes,validType,safeURL,publicURL,text,normalize,requestURL,search,searchPage,merge,plan,applyRanking};
})();
