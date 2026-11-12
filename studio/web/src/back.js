/** 天工的模块注册表与返回路由。
 *
 * 首页是根。每个功能是一个「模块」，挂在首页之上：
 *   kind 'web'    —— 在同一个 WebView 里切换（写 Python、记事本、上课……）
 *   kind 'native' —— 独立的原生页面（扫描相机、浮生图梦修图）。系统返回键
 *                    关掉原生页面后回到首页，原生侧发 moduleReturned。
 *
 * 返回键一次只剥掉一层，顺序固定：
 *   对话框 → 抽屉 → 画画层 → 查找 → 模块自己的子层（上课的时间轴/PPT、
 *   编辑器里的游戏页、模块额外登记的 layers）→ 首页 → 询问是否退出。
 * 首页上再按返回不会掉回编辑器。草稿始终留在本机；只有「保存」写回原文件。
 */
export const BACK={
  DIALOG:'dialog',
  DRAWER:'drawer',
  DRAW:'draw',
  SEARCH:'search',
  LAYER:'layer',
  LECTURE_TAB:'lectureTab',
  EDITOR:'editor',
  HOME:'home',
  EXIT:'exit'
};

export const GROUPS=[
  {id:'study',title:'学习',hint:'课堂、朗读和纸质资料'},
  {id:'create',title:'创作',hint:'代码、文字和照片'},
  {id:'more',title:'助手与休息',hint:'问问题，或者玩一会儿'}
];

/* 顺序即首页顺序。resume 是「接着做」卡片上的标题。 */
export const MODULES=[
  {id:'lecture',group:'study',kind:'web',title:'上课',resume:'继续上课',detail:'录音、笔记、PPT 同一条时间轴',icon:'🎙',tag:'录音'},
  {id:'tts',group:'study',kind:'web',title:'英文朗读',resume:'继续英文朗读',detail:'按句子朗读英文，可调语速',icon:'EN',tag:'离线'},
  {id:'scan',group:'study',kind:'native',title:'扫描文档',resume:'继续扫描文档',detail:'拍书页和讲义，自动裁边，导出 PDF',icon:'▣',tag:'相机',minSdk:29},
  {id:'focus',group:'study',kind:'web',title:'专注番茄',resume:'继续专注',detail:'工作/休息循环，统计今日专注',icon:'🍅',tag:'离线'},
  {id:'cards',group:'study',kind:'web',title:'记忆卡片',resume:'继续记忆卡片',detail:'间隔重复背卡，到期自动提醒复习',icon:'🗂',tag:'离线'},
  {id:'mistakes',group:'study',kind:'web',title:'错题本',resume:'继续错题本',detail:'按科目记错题，标记掌握度',icon:'📕',tag:'离线'},
  {id:'python',group:'create',kind:'web',title:'写代码',resume:'继续写代码',detail:'Python、C++、网页，离线运行',icon:'</>',tag:'离线'},
  {id:'notepad',group:'create',kind:'web',title:'记事本',resume:'继续记事本',detail:'写字、手绘，草稿自动留在本机',icon:'✎',tag:'草稿'},
  {id:'photo',group:'create',kind:'native',title:'修图',resume:'继续修图',detail:'浮生图梦：调色、裁剪、拼图、水印',icon:'◐',tag:'照片'},
  {id:'model',group:'create',kind:'web',title:'3D 建模',resume:'继续 3D 建模',detail:'手机上捏模型，触屏转视角',icon:'◈',tag:'离线'},
  {id:'ai',group:'more',kind:'web',title:'AI 助手',resume:'继续 AI 助手',detail:'对话和手机工具，敏感操作要你点允许',icon:'✧',tag:'联网'},
  {id:'game',group:'more',kind:'web',title:'星火远征',resume:'继续星火远征',detail:'原来的游戏存档还在',icon:'✦',tag:'游戏'},
  {id:'pelican',group:'more',kind:'web',title:'鹈鹕骑车',resume:'继续鹈鹕骑车',detail:'3D 休闲：点按跳跃躲障碍',icon:'🚲',tag:'3D'}
];
/* 旧名字保留给已有调用方。 */
export const HOME_ACTIONS=MODULES;

const IDS=new Set(MODULES.map(item=>item.id));
const WEB_IDS=new Set(MODULES.filter(item=>item.kind==='web').map(item=>item.id));

export function moduleById(id){return MODULES.find(item=>item.id===id)||null;}
export function isNativeModule(id){const m=moduleById(id);return !!m&&m.kind==='native';}
export function modulesInGroup(group){return MODULES.filter(item=>item.group===group);}

/** 原生模块是否能打开。caps 来自原生侧的 capabilities 消息；浏览器预览里没有。 */
export function moduleAvailability(id,caps={}){
  const m=moduleById(id);
  if(!m)return {ok:false,reason:'unknown',message:'没有这个功能。'};
  if(m.kind==='web')return {ok:true,reason:'',message:''};
  const c=caps&&typeof caps==='object'?caps:{};
  const native=c.native===true;
  if(!native){
    if(id==='photo'&&c.browserPhoto===true)return {ok:true,reason:'browser',message:''};
    return {ok:false,reason:'browser',message:m.title+'要在手机安装包里打开。'};
  }
  const sdk=Number(c.sdk)||0;
  if(m.minSdk&&sdk&&sdk<m.minSdk)return {ok:false,reason:'sdk',message:m.title+'需要 Android 10 及以上。'};
  if(c[id]===false)return {ok:false,reason:'missing',message:id==='scan'?'这台设备没有可用的相机。':m.title+'暂时不可用。'};
  return {ok:true,reason:'',message:''};
}

function flag(value){return value===true;}
function normalize(ctx){
  const value=ctx&&typeof ctx==='object'?ctx:{};
  const mode=WEB_IDS.has(value.mode)?value.mode:'';
  const lectureTab=value.lectureTab==='timeline'||value.lectureTab==='slides'?value.lectureTab:'notes';
  const layers=Array.isArray(value.layers)?value.layers.filter(item=>typeof item==='string'&&item):[];
  return {
    dialogOpen:flag(value.dialogOpen),
    drawerOpen:flag(value.drawerOpen),
    drawing:flag(value.drawing),
    searchOpen:flag(value.searchOpen),
    homeOpen:flag(value.homeOpen)||flag(value.landingOpen),
    loungeOpen:flag(value.loungeOpen),
    layers,
    mode,
    lectureTab,
    recording:flag(value.recording),
    running:flag(value.running),
    files:Array.isArray(value.files)?value.files:[],
    activePath:typeof value.activePath==='string'?value.activePath:'',
    resumeMode:IDS.has(value.resumeMode)?value.resumeMode:'',
    exitRequested:flag(value.exitRequested),
    flushed:flag(value.flushed)
  };
}

/** 只判断，不改状态。layers 是模块额外登记的子层，栈顶在前。 */
export function resolveBack(ctx){
  const value=normalize(ctx);
  if(value.dialogOpen)return {action:BACK.DIALOG};
  if(value.homeOpen)return {action:BACK.EXIT};
  if(value.drawerOpen)return {action:BACK.DRAWER};
  if(value.drawing)return {action:BACK.DRAW};
  if(value.searchOpen)return {action:BACK.SEARCH};
  if(value.layers.length)return {action:BACK.LAYER,layer:value.layers[0]};
  if(value.mode==='lecture'&&value.lectureTab!=='notes')return {action:BACK.LECTURE_TAB};
  if(value.loungeOpen&&value.mode!=='game')return {action:BACK.EDITOR};
  return {action:BACK.HOME};
}

/** 一步返回。不丢文件内容。 */
export function stepBack(ctx){
  const current=normalize(ctx);
  const decision=resolveBack(current);
  const next={...current,files:current.files,layers:current.layers.slice()};
  switch(decision.action){
    case BACK.DIALOG:next.dialogOpen=false;break;
    case BACK.DRAWER:next.drawerOpen=false;break;
    case BACK.DRAW:next.drawing=false;break;
    case BACK.SEARCH:next.searchOpen=false;break;
    case BACK.LAYER:next.layers.shift();break;
    case BACK.LECTURE_TAB:next.lectureTab='notes';break;
    case BACK.EDITOR:next.loungeOpen=false;break;
    case BACK.HOME:
      next.homeOpen=true;
      next.resumeMode=current.mode||current.resumeMode;
      next.flushed=true;
      break;
    case BACK.EXIT:
      next.homeOpen=true;
      next.exitRequested=true;
      next.flushed=true;
      break;
    default:break;
  }
  return {action:decision.action,layer:decision.layer,state:next};
}

export function repeatBack(ctx,times=6){
  const trace=[];
  let state=normalize(ctx);
  const limit=Math.max(0,Math.min(12,Math.floor(Number(times)||0)));
  for(let i=0;i<limit;i++){
    const step=stepBack(state);
    trace.push(step.action);
    state=step.state;
  }
  return {trace,state};
}

/** 原生模块关掉以后：留在首页，「接着做」指向它。 */
export function returnFromNative(ctx,id){
  const value=normalize(ctx);
  const known=isNativeModule(id);
  return {...value,homeOpen:true,exitRequested:false,resumeMode:known?id:value.resumeMode};
}

export function unsavedOriginals(files){
  const list=Array.isArray(files)?files:[];
  const out=[];
  for(const file of list){
    if(!file||typeof file.path!=='string'||!file.path)continue;
    if(typeof file.uri!=='string'||!file.uri)continue;
    if(file.text!==file.savedText)out.push(file.path);
  }
  return out;
}

export function leaveWork(ctx){
  const value=normalize(ctx);
  return {
    flush:true,
    keepDrafts:true,
    discardEdits:false,
    dirty:unsavedOriginals(value.files),
    files:value.files,
    resumeMode:value.mode||value.resumeMode,
    homeOpen:true
  };
}

export function exitCopy(files){
  const dirty=unsavedOriginals(files);
  if(!dirty.length)return {title:'退出天工？',message:'草稿会留在本机。还没点「保存」的内容不会写回手机上的原文件。游戏存档、扫描页和修图草稿各自保存。'};
  const shown=dirty.slice(0,3).join('、');
  const more=dirty.length>3?' 等 '+dirty.length+' 个文件':'';
  return {title:'退出天工？',message:'还有修改没写回原文件：'+shown+more+'。草稿会留在本机，点「保存」才会写回。'};
}

export function resumeCard({mode,activePath,dirty=0,fromSession=false}={}){
  const meta=moduleById(mode);
  if(!meta)return {visible:false,mode:'',title:'',detail:'',kind:''};
  if(meta.kind==='native'){
    const tail=meta.id==='scan'?'拍好的页面留在扫描相机里':'没导出的照片草稿留在修图里';
    return {visible:true,mode:meta.id,kind:'native',title:meta.resume,detail:meta.detail+' · '+tail};
  }
  const where=activePath&&meta.id!=='game'&&meta.id!=='ai'?activePath:meta.detail;
  const count=Math.max(0,Math.floor(Number(dirty)||0));
  const extra=count>0?'有 '+count+' 处修改还没写回原文件':(fromSession?'刚才的内容还在':'草稿留在本机');
  return {visible:true,mode:meta.id,kind:'web',title:meta.resume,detail:where+' · '+extra};
}

/** 切换模块前的保护：录音中只能回首页或留在上课；运行代码时不切到别的编辑类模块或原生页面。 */
export function canLeaveMode({recording=false,running=false,to=''}={}){
  if(to==='home')return {ok:true,flush:true,reason:''};
  if(recording&&to!=='lecture')return {ok:false,flush:false,reason:'recording'};
  if(running&&(to==='python'||to==='notepad'||to==='lecture'||to==='tts'||to==='ai'||to==='model'||isNativeModule(to)))return {ok:false,flush:false,reason:'running'};
  return {ok:true,flush:true,reason:''};
}
