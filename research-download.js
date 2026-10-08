(function(){
  'use strict';
  const LIMIT=64*1024*1024;
  function filename(title,format){const clean=String(title||'resource').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'resource';const ext=({pdf:'pdf',csv:'csv',json:'json',geotiff:'tif',netcdf:'nc',zip:'zip'})[String(format).toLowerCase()]||'bin';return `${clean}.${ext}`;}
  async function fetchFile(resource,onProgress,signal){
    const url=DreamscapeResearch.safeURL(resource.downloadUrl);if(!url)throw new Error('来源没有提供直接文件地址');
    const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal});
    if(!response.ok)throw new Error(`文件请求失败（HTTP ${response.status}）`);
    const type=(response.headers.get('content-type')||'').toLowerCase();
    if(type.includes('text/html')||type.includes('xhtml'))throw new Error('地址返回网页，请从来源页获取文件');
    const total=Number(response.headers.get('content-length'))||0;if(total>LIMIT){await response.body?.cancel();throw new Error('文件超过 64 MB，请使用文件地址直接获取');}
    let bytes;
    if(response.body){
      const reader=response.body.getReader(),chunks=[];let received=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>LIMIT)throw new Error('文件超过 64 MB，请使用文件地址直接获取');chunks.push(value);onProgress?.({received,total});}bytes=new Uint8Array(received);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }else bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>LIMIT)throw new Error('文件超过 64 MB，请使用文件地址直接获取');
    if(!bytes.length)throw new Error('文件正文为空');
    if(String(resource.format).toUpperCase()==='PDF'&&new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('返回内容不是 PDF，请检查来源页');
    return {name:filename(resource.title,resource.format),bytes,type:type||'application/octet-stream'};
  }
  function save(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  // ZIP STORE avoids a dependency and preserves original files without recompression.
  function zip(files){
    if(files.reduce((n,f)=>n+f.bytes.length,0)>LIMIT)throw new Error('合集超过 64 MB，请分批下载');
    const encoder=new TextEncoder(),locals=[],central=[];let offset=0;
    files.forEach((file,index)=>{
      const name=encoder.encode(`${String(index+1).padStart(2,'0')}-${file.name}`),crc=crc32(file.bytes),size=file.bytes.length;
      const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,crc,true);h.setUint32(18,size,true);h.setUint32(22,size,true);h.setUint16(26,name.length,true);header.set(name,30);locals.push(header,file.bytes);
      const entry=new Uint8Array(46+name.length),v=new DataView(entry.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=header.length+size;
    });
    const centralSize=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
    const result=new Uint8Array(offset+centralSize+22);let p=0;for(const block of [...locals,...central,end]){result.set(block,p);p+=block.length;}return result;
  }
  window.DreamscapeDownload={LIMIT,filename,fetchFile,save,zip,crc32};
})();
