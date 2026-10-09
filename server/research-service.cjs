'use strict';
const https=require('node:https');
const http=require('node:http');
const dns=require('node:dns').promises;
const fs=require('node:fs');
const path=require('node:path');
const ipaddr=require('ipaddr.js');
const cheerio=require('cheerio');
const LIMIT=64*1024*1024, PAGE_LIMIT=4*1024*1024;
const EXTENSIONS={paper:['pdf','xml','txt'],report:['pdf','txt','xml'],book:['pdf','epub','txt'],dataset:['csv','json','zip','xml','parquet','nc','tif','xlsx'],video:['mp4','webm','mkv','mov'],audio:['mp3','m4a','ogg','flac','wav'],image:['jpg','jpeg','png','tif','tiff','jp2','svg'],software:['zip','7z','tar.gz','iso'],web:['html','htm','warc.gz'],other:['pdf','zip','csv','json','txt','xml','mp4','mp3']};
EXTENSIONS.all=[...new Set(Object.values(EXTENSIONS).flat())];
class ServiceError extends Error{constructor(message,code='unavailable',status=422){super(message);this.code=code;this.status=status;}}
function publicAddress(address){try{let parsed=ipaddr.parse(address);if(parsed.kind()==='ipv6'&&parsed.isIPv4MappedAddress())parsed=parsed.toIPv4Address();return parsed.range()==='unicast';}catch{return false;}}
function publicURL(value,base){let url;try{url=new URL(value,base);}catch{throw new ServiceError('文件地址无效','invalid_url');}if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new ServiceError('仅支持公开 HTTPS 地址','blocked_url');const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.includes('%')||(ipaddr.isValid(host)&&!publicAddress(host)))throw new ServiceError('不允许访问本机或私网地址','blocked_url');url.hash='';return url;}
function extension(value){let name=String(value||'').toLowerCase();try{name=decodeURIComponent(new URL(name).pathname);}catch{}return [...new Set(Object.values(EXTENSIONS).flat())].sort((a,b)=>b.length-a.length).find(ext=>name.endsWith('.'+ext))||'';}
function statusError(status){if(status===401)return new ServiceError('来源需要登录','needs_login');if(status===403||status===429)return new ServiceError(`来源限制访问（HTTP ${status}）`,'restricted');return new ServiceError(`来源请求失败（HTTP ${status}）`,'upstream');}
// Validate every DNS answer, pin the chosen address, and repeat for each redirect.
async function fetchPublic(value,{signal,maxBytes=PAGE_LIMIT,probe=false,redirects=0,onChunk}={}){
  const url=publicURL(value),host=url.hostname.replace(/^\[|\]$/g,'');signal?.throwIfAborted();
  const lookup=dns.lookup(host,{all:true,verbatim:true});
  const addresses=await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});lookup.then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));});
  signal?.throwIfAborted();if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new ServiceError('来源域名解析到非公开地址','blocked_url');
  const selected=addresses.find(item=>item.family===4)||addresses[0];
  const result=await new Promise((resolve,reject)=>{
    const req=https.request(url,{method:'GET',agent:false,signal,lookup:(hostname,options,callback)=>options?.all?callback(null,[selected]):callback(null,selected.address,selected.family),headers:{'User-Agent':'DreamscapeResearch/0.4 (+public-resource-discovery)','Accept-Encoding':'identity',...(probe?{Range:'bytes=0-8191'}:{})}},res=>{
      const status=res.statusCode||0,headers=res.headers;
      if([301,302,303,307,308].includes(status)){res.resume();resolve({redirect:headers.location});return;}
      if(status<200||status>=300){res.resume();reject(statusError(status));return;}
      if(!probe&&Number(headers['content-length'])>maxBytes){res.destroy();reject(new ServiceError('响应超过大小限制','too_large'));return;}
      let size=0,settled=false,streaming=false;const chunks=[];
      const emit=chunk=>onChunk(chunk,{url:url.href,status,headers});
      const finish=()=>{if(settled)return;try{if(onChunk&&!streaming){emit(Buffer.concat(chunks));chunks.length=0;}settled=true;resolve({url:url.href,status,headers,bytes:onChunk?Buffer.alloc(0):Buffer.concat(chunks,size)});}catch(error){settled=true;reject(error);res.destroy();}};
      res.on('data',chunk=>{if(settled)return;try{const keep=probe?Math.min(chunk.length,8192-size):chunk.length;size+=keep;if(!probe&&size>maxBytes)throw new ServiceError('响应超过大小限制','too_large');if(keep>0){if(onChunk&&streaming)emit(chunk.subarray(0,keep));else chunks.push(chunk.subarray(0,keep));}if(onChunk&&!streaming&&size>=512){emit(Buffer.concat(chunks));chunks.length=0;streaming=true;}if(probe&&size>=8192){finish();res.destroy();}}catch(error){settled=true;res.destroy();reject(error);}});
      res.on('end',finish);res.on('error',error=>{if(!settled)reject(error);});res.on('aborted',()=>{if(!settled)reject(new ServiceError('来源传输中断','upstream'));});
    });
    req.setTimeout(15000,()=>req.destroy(new ServiceError('来源请求超时','timeout')));req.on('error',reject);req.end();
  });
  if(Object.hasOwn(result,'redirect')){if(!result.redirect||redirects>=4)throw new ServiceError('来源重定向次数过多或缺少地址','redirect');return fetchPublic(publicURL(result.redirect,url).href,{signal,maxBytes,probe,redirects:redirects+1,onChunk});}
  return result;
}
function extractCandidates(html,base,type='other'){
  const $=cheerio.load(html),rows=[],seen=new Set();const allowed=EXTENSIONS[type]||EXTENSIONS.other;
  function add(value,reason,declared=''){if(typeof value!=='string'||!value.trim())return;let url;try{url=publicURL(value,base).href;}catch{return;}if(seen.has(url)||rows.length>=60)return;const ext=extension(url),mime=declared.toLowerCase();if(!ext&&!/(pdf|video|audio|image|octet-stream|zip|xml|csv)/.test(mime)&&reason==='链接')return;if(ext&&!allowed.includes(ext)&&reason==='链接')return;seen.add(url);rows.push({url,format:ext.toUpperCase(),reason,score:(allowed.includes(ext)?100:0)+(reason==='文献元数据'?50:0)});}
  $('meta').each((i,el)=>{const key=($(el).attr('name')||$(el).attr('property')||'').toLowerCase();if(['citation_pdf_url','eprints.document_url','wkhealth_pdf_url'].includes(key))add($(el).attr('content'),'文献元数据','application/pdf');if(/^(og:(video|audio|image)(:url|:secure_url)?|twitter:player:stream)$/.test(key))add($(el).attr('content'),'媒体元数据');});
  $('a[href],link[href]').each((i,el)=>add($(el).attr('href'),$(el).attr('download')!==undefined?'下载附件':'链接',$(el).attr('type')||''));
  $('video[src],audio[src],source[src]').each((i,el)=>add($(el).attr('src'),'媒体元素',$(el).attr('type')||''));
  function walk(value,depth=0){if(!value||depth>10)return;if(Array.isArray(value)){value.slice(0,60).forEach(v=>walk(v,depth+1));return;}if(typeof value!=='object')return;for(const key of ['contentUrl','downloadUrl'])add(value[key],'结构化数据',value.encodingFormat||'');for(const [key,v]of Object.entries(value).slice(0,60))if(!['contentUrl','downloadUrl'].includes(key))walk(v,depth+1);}
  $('script[type="application/ld+json"]').each((i,el)=>{try{walk(JSON.parse($(el).text()));}catch{}});
  return rows.sort((a,b)=>b.score-a.score);
}
function fileInfo(response,expected=''){
  const mime=String(response.headers['content-type']||'').split(';')[0].toLowerCase(),prefix=response.bytes.subarray(0,512).toString('utf8').trimStart();
  if(/text\/html|xhtml/.test(mime)||/^(?:<!doctype html|<html|<head|<body)/i.test(prefix))throw new ServiceError('地址返回网页，未取得文件','not_file');
  if(!response.bytes.length)throw new ServiceError('文件正文为空','not_file');
  let format=extension(response.url)||String(expected||'').toLowerCase();
  if(response.bytes.subarray(0,5).toString()==='%PDF-')format='pdf';
  if((format==='pdf'||mime==='application/pdf')&&response.bytes.subarray(0,5).toString()!=='%PDF-')throw new ServiceError('返回内容不是有效 PDF','not_file');
  if(mime.includes('json')){try{const value=JSON.parse(response.bytes.toString());if(value.error||value.errors)throw new ServiceError('文件地址返回 API 错误','not_file');}catch(error){if(error instanceof ServiceError)throw error;}}
  if(!format){const map={'application/pdf':'pdf','application/xml':'xml','text/xml':'xml','text/plain':'txt','text/csv':'csv','application/json':'json','application/zip':'zip','video/mp4':'mp4','audio/mpeg':'mp3','image/jpeg':'jpg','image/png':'png'};format=map[mime]||'bin';}
  const range=String(response.headers['content-range']||'').match(/\/(\d+)$/),size=range?Number(range[1]):Number(response.headers['content-length'])||0;
  return {url:response.url,format:format.toUpperCase(),sizeBytes:size,size:size?`${Math.round(size/1024/1024*100)/100} MB`:'大小未知',externalOnly:size>LIMIT,verified:true,contentType:mime};
}
async function discoverResource(resource,{signal,fetcher=fetchPublic}={}){
  const type=Object.hasOwn(EXTENSIONS,resource.type)?resource.type:'other',candidates=[],attempts=[];let sourceURL=resource.url;
  const add=(url,reason,format='',size=0)=>{try{const safe=publicURL(url).href;if(!candidates.some(c=>c.url===safe))candidates.push({url:safe,reason,format,size});}catch{}};
  const json=async url=>{const result=await fetcher(url,{signal});return JSON.parse(result.bytes.toString());};
  if(resource.downloadUrl)add(resource.downloadUrl,'已有文件地址',resource.format);
  for(const origin of (Array.isArray(resource.origins)?resource.origins:[]).slice(0,8))if(origin.downloadUrl)add(origin.downloadUrl,'备用来源文件');
  try{
    const page=publicURL(sourceURL),archive=page.hostname==='archive.org'&&page.pathname.match(/^\/details\/([^/]+)/),zenodo=page.hostname==='zenodo.org'&&page.pathname.match(/^\/records?\/(\d+)/);
    if(archive){const data=await json(`https://archive.org/metadata/${encodeURIComponent(decodeURIComponent(archive[1]))}`);const files=(Array.isArray(data.files)?data.files:[]).filter(f=>f.private!==true&&f.private!=='true'&&(EXTENSIONS[type]||[]).includes(extension(f.name))).sort((a,b)=>((Number(b.size)>0&&Number(b.size)<=LIMIT?10000:0)+(b.source==='original'?1000:0))-((Number(a.size)>0&&Number(a.size)<=LIMIT?10000:0)+(a.source==='original'?1000:0)));for(const file of files.slice(0,8))add(`https://archive.org/download/${archive[1]}/${String(file.name).split('/').map(encodeURIComponent).join('/')}`,'Internet Archive 文件清单',extension(file.name),Number(file.size)||0);}
    else if(zenodo){const data=await json(`https://zenodo.org/api/records/${zenodo[1]}`);for(const file of (data.files||[]).filter(f=>(EXTENSIONS[type]||[]).includes(extension(f.key))).sort((a,b)=>(Number(b.size)<=LIMIT?1:0)-(Number(a.size)<=LIMIT?1:0)).slice(0,20))add(file.links?.content||file.links?.self,'Zenodo 文件清单',extension(file.key),file.size);}
    else if(type==='paper'&&(resource.doi||/(^|\.)europepmc\.org$/.test(page.hostname))){let query=resource.doi?`DOI:${resource.doi}`:'';const match=page.pathname.match(/^\/article\/([A-Za-z]+)\/([\w.-]+)/);if(!query&&match)query=match[1].toUpperCase()==='PMC'?`PMCID:${match[2]}`:`EXT_ID:${match[2]} AND SRC:${match[1]}`;if(query){const data=await json(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`);const article=data.resultList?.result?.[0];for(const link of article?.fullTextUrlList?.fullTextUrl||[])if((link.availabilityCode==='OA'||article?.isOpenAccess==='Y'&&link.availabilityCode==='F')&&link.documentStyle==='pdf')add(link.url,'Europe PMC 开放文件','pdf');if(article?.isOpenAccess==='Y'&&/^PMC\d+$/.test(article.pmcid))add(`https://www.ebi.ac.uk/europepmc/webservices/rest/${article.pmcid}/fullTextXML`,'Europe PMC 开放全文 XML','xml');}}
  }catch(error){if(signal?.aborted)throw error;attempts.push({stage:'metadata',code:error.code||'upstream',message:error.message});}
  let scanned=false;
  async function scan(){if(scanned||!sourceURL)return;scanned=true;try{const page=await fetcher(publicURL(sourceURL).href,{signal});for(const item of extractCandidates(page.bytes.toString(),page.url,type))add(item.url,item.reason,item.format);}catch(error){if(signal?.aborted)throw error;attempts.push({stage:'page',code:error.code||'upstream',message:error.message});}}
  if(!candidates.length)await scan();
  for(let i=0;i<Math.min(candidates.length,10);i++){
    const candidate=candidates[i];try{const response=await fetcher(candidate.url,{signal,probe:true,maxBytes:8192}),info=fileInfo(response,candidate.format);if(type!=='other'&&!EXTENSIONS[type].includes(info.format.toLowerCase()))throw new ServiceError('候选文件与资料类型不符','wrong_type');return {...info,discovery:candidate.reason,attempts};}
    catch(error){if(signal?.aborted)throw error;attempts.push({stage:'verify',url:candidate.url,code:error.code||'upstream',message:error.message});if(i===candidates.length-1&&!scanned)await scan();}
  }
  const special=attempts.find(a=>a.code==='needs_login')||attempts.find(a=>a.code==='restricted'),network=attempts.find(a=>['ETIMEDOUT','timeout','ABORT_ERR','ENOTFOUND','ECONNRESET'].includes(a.code));return {status:special?.code||(network?'timeout':'not_found'),message:special?.message||(network?'来源连接超时或中断，未完成文件发现':'未发现可验证的公开文件'),attempts};
}
async function inspectPage(value,{signal,fetcher=fetchPublic,keywords=''}={}){
  const address=publicURL(value).href,response=await fetcher(address,{signal,maxBytes:PAGE_LIMIT});signal?.throwIfAborted();
  const mime=String(response.headers['content-type']||'');if(!/html|xhtml/.test(mime))throw new ServiceError('候选地址未返回可采集的 HTML 页面','not_page');
  const $=cheerio.load(response.bytes.toString()),base=response.url||address,clean=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,12000);
  const title=clean($('meta[property="og:title"]').attr('content')||$('title').first().text()||$('h1').first().text());if(!title)throw new ServiceError('页面没有可验证的标题','invalid_page');
  const description=clean($('meta[name="description"]').attr('content')||$('meta[property="og:description"]').attr('content')||$('main p,article p').first().text()).slice(0,2400);
  const links=[],seen=new Set(),tokens=String(keywords).toLowerCase().split(/[\s,，]+/).filter(v=>v.length>2).slice(0,12);
  $('a[href]').each((i,el)=>{if(links.length>=150)return;let url;try{url=publicURL($(el).attr('href'),base);}catch{return;}const label=clean($(el).text()).slice(0,200);if(url.origin!==new URL(base).origin||seen.has(url.href)||extension(url.href)||url.href===base||/login|logout|signin|signup|privacy|terms/i.test(url.pathname))return;seen.add(url.href);links.push({url:url.href,label,score:tokens.filter(t=>(label+' '+url.pathname).toLowerCase().includes(t)).length});});
  const formats={pdf:'paper',xml:'paper',epub:'book',mp4:'video',webm:'video',mkv:'video',mov:'video',mp3:'audio',m4a:'audio',wav:'audio',flac:'audio',ogg:'audio',jpg:'image',jpeg:'image',png:'image',svg:'image',tif:'image',tiff:'image',jp2:'image',csv:'dataset',json:'dataset',xlsx:'dataset',parquet:'dataset',nc:'dataset',zip:'other'};
  const files=extractCandidates(response.bytes.toString(),base,'all').slice(0,12).map(file=>({...file,type:formats[file.format.toLowerCase()]||'other',label:clean(new URL(file.url).pathname.split('/').at(-1)||'文件')}));
  return {url:base,title,description,license:clean($('link[rel="license"]').attr('href')||''),links:links.sort((a,b)=>b.score-a.score).slice(0,12),files,checkedAt:new Date().toISOString()};
}
function createServer({root=path.resolve(__dirname,'..'),fetcher=fetchPublic,origin=process.env.SITE_ORIGIN||process.env.RENDER_EXTERNAL_URL||'',maxActive=4}={}){
  let active=0;
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');const json=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    let target;try{target=new URL(req.url,'http://localhost');}catch{return json(400,{error:'请求地址无效'});}
    if(target.pathname.startsWith('/api/research/')){
      const host=req.headers.host||'',allowed=origin?new URL(origin).host:/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)?host:'';
      if(!allowed||host!==allowed||(req.headers.origin&&req.headers.origin!==(origin||`http://${host}`)))return json(403,{error:'来源未获允许',code:'origin'});
      if(target.pathname==='/api/research/health'&&req.method==='GET')return json(200,{service:'dreamscape-research',version:1,maxFileBytes:LIMIT});
      if(req.method!=='POST'||req.headers['x-research-client']!=='1'||!String(req.headers['content-type']).startsWith('application/json'))return json(400,{error:'请求格式不正确'});
      if(!['resolve','download','source','inspect'].includes(target.pathname.split('/').at(-1)))return json(404,{error:'接口不存在'});
      if(active>=maxActive)return json(429,{error:'采集服务繁忙，请稍后重试',code:'busy'});active++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new ServiceError('采集任务超时','timeout')),target.pathname.endsWith('/download')?300000:55000);res.on('close',()=>{if(!res.writableEnded)controller.abort();});req.on('aborted',()=>controller.abort());
      try{
        req.setTimeout(10000,()=>req.destroy());const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)throw new ServiceError('请求内容过大','invalid_request',413);chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ServiceError('请求 JSON 无效','invalid_request',400);}if(!data||typeof data!=='object')throw new ServiceError('请求内容无效','invalid_request',400);
        req.setTimeout(0);const action=target.pathname.split('/').at(-1),signal=controller.signal;
        if(action==='resolve')return json(200,await discoverResource(data,{signal,fetcher}));
        if(action==='inspect')return json(200,await inspectPage(data.url,{signal,fetcher,keywords:String(data.keywords||'').slice(0,300)}));
        if(action==='source'){const upstream=await fetcher(data.url,{signal,maxBytes:PAGE_LIMIT});let body;try{body=JSON.parse(upstream.bytes.toString());}catch{throw new ServiceError('来源未返回有效 JSON','invalid_response');}return json(200,body);}
        let started=false;
        const write=(bytes,meta)=>{if(!started){const info=fileInfo({...meta,bytes},data.format);if(info.externalOnly)throw new ServiceError('文件超过 64 MB，请直接打开文件地址','too_large');res.writeHead(200,{'Content-Type':info.contentType||'application/octet-stream','Cache-Control':'no-store','X-Research-Format':info.format,'Content-Disposition':'attachment',...(meta.headers['content-length']?{'Content-Length':meta.headers['content-length']}:{})});started=true;}res.write(bytes);};
        const upstream=await fetcher(data.url,{signal,maxBytes:LIMIT,onChunk:write});
        // Injected fixture transports may return a complete buffer instead of streaming.
        if(!started)write(upstream.bytes,upstream);res.end();

      }catch(error){if(res.headersSent){res.destroy();return;}json(error.status||502,{error:controller.signal.aborted?'采集任务已取消或超时':error instanceof ServiceError?error.message:'来源连接失败，请稍后重试',code:controller.signal.aborted?'timeout':error.code||'upstream'});}finally{clearTimeout(timer);active--;}
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
    const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.md':'text/markdown; charset=utf-8'};
    let name;try{name=decodeURIComponent(target.pathname);}catch{res.writeHead(400);return res.end();}if(name==='/')name='/index.html';const file=path.resolve(root,'.'+name),relative=path.relative(root,file),publicDoc=['docs/research-workbench.md','docs/research-service.md','docs/research-roadmap.md','docs/research-collection.md'].includes(relative.split(path.sep).join('/'));
    if(!file.startsWith(root+path.sep)||relative.split(path.sep).some(part=>part.startsWith('.')||(['node_modules','server','tests'].includes(part)||(part==='docs'&&!publicDoc)))||!mime[path.extname(file)]||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  });
}
if(require.main===module){const server=createServer();server.listen(Number(process.env.PORT)||8787,process.env.HOST||'127.0.0.1',()=>console.log(`Dreamscape research: http://${process.env.HOST||'127.0.0.1'}:${server.address().port}/research.html`));}
module.exports={LIMIT,ServiceError,publicAddress,publicURL,fetchPublic,extractCandidates,fileInfo,discoverResource,inspectPage,createServer};
