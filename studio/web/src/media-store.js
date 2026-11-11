/* 课堂模式的媒体外置存储。
   录音和 PPT 图片原来都塞在工作区 JSON 里，而工作区快照的上限是 32 MB：
   2 小时录音（约 14 MB）+ 50 页 PPT（每页最坏 6 MB）很容易触顶，触顶后整份
   草稿会被静默丢弃。现在媒体写进应用私有目录 lecture-media/，工作区 JSON
   只留一个几十字节的引用；原生通道不可用时（浏览器预览）退回 data URL，
   行为和旧版完全一致。

   约定：
   - ref 是 data:/blob: 开头时原样使用；否则是相对路径，拼到 assetBase() 后
     用同源 URL 读取。
   - putMedia 在原生可用时走 StudioBridge.mediaPut（异步回执 mediaSaved），
     失败抛错，由调用方决定是回退内嵌还是提示用户。
   - 音频要能拖动进度条，必须靠 fetch → blob 播放（本地资源服务不支持 Range）。 */

const PREFIX='lecture-media/';
const PUT_TIMEOUT=30000;
const MAX_PUT=48*1024*1024;   // base64 字符串上限，超了直接拒绝，避免 OOM

let hooks=null;               // {native:()=>bool, send:(type,payload)=>void}
const pending=new Map();      // id -> {resolve,reject,timer}
const urls=new Map();         // ref -> objectURL
const loading=new Map();      // ref -> Promise<objectURL>
const generations=new Map();  // ref -> 加载代数，release/重新加载都会递增，让在途请求作废
let seq=0;

export function initMediaStore(h){hooks=h||null;}

export function mediaNative(){
  try{return !!(hooks&&typeof hooks.native==='function'&&hooks.native());}catch(e){return false;}
}

/* 页面固定是 <base>studio/index.html，剥掉这段就是资源根路径
   （appassets 源是 /，本机资源服务是 /<token>/）。 */
export function assetBase(){
  const path=(typeof location!=='undefined'&&location.pathname)||'/';
  const tail='studio/index.html';
  if(path.length>tail.length&&path.endsWith(tail))return location.origin+path.slice(0,path.length-tail.length);
  const cut=path.lastIndexOf('/');
  return location.origin+(cut>=0?path.slice(0,cut+1):'/');
}

export function mediaPath(ref){
  const text=String(ref||'');
  return /^(?:data:|blob:|https?:)/i.test(text)?'':text.replace(/^\/+/,'');
}

/* 同步解析成可以直接放进 <img src> 的地址（图片不需要分段读取）。 */
export function mediaUrl(ref){
  const text=String(ref||'');
  if(!text)return '';
  if(/^(?:data:|blob:|https?:)/i.test(text))return text;
  return assetBase()+text.replace(/^\/+/,'');
}

function mediaName(name,mime){
  const type=String(mime||'');
  const ext=type.indexOf('audio/webm')===0?'.webm'
    :type==='audio/mp4'?'.m4a'
    :type==='audio/ogg'?'.ogg'
    :type==='image/png'?'.png'
    :type==='image/webp'?'.webp'
    :type==='image/jpeg'?'.jpg':'';
  let base=String(name||'').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,60);
  if(ext){
    if(!base.toLowerCase().endsWith(ext))base=base.replace(/\.[A-Za-z0-9]{1,6}$/,'')+ext;
  }
  if(!base||base==='.'||base.indexOf('.')===0)base='media-'+Date.now()+ext;
  return base;
}

/* base64（不带 data: 前缀）→ ref。浏览器预览直接返回 data URL。 */
export function putMedia(base64,mime,name){
  const data=String(base64||'');
  const type=String(mime||'application/octet-stream');
  if(!data)return Promise.reject(new Error('媒体数据为空'));
  if(data.length>MAX_PUT)return Promise.reject(new Error('单个媒体文件超过 '+(MAX_PUT/1024/1024|0)+' MB'));
  if(!mediaNative())return Promise.resolve('data:'+type+';base64,'+data);
  const id='m'+(++seq)+'-'+Date.now();
  const file=mediaName(name,type);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('保存媒体超时'));},PUT_TIMEOUT);
    pending.set(id,{resolve,reject,timer});
    try{
      hooks.send('mediaPut',{id,name:file,mime:type,data});
    }catch(e){
      clearTimeout(timer);pending.delete(id);
      reject(e instanceof Error?e:new Error(String((e&&e.message)||e||'写入失败')));
    }
  });
}

/* 原生回执分发：app.js 收到未知类型时转进来。 */
export function mediaMessage(m){
  if(!m)return false;
  if(m.type!=='mediaSaved'&&m.type!=='audioSaved'&&m.type!=='audioStarted')return false;
  const job=pending.get(m.id);
  if(!job)return true;
  pending.delete(m.id);
  clearTimeout(job.timer);
  if(m.ok&&(m.ref||m.type==='audioStarted'))job.resolve(m.type==='audioSaved'?{ref:String(m.ref||''),bytes:Number(m.bytes)||0}:String(m.ref||''));
  else job.reject(new Error(m.message||'媒体写入失败'));
  return true;
}

/* 录音流式落盘：录音期间每秒一片按序追加进同一个文件，结束时关流。
   以前是「停止后把 2 小时音频整段转 base64、一次性过桥」，19 MB 字符串在
   JS 里 stringify、在 Java 里 new JSONObject 都在主线程上，界面会卡一下；
   检查点还每 45 秒把全量重写一遍，超时就退回内嵌，直接撞 30 MB 快照上限。

   这里返回的对象直接交给 AudioEngine.attachSink()：
   - chunk(blob) 排队写入（按调用顺序串行，保证 webm 分片顺序）
   - end() 等在途分片写完再关流，回执里带最终引用
   - abort() 放弃这次录音（音频没开始就失败时用，空的会被宿主删掉） */
export function beginAudio(name,mime){
  const file=mediaName(name,mime);
  const id='au'+(++seq)+'-'+Date.now(),endId=id+'-end';
  const ref=PREFIX+file;
  const type=String(mime||'audio/webm');
  let chain=Promise.resolve(),failure=null;
  const send=(kind,extra)=>{
    try{
      if(!mediaNative())throw new Error('原生通道不可用');
      hooks.send(kind,Object.assign({id},extra));
    }catch(err){failure=failure||err;}
  };
  if(mediaNative()){
    const job=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('录音文件创建超时'));},PUT_TIMEOUT);
      pending.set(id,{resolve,reject,timer});
    });
    send('audioBegin',{id,name:file,mime:type});
    job.catch(err=>{failure=failure||err;/* 创建失败会在第一个 chunk/end 上报出来 */});
  }
  return {
    ref,
    chunk(blob){
      chain=chain.then(()=>blob.arrayBuffer()).then(buffer=>{
        if(!buffer||!buffer.byteLength)return;
        if(failure)return;   // 文件没建起来，别再往不存在的流里写
        send('audioChunk',{data:bytesToBase64(new Uint8Array(buffer))});
      }).catch(err=>{failure=failure||err;});
      return chain;
    },
    end(){
      return chain.then(()=>new Promise((resolve,reject)=>{
        if(failure)throw failure;
        const timer=setTimeout(()=>{pending.delete(endId);reject(new Error('录音落盘超时'));},PUT_TIMEOUT);
        pending.set(endId,{resolve,reject,timer});
        hooks.send('audioEnd',{id:endId,sinkId:id});
      })).then(result=>({ref:(result&&result.ref)||ref,bytes:(result&&result.bytes)||0}));
    },
    abort(){
      /* 先记失败，分片回调里才能马上停。只清定时器的话，创建回执的 Promise
         永远不会结束，定时器被清掉之后也不会再有人把它 reject。 */
      failure=failure||new Error('录音已放弃');
      try{if(mediaNative())hooks.send('audioAbort',{id});}catch(err){/* 已经没了 */}
      const drop=key=>{
        const job=pending.get(key);
        if(!job)return;
        pending.delete(key);
        if(job.timer)clearTimeout(job.timer);
        job.reject(failure);
      };
      drop(id);drop(endId);
    }
  };
}

/* 分片（几 KB）转 base64：切片避免 btoa 参数过长。 */
function bytesToBase64(bytes){
  let text='';
  const STEP=0x8000;
  for(let i=0;i<bytes.length;i+=STEP)text+=String.fromCharCode.apply(null,bytes.subarray(i,i+STEP));
  return btoa(text);
}

/* 异步解析成可播放的 blob URL（音频必须走这条，才能拖动进度）。 */
export function resolveMedia(ref,mimeHint){
  const text=String(ref||'');
  if(!text)return Promise.reject(new Error('没有媒体引用'));
  if(/^(?:data:|blob:)/i.test(text))return Promise.resolve(text);
  const known=urls.get(text);
  if(known)return Promise.resolve(known);
  const busy=loading.get(text);
  if(busy)return busy;
  const gen=(generations.get(text)||0)+1;
  generations.set(text,gen);
  const job=fetch(mediaUrl(text)).then(res=>{
    if(!res.ok)throw new Error('读取媒体失败（HTTP '+res.status+'）');
    return res.arrayBuffer();
  }).then(buffer=>{
    if(!buffer.byteLength)throw new Error('媒体文件为空');
    const type=mimeHint||guessType(text);
    const url=URL.createObjectURL(new Blob([buffer],{type}));
    /* fetch 期间被 release 或起了更新的加载：这个 URL 没人要了，立刻回收，
       不进缓存，并 reject 让调用方别拿去播放。 */
    if(generations.get(text)!==gen){
      try{URL.revokeObjectURL(url);}catch(e){/* 已释放 */}
      throw new Error('媒体引用已释放');
    }
    urls.set(text,url);
    return url;
  }).catch(err=>{
    if(loading.get(text)===job)loading.delete(text);
    throw err;
  }).then(url=>{if(loading.get(text)===job)loading.delete(text);return url;});
  loading.set(text,job);
  return job;
}

function guessType(path){
  const lower=String(path).toLowerCase();
  if(lower.endsWith('.webm'))return 'audio/webm';
  if(lower.endsWith('.m4a'))return 'audio/mp4';
  if(lower.endsWith('.ogg'))return 'audio/ogg';
  if(lower.endsWith('.png'))return 'image/png';
  if(lower.endsWith('.webp'))return 'image/webp';
  if(lower.endsWith('.jpg')||lower.endsWith('.jpeg'))return 'image/jpeg';
  return 'application/octet-stream';
}

export function releaseMedia(ref){
  const text=String(ref||'');
  generations.set(text,(generations.get(text)||0)+1);
  const url=urls.get(text);
  if(url){try{URL.revokeObjectURL(url);}catch(e){/* 已释放 */}urls.delete(text);}
  loading.delete(text);
}

export function releaseAllMedia(){
  for(const ref of [...urls.keys()])releaseMedia(ref);
}

export function deleteMedia(ref){
  const path=mediaPath(ref);
  releaseMedia(ref);
  if(!path||path.indexOf(PREFIX)!==0||!mediaNative())return;
  try{hooks.send('mediaDelete',{ref:path});}catch(e){/* 删不掉不影响主流程 */}
}

/* 恢复工作区后清理目录里没人引用的文件，避免换课/重录留下的垃圾一直占空间。 */
export function collectMedia(refs){
  if(!mediaNative())return;
  const names=[];
  for(const ref of refs||[]){
    const path=mediaPath(ref);
    if(path&&path.indexOf(PREFIX)===0)names.push(path.slice(PREFIX.length()));
  }
  try{hooks.send('mediaGc',{keep:names});}catch(e){/* 忽略 */}
}
