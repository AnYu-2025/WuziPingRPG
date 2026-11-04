/* 上课模式：录音 + 时间戳笔记 + 锚点 + PPT 照片，按时间轴同步。
   数据保存在工作区 state.lecture，随草稿自动保存/恢复；全部离线。
   - CodeMirror 扩展：行首时间戳 gutter、播放高亮、点击行跳转
   - AudioEngine：录音 + 能量 VAD 自动锚点；Playback：blob 回放
   - Timeline：canvas 波形 + 播放头 + 缩放 */

import {StateField,StateEffect} from '@codemirror/state';
import {gutter,GutterMarker,Decoration,EditorView} from '@codemirror/view';
import {AudioEngine,Playback,blobToBase64,fmt} from './audio-engine.js';
import {Timeline} from './timeline.js';

const NOTES_PATH='课堂笔记.md';
const MAX_SLIDES=50,SLIDE_MAX_W=1024,SLIDE_QUALITY=0.8;

/* ---------------- CodeMirror 时间戳标注 ---------------- */

const setStamps=StateEffect.define();    // [{pos,time}] 全量替换
const setPlayLine=StateEffect.define();  // 当前播放对应行首 pos | null

class TimeMark extends GutterMarker{
  constructor(text,on){super();this.text=text;this.on=on;}
  eq(other){return other instanceof TimeMark&&other.text===this.text&&other.on===this.on;}
  toDOM(){const span=document.createElement('span');span.className='cm-note-time'+(this.on?' on':'');span.textContent=this.text;return span;}
}
const stampField=StateField.define({
  create:()=>({stamps:[],play:null}),
  update(value,tr){
    let stamps=value.stamps,play=value.play,mut=false;
    for(const e of tr.effects){
      if(e.is(setStamps)){stamps=e.value.slice().sort((x,y)=>x.pos-y.pos);mut=true;}
      else if(e.is(setPlayLine)){play=e.value;mut=true;}
    }
    if(tr.docChanged){
      const mapped=[];
      for(const s of stamps)mapped.push({pos:tr.changes.mapPos(s.pos,-1),time:s.time});
      if(recActive()){
        const now=currentElapsed();
        tr.changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
          const text=tr.state.doc.sliceString(fromB,toB);
          /* 空文档里敲下第一行：第一行同样记时间戳 */
          if(fromA===0&&toA===0&&tr.startState.doc.length===0&&text&&text[0]!=='\n')mapped.push({pos:0,time:now});
          let idx=text.indexOf('\n');
          while(idx>=0){mapped.push({pos:fromB+idx+1,time:now});idx=text.indexOf('\n',idx+1);}
        });
      }
      mapped.sort((x,y)=>x.pos-y.pos||x.time-y.time);
      stamps=[];let last=-1;
      for(const s of mapped){if(s.pos===last)continue;last=s.pos;stamps.push(s);}
      mut=true;
    }
    return mut?{stamps,play}:value;
  }
});
function stampForLine(f,line){
  let best=null;
  for(const s of f.stamps){
    if(s.pos<line.from)continue;
    if(s.pos>line.to)break;
    if(!best||s.time<best.time)best=s;
  }
  return best;
}
function currentNotePos(f){
  if(f.play==null||!f.stamps.length)return null;
  let best=null;
  for(const s of f.stamps){if(s.time<=f.play&&(!best||s.time>best.time))best=s;}
  return best?best.pos:null;
}
const timeGutter=gutter({
  class:'cm-note-times',
  lineMarker(view,line){
    const f=view.state.field(stampField,false);
    if(!f||!f.stamps.length)return null;
    const s=stampForLine(f,line);
    if(!s)return null;
    const on=currentNotePos(f)!=null&&line.from<=currentNotePos(f)&&currentNotePos(f)<=line.to;
    return new TimeMark(fmt(s.time),on);
  },
  lineMarkerChange:update=>update.docChanged||update.transactions.some(tr=>tr.effects.some(e=>e.is(setPlayLine)||e.is(setStamps))),
  domEventHandlers:{
    mousedown(view,line){
      const f=view.state.field(stampField,false);
      const s=f&&stampForLine(f,line);
      if(s&&hasAudio()){seekTo(s.time,true);return true;}
      return false;
    }
  }
});
const playHighlight=EditorView.decorations.compute([stampField],state=>{
  const f=state.field(stampField,false);
  const pos=f?currentNotePos(f):null;
  if(pos==null)return Decoration.none;
  const line=state.doc.lineAt(pos);
  return Decoration.set([Decoration.line({class:'cm-note-playing'}).range(line.from)]);
});
const noteClick=EditorView.domEventHandlers({
  click(event,view){
    if(!hasAudio())return false;
    const pos=view.posAtCoords({x:event.clientX,y:event.clientY});
    if(pos==null)return false;
    const f=view.state.field(stampField,false);
    if(!f||!f.stamps.length)return false;
    const s=stampForLine(f,view.state.doc.lineAt(pos));
    if(s){seekTo(s.time,true);}
    return false;
  }
});
const lectureExtensions=[stampField,timeGutter,playHighlight,noteClick];
export {lectureExtensions};

/* ---------------- 模块状态 ---------------- */

let env=null;                    // app.js 注入的钩子
let engine=null,playback=null,timeline=null;
let barState='idle';             // idle|starting|recording|recpaused|stopping|stopped|playing|playpaused
let persist={audio:null,anchors:[],slides:[],notes:[]};
let pendingStamps=[];
let slideSeq=0,uiReady=false,animRaf=0,editAnchorId=null,previewSlideId=null;
let ui={};

function recActive(){return !!(engine&&(engine.state==='recording'||engine.state==='paused'));}
function currentElapsed(){return engine?engine.elapsedSec():0;}
function hasAudio(){return !!(playback&&playback.url)||!!(persist.audio&&persist.audio.data);}
function playTime(){return playback&&playback.url?playback.audio.currentTime:0;}
function playDur(){return persist.audio?persist.audio.duration:(playback&&isFinite(playback.audio.duration)?playback.audio.duration:0);}

/* ---------------- UI ---------------- */

function $(id){return document.getElementById(id);}
function ensureUI(){
  if(uiReady)return;
  uiReady=true;
  ui={
    bar:$('lectureBar'),timer:$('recordTimer'),label:$('recordLabel'),
    record:$('recordBtn'),pause:$('pauseBtn'),stop:$('stopBtn'),newRec:$('newRecBtn'),anchor:$('anchorBtn'),
    canvas:$('timelineCanvas'),zoomIn:$('zoomIn'),zoomOut:$('zoomOut'),range:$('tlRange'),
    anchors:$('anchorList'),slides:$('slideList'),import:$('importSlide'),slideInput:$('slideInput'),
    tabs:$('lectureTabs'),
    anchorDialog:$('anchorDialog'),anchorLabel:$('anchorLabel'),anchorTime:$('anchorTime'),anchorSlide:$('anchorSlide'),
    slideDialog:$('slideDialog'),slideImage:$('slideImage'),slideTitle:$('slideTitle'),slideSeek:$('slideSeek')
  };
  timeline=new Timeline(ui.canvas,{
    onSeek:t=>{if(hasAudio())seekTo(t,true);},
    onAnchor:a=>{seekTo(a.time,false);openAnchorDialog(a);}
  });
  ui.record.addEventListener('click',()=>{
    if(barState==='idle'||barState==='starting')startRecording();
    else if(barState==='playing')pauseAudio();
    else if(barState==='stopped'||barState==='playpaused')playAudio();
  });
  ui.pause.addEventListener('click',()=>{
    if(barState==='recording')pauseRecording();
    else if(barState==='recpaused')resumeRecording();
  });
  ui.stop.addEventListener('click',stopRecording);
  ui.newRec.addEventListener('click',()=>{
    if(persist.audio&&persist.audio.data&&!window.confirm('开始新录音会替换当前音频与锚点（PPT 照片保留），继续吗？'))return;
    startRecording();
  });
  ui.anchor.addEventListener('click',markAnchor);
  ui.zoomIn.addEventListener('click',()=>{timeline.zoom(1);ui.range.textContent=timeline.rangeLabel();});
  ui.zoomOut.addEventListener('click',()=>{timeline.zoom(-1);ui.range.textContent=timeline.rangeLabel();});
  for(const tab of ui.tabs.querySelectorAll('.lecture-tab')){
    tab.addEventListener('click',()=>{
      document.body.dataset.lectureTab=tab.dataset.tab;
      for(const t of ui.tabs.querySelectorAll('.lecture-tab'))t.classList.toggle('active',t===tab);
      if(timeline)timeline.schedule();
    });
  }
  ui.import.addEventListener('click',()=>ui.slideInput.click());
  ui.slideInput.addEventListener('change',()=>importSlides(ui.slideInput.files));
  ui.anchorDialog.addEventListener('close',onAnchorDialogClose);
  ui.slideDialog.addEventListener('close',()=>{previewSlideId=null;});
  ui.slideSeek.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide&&slide.anchorTime!=null){seekTo(slide.anchorTime,true);ui.slideDialog.close();}
  });
}
function setBar(state){
  barState=state;
  if(!uiReady)return;
  const rec=state==='recording',recPause=state==='recpaused';
  const stopped=state==='stopped'||state==='playing'||state==='playpaused';
  ui.bar.dataset.state=state;
  ui.record.hidden=rec||recPause||state==='stopping';
  ui.record.dataset.role=stopped?'play':'rec';
  ui.label.textContent=stopped?(state==='playing'?'⏸ 暂停':'▶ 播放'):(state==='starting'?'启动中…':'🎙 开始录音');
  ui.pause.hidden=!rec&&!recPause;
  ui.pause.textContent=recPause?'▶ 继续':'⏸ 暂停';
  ui.stop.hidden=!rec&&!recPause&&state!=='stopping';
  ui.newRec.hidden=!stopped;
  ui.anchor.hidden=!rec&&!recPause&&!stopped;
  ui.record.disabled=state==='starting';
  ui.stop.disabled=state==='stopping';
}
function renderAnchors(){
  if(!uiReady)return;
  const list=ui.anchors;
  list.replaceChildren();
  for(const anchor of persist.anchors){
    const row=document.createElement('div');row.className='anchorrow';
    const jump=document.createElement('button');jump.className='anchorjump';
    jump.title='跳到 '+fmt(anchor.time);
    const dot=document.createElement('i');dot.className='anchordot '+anchor.type;
    const time=document.createElement('b');time.textContent=fmt(anchor.time);
    const label=document.createElement('span');label.className='anchorlabel';
    label.textContent=anchor.label||(anchor.type==='speech'?'语音段':anchor.type==='silence'?'沉默':'手动标记');
    jump.append(dot,time,label);
    jump.addEventListener('click',()=>seekTo(anchor.time,true));
    const edit=document.createElement('button');edit.className='anchoredit';edit.textContent='✎';edit.title='编辑锚点';
    edit.addEventListener('click',()=>openAnchorDialog(anchor));
    row.append(jump,edit);
    list.append(row);
  }
  if(!persist.anchors.length){
    const empty=document.createElement('p');empty.className='anchorempty';
    empty.textContent='暂无锚点。录音时说话会自动标记，也可以点「📌 标记锚点」。';
    list.append(empty);
  }
}
function renderSlides(){
  if(!uiReady)return;
  slideSeq=persist.slides.reduce((m,s)=>Math.max(m,parseInt(String(s.id).replace(/\D/g,''),10)||0),0)+1;
  const list=ui.slides;
  list.replaceChildren();
  for(const slide of persist.slides){
    const item=document.createElement('div');item.className='slideitem';
    const thumb=document.createElement('button');thumb.className='slidethumb';thumb.title=slide.name;
    const img=document.createElement('img');img.src=slide.data;img.alt=slide.name;img.loading='lazy';
    thumb.append(img);
    thumb.addEventListener('click',()=>openSlidePreview(slide));
    const meta=document.createElement('div');meta.className='slidemeta';
    const time=document.createElement('button');time.className='slidetime';
    if(slide.anchorTime!=null){
      time.textContent='⏱ '+fmt(slide.anchorTime);
      time.title='跳到此页开始时间';
      time.addEventListener('click',()=>seekTo(slide.anchorTime,true));
    }else{
      time.textContent='＋ 锚点';
      time.title='标记为当前播放/录音时间';
      time.addEventListener('click',()=>linkSlideAt(slide,markTime()));
      time.classList.add('unlinked');
    }
    const name=document.createElement('span');name.className='slidename';name.textContent=slide.name;
    meta.append(time,name);
    item.append(thumb,meta);
    list.append(item);
  }
  if(!persist.slides.length){
    const empty=document.createElement('p');empty.className='slidempty';
    empty.textContent='还没有 PPT 照片。点下方按钮导入，拍到的每一页都会记录在时间轴旁。';
    list.append(empty);
  }
}
function renderTimeline(){
  if(!timeline)return;
  const duration=recActive()?Math.max(playDur(),currentElapsed()):playDur();
  timeline.setData(duration,persist.audio?persist.audio.envelope:(engine?engine.envelope:[]),persist.anchors);
  timeline.setPlayhead(recActive()?currentElapsed():(barState==='playing'?playTime():timeline.playhead));
  if(uiReady)ui.range.textContent=timeline.rangeLabel();
}
function refreshAll(){
  renderAnchors();renderSlides();renderTimeline();
  if(barState==='recording'||barState==='recpaused'||barState==='stopping')setBar('idle');
  if(!engine&&barState!=='stopped'&&barState!=='playing'&&barState!=='playpaused')setBar(hasAudio()?'stopped':'idle');
  updateTimer();
}

/* ---------------- 录音 ---------------- */

async function startRecording(){
  if(engine)return;
  if(!AudioEngine.supported()){notify('此设备的 WebView 不支持录音。请更新 Android System WebView 后重试。');return;}
  ensureUI();
  stopAudio();
  persist.audio=null;persist.anchors=[];
  engine=new AudioEngine(()=>{notify('已达 2 小时录音上限，已自动停止。');stopRecording();});
  setBar('starting');
  try{
    engine.anchors=persist.anchors;   // 共享引用：录音期间 persist.anchors 始终可见
    await engine.start();
  }catch(err){
    setBar('idle');engine=null;
    notify(micMessage(err));
    return;
  }
  setBar('recording');
  lastPlayPos=-1;
  updateTimer();
  ensureAnim();
  notify('录音已开始。每一行笔记都会自动记录时间戳。');
}
function pauseRecording(){
  if(!engine)return;
  engine.pause();
  setBar('recpaused');
  updateTimer();
}
function resumeRecording(){
  if(!engine)return;
  engine.resume();
  setBar('recording');
  ensureAnim();
}
async function stopRecording(){
  if(!engine)return;
  setBar('stopping');
  const result=await engine.stop();
  engine=null;
  if(!result||!result.blob||!result.blob.size){
    setBar('idle');
    notify('录音没有产生数据，请重试。');
    return;
  }
  try{
    const base64=await blobToBase64(result.blob);
    persist.audio={data:base64,mime:result.mime,duration:Math.round(result.duration*10)/10,envelope:result.envelope};
  }catch(err){
    setBar('idle');
    notify('录音数据编码失败：'+err.message);
    return;
  }
  persist.anchors.sort((a,b)=>a.time-b.time);
  ensurePlayback().load(persist.audio.data,persist.audio.mime);
  setBar('stopped');
  renderAnchors();renderTimeline();updateTimer();
  env.flush();
  notify('录音完成：'+fmt(persist.audio.duration)+' · '+persist.anchors.length+' 个锚点。');
}
function markAnchor(){
  const t=markTime();
  if(t==null){notify('先开始录音或播放，再标记锚点。');return;}
  const anchor=engine&&engine.state!=='idle'
    ?engine.markManual('标记 '+fmt(t))
    :(persist.anchors.push({id:'a'+Date.now()+'-m',time:Math.round(t*10)/10,type:'manual',label:'标记 '+fmt(t),slideId:null}),persist.anchors[persist.anchors.length-1]);
  persist.anchors.sort((a,b)=>a.time-b.time);
  const slide=[...persist.slides].reverse().find(s=>s.anchorTime==null);
  if(slide)linkSlideAt(slide,t,anchor);
  renderAnchors();renderSlides();renderTimeline();
  env.scheduleSave();
  notify('已标记 '+fmt(t)+(slide?' · 关联最新 PPT 照片':''));
}
function markTime(){
  if(engine&&engine.state!=='idle')return currentElapsed();
  if(hasAudio()&&(barState==='playing'||barState==='playpaused'||barState==='stopped'))return playTime();
  return null;
}
function linkSlideAt(slide,time,anchor){
  slide.anchorTime=Math.round(time*10)/10;
  if(!anchor){
    anchor=persist.anchors.find(a=>a.slideId===slide.id);
    if(!anchor){anchor={id:'a'+Date.now()+'-s',time:slide.anchorTime,type:'manual',label:'PPT：'+slide.name,slideId:slide.id};persist.anchors.push(anchor);}
  }
  anchor.slideId=slide.id;
  if(anchor.time!==slide.anchorTime){anchor.time=slide.anchorTime;persist.anchors.sort((a,b)=>a.time-b.time);}
}
function micMessage(err){
  const name=err&&err.name||'';
  if(name==='NotAllowedError'||name==='SecurityError')return '麦克风权限被拒绝。请在系统设置 → 应用 → 天工 中允许麦克风，然后重试。';
  if(name==='NotFoundError'||name==='DevicesNotFound')return '没有找到可用的麦克风设备。';
  if(name==='NotReadableError')return '麦克风被其他应用占用，请关闭后重试。';
  return '录音启动失败：'+(err&&err.message||name||'未知错误');
}

/* ---------------- 播放与同步 ---------------- */

function ensurePlayback(){
  if(playback)return playback;
  playback=new Playback();
  playback.audio.addEventListener('ended',()=>{setBar('stopped');timeline.setPlayhead(null);dispatchPlayLine(null);updateTimer();});
  playback.audio.addEventListener('play',()=>{setBar('playing');ensureAnim();});
  playback.audio.addEventListener('pause',()=>{if(barState==='playing'){setBar('playpaused');}updateTimer();});
  return playback;
}
function playAudio(){
  if(!persist.audio||!persist.audio.data){notify('还没有录音。点「🎙 开始录音」先录一段。');return;}
  const p=ensurePlayback();
  if(!p.url&&!p.load(persist.audio.data,persist.audio.mime)){notify('录音数据无法解码。');return;}
  p.audio.play().then(()=>{setBar('playing');ensureAnim();}).catch(()=>notify('播放失败，请再试一次。'));
}
function pauseAudio(){
  if(!playback)return;
  playback.audio.pause();
  setBar('playpaused');
  updateTimer();
}
function stopAudio(){
  if(!playback)return;
  playback.audio.pause();
  try{playback.audio.currentTime=0;}catch(e){/* 未加载 */}
  dispatchPlayLine(null);
  if(timeline)timeline.setPlayhead(null);
}
function seekTo(t,play){
  if(!persist.audio||!persist.audio.data)return;
  const p=ensurePlayback();
  if(!p.url&&!p.load(persist.audio.data,persist.audio.mime))return;
  const dur=playDur();
  try{p.audio.currentTime=Math.max(0,Math.min(dur||t,t));}catch(e){/* 元数据未就绪 */}
  timeline.setPlayhead(t);
  dispatchPlayLine(t);
  if(play)p.audio.play().then(()=>{setBar('playing');ensureAnim();}).catch(()=>{setBar('playpaused');updateTimer();});
  else{setBar(barState==='playing'?'playing':'playpaused');updateTimer();}
}
function playPosAt(t){
  const view=env&&env.view();
  const f=view?view.state.field(stampField,false):null;
  if(!f||!f.stamps.length)return null;
  let best=null;
  for(const s of f.stamps){if(s.time<=t&&(!best||s.time>best.time))best=s;}
  return best?best.pos:null;
}
function dispatchPlayLine(time){
  const view=env&&env.view();
  if(view)view.dispatch({effects:setPlayLine.of(time==null?null:time)});
}
function ensureAnim(){
  if(animRaf)return;
  const tick=()=>{
    animRaf=0;
    let busy=false;
    if(engine&&(engine.state==='recording'||engine.state==='paused')){
      busy=true;
      renderTimeline();
      updateTimer();
    }
    if(playback&&!playback.audio.paused){
      busy=true;
      const t=playback.audio.currentTime;
      timeline.setPlayhead(t);
      updateTimer();
      const view=env&&env.view();
      const f=view?view.state.field(stampField,false):null;
      const applied=f?currentNotePos(f):null;
      if(playPosAt(t)!==applied)dispatchPlayLine(t);   // 行变化时才下发新的播放时间
    }
    if(busy)animRaf=requestAnimationFrame(tick);
    else if(engine===null&&barState!=='recording'){updateTimer();}
  };
  animRaf=requestAnimationFrame(tick);
}
function updateTimer(){
  if(!uiReady)return;
  if(engine&&engine.state!=='idle'){
    ui.timer.textContent=fmt(currentElapsed());
  }else if(hasAudio()&&(barState==='stopped'||barState==='playing'||barState==='playpaused')){
    ui.timer.textContent=fmt(playTime())+' / '+fmt(playDur());
  }else if(persist.audio){
    ui.timer.textContent='00:00 / '+fmt(playDur());
  }else{
    ui.timer.textContent='00:00';
  }
}

/* ---------------- PPT 照片 ---------------- */

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('图片解码失败'));
    img.src=url;
  });
}
async function importSlides(files){
  ensureUI();
  const list=[...files||[]];
  ui.slideInput.value='';
  if(!list.length)return;
  const room=MAX_SLIDES-persist.slides.length;
  if(room<=0){notify('最多保留 '+MAX_SLIDES+' 张 PPT 照片。');return;}
  let added=0,skipped=0;
  for(const file of list.slice(0,room)){
    const url=URL.createObjectURL(file);
    try{
      const img=await loadImage(url);
      const scale=Math.min(1,SLIDE_MAX_W/(img.width||SLIDE_MAX_W));
      const w=Math.max(1,Math.round((img.width||SLIDE_MAX_W)*scale)),h=Math.max(1,Math.round((img.height||SLIDE_MAX_W*0.75)*scale));
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      const data=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
      if(!data.startsWith('data:image/'))throw new Error('压缩失败');
      persist.slides.push({id:'s'+(slideSeq++),name:String(file.name||('slide_'+slideSeq)).slice(0,60),data,w,h,anchorTime:null,createdAt:Date.now()});
      added++;
    }catch(e){skipped++;}
    finally{URL.revokeObjectURL(url);}
  }
  renderSlides();renderTimeline();
  env.scheduleSave();
  notify(added?('已导入 '+added+' 张 PPT 照片'+(skipped?'，跳过 '+skipped+' 张无法识别的文件':'')+'。录音中点「📌 标记锚点」即可关联当前页。'):'没有可识别的图片文件。');
}
async function importSlideUrls(urls){
  ensureUI();
  const list=[...urls||[]];
  if(!list.length)return;
  const room=MAX_SLIDES-persist.slides.length;
  if(room<=0){notify('最多保留 '+MAX_SLIDES+' 张 PPT 照片。');return;}
  let added=0,skipped=0;
  for(const url of list.slice(0,room)){
    try{
      const img=await loadImage(url);
      const scale=Math.min(1,SLIDE_MAX_W/(img.width||SLIDE_MAX_W));
      const w=Math.max(1,Math.round((img.width||SLIDE_MAX_W)*scale)),h=Math.max(1,Math.round((img.height||SLIDE_MAX_W*0.75)*scale));
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      const data=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
      if(!data.startsWith('data:image/'))throw new Error('压缩失败');
      persist.slides.push({id:'s'+(slideSeq++),name:'slide_'+slideSeq,data,w,h,anchorTime:null,createdAt:Date.now()});
      added++;
    }catch(e){skipped++;}
  }
  renderSlides();renderTimeline();
  env.scheduleSave();
  notify(added?('已导入 '+added+' 张 PPT 照片'+(skipped?'，跳过 '+skipped+' 张':'')+'。录音中点「📌 标记锚点」即可关联当前页。'):'没有可识别的图片文件。');
}
function openSlidePreview(slide){
  ensureUI();
  previewSlideId=slide.id;
  ui.slideImage.src=slide.data;
  ui.slideTitle.textContent=slide.name;
  ui.slideSeek.disabled=slide.anchorTime==null;
  ui.slideSeek.textContent=slide.anchorTime!=null?('跳到此页开始（'+fmt(slide.anchorTime)+'）'):'跳到此页开始';
  ui.slideDialog.showModal();
}

/* ---------------- 锚点编辑对话框 ---------------- */

function openAnchorDialog(anchor){
  ensureUI();
  editAnchorId=anchor.id;
  ui.anchorLabel.value=anchor.label||'';
  ui.anchorTime.value=String(anchor.time);
  const slide=anchor.slideId?persist.slides.find(s=>s.id===anchor.slideId):null;
  ui.anchorSlide.textContent=slide?('已关联 PPT：'+slide.name):'未关联 PPT 照片；把时间改成某张照片的开始处即可关联最新未标记照片。';
  ui.anchorDialog.showModal();
}
function onAnchorDialogClose(){
  const dialog=ui.anchorDialog;
  const anchor=persist.anchors.find(a=>a.id===editAnchorId);
  editAnchorId=null;
  if(!anchor)return;
  const action=dialog.returnValue;
  if(action==='delete'){
    const idx=persist.anchors.indexOf(anchor);
    if(idx>=0)persist.anchors.splice(idx,1);
    for(const slide of persist.slides)if(slide.anchorTime!=null&&anchor.slideId===slide.id&&Math.abs(slide.anchorTime-anchor.time)<0.05)slide.anchorTime=null;
  }else if(action==='save'){
    const parsed=parseTime(ui.anchorTime.value);
    if(parsed!=null)anchor.time=Math.round(parsed*10)/10;
    anchor.label=ui.anchorLabel.value.trim().slice(0,40);
    persist.anchors.sort((a,b)=>a.time-b.time);
  }else return;
  renderAnchors();renderSlides();renderTimeline();
  env.scheduleSave();
}
function parseTime(text){
  const raw=String(text||'').trim();
  if(!raw)return null;
  if(/^\d+(\.\d+)?$/.test(raw))return Number(raw);
  const parts=raw.split(':').map(Number);
  if(parts.some(n=>isNaN(n)))return null;
  return parts.reverse().reduce((sum,n,i)=>sum+n*Math.pow(60,i),0);
}

/* ---------------- app.js 集成点 ---------------- */

export function initLecture(hooks){
  env=hooks;
}
export function lectureModeEnter(){
  ensureUI();
  document.body.dataset.lectureTab=document.body.dataset.lectureTab||'notes';
  setBar(hasAudio()?'stopped':'idle');
  refreshAll();
  if(persist.audio&&!playback){ensurePlayback().load(persist.audio.data,persist.audio.mime);}
  ensureAnim();
}
export function lectureModeLeave(){
  if(playback&&!playback.audio.paused)playback.audio.pause();
  setBar('idle');
  dispatchPlayLine(null);
  if(timeline){timeline.setPlayhead(null);timeline.setData(0,[],[]);}
  updateTimer();
}
export function lectureBusy(){
  return !!(engine&&(engine.state==='recording'||engine.state==='paused'));
}
export function lectureStatusText(){
  return persist.anchors.length+' 锚点 · '+persist.slides.length+' 张照片';
}
export function lectureSanitize(data){
  const d=(data&&typeof data==='object')?data:{};
  const audio=(d.audio&&typeof d.audio.data==='string'&&d.audio.data.length<40*1024*1024)?{
    data:d.audio.data,
    mime:String(d.audio.mime||'audio/webm').slice(0,80),
    duration:Math.max(0,Math.round((Number(d.audio.duration)||0)*10)/10),
    envelope:Array.isArray(d.audio.envelope)?d.audio.envelope.filter(v=>typeof v==='number'&&isFinite(v)&&v>=0&&v<2).slice(0,20000).map(v=>Math.round(v*10000)/10000):[]
  }:null;
  const anchors=Array.isArray(d.anchors)?d.anchors
    .filter(a=>a&&typeof a.time==='number'&&isFinite(a.time)&&a.time>=0)
    .slice(0,2000)
    .map((a,i)=>({
      id:String(a.id||('a'+(i+1))).slice(0,32),
      time:Math.round(a.time*10)/10,
      type:['speech','silence','manual'].includes(a.type)?a.type:'manual',
      label:String(a.label||'').slice(0,40),
      slideId:a.slideId?String(a.slideId).slice(0,32):null
    }))
    .sort((x,y)=>x.time-y.time):[];
  const slides=Array.isArray(d.slides)?d.slides
    .filter(s=>s&&typeof s.data==='string'&&s.data.startsWith('data:image/')&&s.data.length<6*1024*1024)
    .slice(0,MAX_SLIDES)
    .map((s,i)=>({
      id:String(s.id||('s'+(i+1))).slice(0,32),
      name:String(s.name||('slide_'+(i+1))).slice(0,60),
      data:s.data,
      width:Math.max(1,Math.min(4096,Number(s.width)||SLIDE_MAX_W)),
      height:Math.max(1,Math.min(4096,Number(s.height)||768)),
      anchorTime:typeof s.anchorTime==='number'&&isFinite(s.anchorTime)?Math.round(s.anchorTime*10)/10:null,
      createdAt:Number(s.createdAt)||Date.now()
    })):[];
  const notes=Array.isArray(d.notes)?d.notes
    .filter(n=>n&&typeof n.pos==='number'&&isFinite(n.pos)&&n.pos>=0&&typeof n.time==='number'&&isFinite(n.time)&&n.time>=0)
    .slice(0,5000)
    .map(n=>({pos:Math.round(n.pos),time:Math.round(n.time*10)/10})):[];
  return {audio,anchors,slides,notes,active:!!d.active};
}
export function lectureSerialize(){
  let stamps=persist.notes;
  if(env){
    const active=env.activePath()===NOTES_PATH&&env.view()?env.view().state:env.editorState(NOTES_PATH);
    const field=active?active.field(stampField,false):null;
    if(field)stamps=field.stamps.map(s=>({pos:s.pos,time:Math.round(s.time*10)/10}));
  }
  return {
    active:env?env.workspaceMode()==='lecture':false,
    audio:persist.audio,
    anchors:persist.anchors,
    slides:persist.slides,
    notes:stamps
  };
}
export function lectureAfterRestore(){
  const state=env?env.getState():null;
  const data=(state&&state.lecture)||{};
  persist={audio:data.audio||null,anchors:data.anchors||[],slides:data.slides||[],notes:[]};
  pendingStamps=(data.notes||[]).slice();
  persist.anchors.sort((a,b)=>a.time-b.time);
  if(playback){playback.release();playback=null;}
  if(uiReady){
    if(persist.audio)ensurePlayback().load(persist.audio.data,persist.audio.mime);
    refreshAll();
  }
  /* restore() 中 createEditor 先于本函数执行，此时补一次注入，
     保证重启后时间戳直接出现在笔记 gutter 上。 */
  lectureViewCreated();
}
export function lectureViewCreated(){
  if(!env||!env.view())return;
  if(env.activePath()===NOTES_PATH&&pendingStamps.length){
    const view=env.view();
    view.dispatch({effects:setStamps.of(pendingStamps)});
    pendingStamps=[];
  }
}

/* ---------------- 调试/测试钩子 ---------------- */

export const lectureDebug={
  load(session){
    const clean=lectureSanitize(session);
    persist={audio:clean.audio,anchors:clean.anchors,slides:clean.slides,notes:[]};
    persist.anchors.sort((a,b)=>a.time-b.time);
    ensureUI();
    if(persist.audio)ensurePlayback().load(persist.audio.data,persist.audio.mime);
    setBar(hasAudio()?'stopped':'idle');
    refreshAll();
    return lectureDebug.info();
  },
  seek:t=>{seekTo(Number(t)||0,false);return playTime();},
  stamp(list){const view=env&&env.view();if(view&&env.activePath()===NOTES_PATH&&Array.isArray(list))view.dispatch({effects:setStamps.of(list)});return lectureDebug.info();},
  time:()=>playTime(),
  anchors:()=>persist.anchors.slice(),
  importSlideUrls:urls=>importSlideUrls(urls),
  info(){return {bar:barState,audio:!!(persist.audio&&persist.audio.data),duration:playDur(),anchors:persist.anchors.length,slides:persist.slides.length};}
};
