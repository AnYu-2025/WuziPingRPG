/*
 * English text-to-speech for 天工.
 *
 * Android owns the speech engine. The frontend keeps stable document offsets,
 * resumes inside a sentence-level segment when the engine reports range
 * progress (or falls back to an elapsed-time estimate when it does not), and
 * highlights the sentence currently being read in the editor. Outside the APK
 * it falls back to Web Speech.
 */

import {StateField,StateEffect} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';

const DEFAULT_CHUNK=2800;
const MAX_CHUNK=3600;
const MAX_SPEECH_CHARS=500000;
const MIN_RATE=0.75;
const MAX_RATE=1.5;
/* 句级分段：目标 120~220 字符一句，超过 400 字符的长句在空格处兜底硬切。 */
const SENTENCE_MIN=120;
const SENTENCE_TARGET=220;
const SENTENCE_MAX=400;
/* 无 onRangeStart 回执时的进度估算字速：1x 语速约每秒 15 个字符。 */
const CHARS_PER_SECOND=15;
const EMPTY_STATS={characters:0,words:0,paragraphs:0,hasEnglish:false};

/* ---------------- CodeMirror 当前句高亮 ---------------- */

const setTtsHighlight=StateEffect.define(); // {from,to}（原文偏移）| null
const ttsHighlightField=StateField.define({
  create:()=>null,
  update(value,tr){
    for(const effect of tr.effects)if(effect.is(setTtsHighlight))return effect.value;
    /* 文档一旦被编辑，旧偏移立即失效，天然清掉高亮。 */
    if(tr.docChanged)return null;
    return value;
  }
});
const ttsActiveMark=Decoration.mark({class:'cm-tts-active'});
const ttsHighlight=EditorView.decorations.compute([ttsHighlightField],state=>{
  const range=state.field(ttsHighlightField,false);
  if(!range)return Decoration.none;
  const from=Math.max(0,Math.min(state.doc.length,range.from));
  const to=Math.max(from,Math.min(state.doc.length,range.to));
  return to>from?Decoration.set([ttsActiveMark.range(from,to)]):Decoration.none;
});
export const ttsExtensions=[ttsHighlightField,ttsHighlight];

function normalizeLocale(value){
  const locale=String(value||'').replace('_','-');
  return /^en(?:-[A-Za-z]{2})?$/.test(locale)?locale:'en-US';
}

function rateValue(value){
  const rate=Number(value);
  if(!Number.isFinite(rate))return 1;
  return Math.max(MIN_RATE,Math.min(MAX_RATE,rate));
}

function offsetValue(value){
  const offset=Number(value);
  if(!Number.isFinite(offset))return 0;
  return Math.max(0,Math.min(MAX_SPEECH_CHARS,Math.floor(offset)));
}

export function ttsSanitize(value){
  const source=value&&typeof value==='object'?value:{};
  return {
    voice:typeof source.voice==='string'?source.voice.slice(0,160):'',
    locale:normalizeLocale(source.locale),
    rate:rateValue(source.rate),
    resumeOffset:offsetValue(source.resumeOffset),
    fingerprint:typeof source.fingerprint==='string'&&/^[0-9a-f]{8}$/.test(source.fingerprint)?source.fingerprint:'',
    highlight:source.highlight===undefined?true:!!source.highlight,
    autoscroll:source.autoscroll===undefined?false:!!source.autoscroll
  };
}

function normalizeDocument(value){
  return String(value||'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

/* normalizeDocument 会 trim / 压缩空行，规范化文本里的偏移不能直接给编辑器。
   这里逐字符同步游走原文与规范化文本，产出 normOffset → rawOffset 的查表数组：
   每个规范化字符都来自唯一的原文字符（\r\n→\n 视为来自 '\r'），
   被压缩掉的空白只推进原文游标。map[text.length] 是正文末尾（trim 后）的原文偏移。 */
function offsetMap(raw,text){
  const map=new Array(text.length+1);
  let i=0,j=0;
  while(j<text.length&&i<raw.length){
    const c=raw.charAt(i);
    if(c===text.charAt(j)){map[j]=i;i++;j++;continue;}
    /* \r 只在它真的被规范化为 \n 时才建立映射；若那个换行已被 \n{3,}→\n\n
       压缩或首尾 trim 吃掉（text[j] 不是 \n），走普通 skip，不得错位。 */
    if(c==='\r'&&text.charAt(j)==='\n'){map[j]=i;i+=raw.charAt(i+1)==='\n'?2:1;j++;continue;}
    i++;
  }
  while(j<text.length){map[j]=i;j++;}
  map[text.length]=i;
  return map;
}

export function speechStats(value){
  const text=normalizeDocument(value);
  if(!text)return {...EMPTY_STATS};
  const words=(text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)||[]).length;
  const paragraphs=text.split(/\n\s*\n/).filter(part=>/[A-Za-z]/.test(part)).length;
  return {characters:text.length,words,paragraphs,hasEnglish:/[A-Za-z]/.test(text)};
}

function fingerprint(value){
  const text=String(value||'');
  let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,0x01000193);
  }
  return ('00000000'+(hash>>>0).toString(16)).slice(-8);
}

function safeCut(text,cut){
  if(cut>0&&cut<text.length&&/[\uD800-\uDBFF]/.test(text.charAt(cut-1))&&/[\uDC00-\uDFFF]/.test(text.charAt(cut)))return cut-1;
  return cut;
}

function lastPatternCut(text,pattern,minimum){
  let cut=0;
  let match;
  pattern.lastIndex=0;
  while((match=pattern.exec(text))){
    const end=match.index+match[0].length;
    if(end>=minimum)cut=end;
  }
  return cut;
}

function speechCut(text,limit){
  const window=text.slice(0,limit);
  const minimum=Math.floor(limit*0.45);
  const patterns=[
    /\n{2,}/g,
    /[.!?]+["')\]]*(?=\s|$)/g,
    /[;:](?=\s|$)/g,
    /\n/g,
    /\s+/g
  ];
  for(const pattern of patterns){
    const cut=lastPatternCut(window,pattern,minimum);
    if(cut>0&&cut<=limit)return safeCut(text,cut);
  }
  return safeCut(text,limit);
}

/* 旧分块契约：显式传 maxChars 时保持原有「按字数上限切大块」的行为。 */
function splitChunkSegments(text,maxChars){
  const limit=Math.max(240,Math.min(MAX_CHUNK,Math.floor(Number(maxChars)||DEFAULT_CHUNK)));
  const segments=[];
  let cursor=0;
  while(cursor<text.length){
    while(cursor<text.length&&/\s/.test(text.charAt(cursor)))cursor++;
    if(cursor>=text.length)break;
    if(text.length-cursor<=limit){
      segments.push({text:text.slice(cursor),start:cursor,end:text.length});
      break;
    }
    let end=cursor+speechCut(text.slice(cursor),limit);
    while(end>cursor&&/\s/.test(text.charAt(end-1)))end--;
    if(end<=cursor)end=Math.min(text.length,cursor+limit);
    segments.push({text:text.slice(cursor,end),start:cursor,end});
    cursor=end;
  }
  return segments;
}

/* 把规范化文本拆成句子单元：优先在 [.!?] 后跟空白处断句，空行也算句子边界。
   hard 标记「本单元以空行结尾」：贪心打包不得跨过空行合并，否则
   raw.slice(rawStart,rawEnd) 会罩住被压缩的空行，高亮底色盖住空行。 */
function sentencePieces(text){
  const pieces=[];
  const push=(start,end)=>{
    while(start<end&&/\s/.test(text.charAt(start)))start++;
    while(end>start&&/\s/.test(text.charAt(end-1)))end--;
    if(start<end)pieces.push({start,end,hard:false});
  };
  const pattern=/[.!?]+["')\]]*(?=\s)|\n{2,}/g;
  let start=0,match;
  while((match=pattern.exec(text))){
    if(match[0].charAt(0)==='\n'){
      /* 空行：把它之前的内容收尾，并标记上一个单元 hard——贪心打包不得跨空行合并。 */
      push(start,match.index);
      if(pieces.length)pieces[pieces.length-1].hard=true;
    }else{
      push(start,match.index+match[0].length);
    }
    start=match.index+match[0].length;
  }
  push(start,text.length);
  return pieces;
}

/* 句级分段：贪心把句子拼进 120~220 字符的段；单句超过 400 字符时
   在空格处兜底硬切（沿用 speechCut 的边界偏好与代理对保护）。 */
function splitSentenceSegments(text){
  const units=[];
  for(const piece of sentencePieces(text)){
    let cursor=piece.start;
    while(piece.end-cursor>SENTENCE_MAX){
      let end=cursor+speechCut(text.slice(cursor,piece.end),SENTENCE_MAX);
      while(end>cursor&&/\s/.test(text.charAt(end-1)))end--;
      if(end<=cursor)end=Math.min(piece.end,cursor+SENTENCE_MAX);
      units.push({start:cursor,end,hard:false});
      cursor=end;
      while(cursor<piece.end&&/\s/.test(text.charAt(cursor)))cursor++;
    }
    if(cursor<piece.end)units.push({start:cursor,end:piece.end,hard:piece.hard});
  }
  const segments=[];
  let start=-1,end=-1,hardBreak=false;
  const flush=()=>{
    if(start<0)return;
    segments.push({text:text.slice(start,end),start,end});
    start=-1;
  };
  for(const unit of units){
    /* hardBreak：上一单元以空行收尾，强制封段，不跨空行合并。 */
    if(start>=0&&(hardBreak||unit.end-start>SENTENCE_MAX||unit.end-start>SENTENCE_TARGET&&end-start>=SENTENCE_MIN)){
      flush();
      start=unit.start;
      end=unit.end;
    }else if(start<0){start=unit.start;end=unit.end;}
    else end=unit.end;
    hardBreak=unit.hard;
  }
  flush();
  return segments;
}

/* 不传 maxChars 走句级分段；显式传 maxChars 走旧分块逻辑（既有测试/调用契约）。
   返回结构不变：{text,segments}，segment 仍携带规范化文本内的绝对 start/end；
   另挂 rawStart/rawEnd（编辑器原文偏移）供高亮派发，raw 为完整查表数组。 */
export function splitSpeechSegments(value,maxChars){
  const raw=String(value||'');
  const text=normalizeDocument(raw);
  const rawOffsets=offsetMap(raw,text);
  const segments=maxChars===undefined?splitSentenceSegments(text):splitChunkSegments(text,maxChars);
  for(const segment of segments){
    segment.rawStart=segment.end>segment.start?rawOffsets[segment.start]:0;
    segment.rawEnd=segment.end>segment.start?rawOffsets[segment.end-1]+1:segment.rawStart;
  }
  return {text,segments,raw:rawOffsets};
}

export function splitSpeechText(value,maxChars){
  return splitSpeechSegments(value,maxChars).segments.map(segment=>segment.text);
}

let env=null;
let ui=null;
let voices=[];
let engineName='';
let ready=false;
let state='idle';
let segments=[];
let documentRaw='';
let documentText='';
let documentStats={...EMPTY_STATS};
let documentFingerprint='';
let segmentIndex=0;
let activeOffset=0;
let activeSliceBase=0;
let generation=0;
let currentId='';
let pausedId='';
let lastStatusRequest=0;
let browserVoicesReady=false;
let statsTimer=0;
let browserUtterance=null;
let exactPause=true;
let lastPersistAt=0;
/* 本次发声的起点（文档偏移）、开始时刻与语速：供无 onRangeStart 引擎做暂停估算。 */
let utteranceBase=0;
let utteranceStartAt=0;
let utteranceRate=1;
let utteranceChars=0;
/* segments 构建时的文档指纹与文件路径：切文件/切模式回来后判断位置是否仍有效。 */
let segmentsFingerprint='';
let speakingPath='';
/* 自动滚动：记录用户在本段内手动滚过就不再抢滚动，片段切换自动重置。 */
let scrollBoundView=null;
let userScrollAt=0;
let userScrollSegment=-1;
let lastScrollKey='';

function now(){
  return env&&typeof env.now==='function'?env.now():Date.now();
}

function schedule(fn,delay){
  return env&&typeof env.setTimeout==='function'?env.setTimeout(fn,delay):setTimeout(fn,delay);
}

function cancelTimer(timer){
  if(!timer)return;
  if(env&&typeof env.clearTimeout==='function')env.clearTimeout(timer);
  else clearTimeout(timer);
}

function settings(){
  return ttsSanitize(env&&env.getSettings?env.getSettings():null);
}

function updateSettings(next,save=true){
  if(!env)return;
  const clean=ttsSanitize(next);
  if(env.setSettings)env.setSettings(clean);
  if(save&&env.saveSettings)env.saveSettings();
}

function nativeBridge(){
  return !!(env&&env.native);
}

function browserSpeechSupported(){
  return typeof window!=='undefined'&&!!window.speechSynthesis&&typeof window.SpeechSynthesisUtterance==='function';
}

function bridgeSend(data){
  if(env&&env.send)env.send(data.type,data);
}

/* 高亮/滚动用的编辑器视图与环境钩子都是可选的：缺省时整体 no-op。 */
function editorView(){
  const view=env&&typeof env.view==='function'?env.view():null;
  return view&&typeof view.dispatch==='function'?view:null;
}

function currentPath(){
  return env&&typeof env.activePath==='function'?env.activePath():'';
}

function requestStatus(force=false){
  if(!nativeBridge())return;
  const time=now();
  if(!force&&time-lastStatusRequest<1200)return;
  lastStatusRequest=time;
  bridgeSend({type:'ttsStatus'});
}

function refreshDocument(){
  const raw=env&&env.getText?String(env.getText()||''):'';
  const next=normalizeDocument(raw);
  documentRaw=raw;
  if(next!==documentText){
    documentText=next;
    documentStats=speechStats(next);
    documentFingerprint=fingerprint(next);
  }
  return documentStats;
}

function currentResumeOffset(){
  const current=settings();
  if(current.fingerprint!==documentFingerprint)return 0;
  return Math.max(0,Math.min(documentText.length,current.resumeOffset));
}

function canResume(){
  const offset=currentResumeOffset();
  return offset>0&&offset<documentText.length;
}

function persistPosition(offset,forceSave=false){
  const current=settings();
  const clean=Math.max(0,Math.min(documentText.length,Math.floor(Number(offset)||0)));
  if(current.resumeOffset===clean&&current.fingerprint===documentFingerprint&&!forceSave)return;
  const time=now();
  const save=forceSave||time-lastPersistAt>=750;
  updateSettings({...current,resumeOffset:clean,fingerprint:documentFingerprint},save);
  if(save)lastPersistAt=time;
}

function clearResume(){
  const current=settings();
  if(current.resumeOffset||current.fingerprint)updateSettings({...current,resumeOffset:0,fingerprint:''},true);
}

function segmentForOffset(offset){
  if(!segments.length)return 0;
  for(let i=0;i<segments.length;i++)if(offset<segments[i].end)return i;
  return segments.length-1;
}

function setStatus(next){
  state=next;
  render();
}

function renderVoiceOptions(){
  if(!ui||!ui.voice)return;
  const selected=settings().voice;
  ui.voice.replaceChildren();
  const auto=document.createElement('option');
  auto.value='';
  auto.textContent='系统默认 · English';
  ui.voice.append(auto);
  for(const voice of voices){
    const option=document.createElement('option');
    option.value=voice.name;
    option.textContent=(voice.locale||'English')+' · '+voice.name;
    ui.voice.append(option);
  }
  ui.voice.value=voices.some(voice=>voice.name===selected)?selected:'';
}

function blockedReason(stats){
  if(!stats.hasEnglish)return '这个文件里没有英文内容。';
  if(stats.characters>MAX_SPEECH_CHARS)return '文本超过 50 万字符，请先拆分文件。';
  return '';
}

function statusLabel(stats){
  if(!nativeBridge()&&!browserSpeechSupported())return '此设备不支持英语朗读。';
  if(!ready)return nativeBridge()?'正在准备英语语音…':'正在准备浏览器语音…';
  const blocked=blockedReason(stats);
  if(blocked)return blocked;
  if(state==='playing')return '正在朗读';
  if(state==='paused')return '已暂停，可从当前位置继续';
  if(state==='done')return '朗读完成';
  if(state==='error')return '朗读未能继续';
  if(canResume())return '可继续上次位置';
  return engineName||'标准英语语音已就绪';
}

function segmentProgress(){
  if(!segments.length)return '';
  if(state==='done')return '已完成 '+segments.length+' / '+segments.length+' 段';
  const index=Math.max(0,Math.min(segments.length-1,segmentIndex));
  return '第 '+(index+1)+' / '+segments.length+' 段';
}

function renderProgress(){
  if(!ui||!ui.progress)return;
  const progress=state==='done'?100:documentText.length?Math.max(0,Math.min(100,activeOffset/documentText.length*100)):0;
  ui.progress.style.width=progress.toFixed(1)+'%';
  ui.progress.parentElement.setAttribute('aria-valuenow',String(Math.round(progress)));
}

/* ---------------- 当前句高亮与自动滚动 ---------------- */

function highlightRange(){
  if(typeof document==='undefined'||!document.body||!document.body.classList.contains('tts'))return null;
  if(!settings().highlight)return null;
  if(state!=='playing'&&state!=='paused')return null;
  const segment=segments[segmentIndex];
  if(!segment||typeof segment.rawStart!=='number')return null;
  /* 朗读的是别的文件（切走了又切回来前）不出高亮。 */
  if(speakingPath&&currentPath()&&currentPath()!==speakingPath)return null;
  return {from:segment.rawStart,to:segment.rawEnd};
}

function syncHighlight(){
  const view=editorView();
  if(!view)return;
  let range=null;
  try{range=highlightRange();}catch(error){range=null;}
  const key=range?range.from+':'+range.to:'';
  /* 读出现场值再决定要不要 dispatch：switchFile 的 setState / createEditor 重建
     会把 StateField 重置为 null，此时必须重发；值没变则完全不打扰编辑器。 */
  let current=null;
  try{current=view.state.field(ttsHighlightField,false);}catch(error){current=null;}
  const currentKey=current?current.from+':'+current.to:'';
  if(currentKey!==key){
    try{view.dispatch({effects:[setTtsHighlight.of(range)]});}catch(error){return;}
  }
  if(range&&state==='playing'&&key!==lastScrollKey){
    lastScrollKey=key;
    maybeAutoscroll(view);
  }
  if(!range)lastScrollKey='';
}

function bindScroll(view){
  if(scrollBoundView===view)return;
  scrollBoundView=view;
  if(view.scrollDOM&&view.scrollDOM.addEventListener){
    view.scrollDOM.addEventListener('scroll',()=>{
      userScrollAt=now();
      userScrollSegment=segmentIndex;
    },{passive:true});
  }
}

/* 自动滚动默认关；开了也只在当前句完全滚出视口时轻滚动，
   用户在本段内手动滚过就不再抢（片段切换由 lastScrollKey 重置）。 */
function maybeAutoscroll(view){
  if(!settings().autoscroll)return;
  if(!view||!view.dom)return;
  bindScroll(view);
  schedule(()=>{
    const current=editorView();
    if(!current||current!==view||!current.dom.isConnected)return;
    if(userScrollSegment===segmentIndex)return;
    const el=current.dom.querySelector('.cm-tts-active');
    if(!el||typeof el.getBoundingClientRect!=='function')return;
    const host=current.scrollDOM.getBoundingClientRect();
    const rect=el.getBoundingClientRect();
    if(rect.bottom<host.top||rect.top>host.bottom)el.scrollIntoView({block:'center',behavior:'smooth'});
  },80);
}

function render(){
  if(!ui||!ui.bar)return;
  const current=settings();
  const blocked=blockedReason(documentStats);
  ui.bar.dataset.state=state;
  ui.play.dataset.state=state;
  const meta=documentStats.characters?
    documentStats.characters+' 字符 · '+documentStats.words+' 词 · '+documentStats.paragraphs+' 段'+(segmentProgress()?' · '+segmentProgress():''):
    '在编辑器里输入或打开英文文本';
  if(ui.meta.textContent!==meta)ui.meta.textContent=meta;
  const label=statusLabel(documentStats);
  if(ui.status.textContent!==label)ui.status.textContent=label;
  ui.play.disabled=!ready||!!blocked;
  ui.play.title=blocked||(!ready?'英语语音尚未就绪':'');
  ui.stop.disabled=state==='idle'||state==='done'||state==='error';
  ui.playText.textContent=state==='playing'?'暂停':state==='paused'||state==='idle'&&canResume()?'继续':'朗读';
  ui.play.setAttribute('aria-label',state==='playing'?'暂停英语朗读':state==='paused'||state==='idle'&&canResume()?'继续英语朗读':'开始英语朗读');
  if(blocked)ui.play.setAttribute('aria-description',blocked);
  else ui.play.removeAttribute('aria-description');
  ui.rate.value=String(current.rate);
  ui.rateValue.textContent=current.rate.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'x';
  ui.voice.value=voices.some(voice=>voice.name===current.voice)?current.voice:'';
  if(ui.highlight)ui.highlight.checked=current.highlight;
  if(ui.autoscroll)ui.autoscroll.checked=current.autoscroll;
  renderProgress();
  syncHighlight();
}

function loadBrowserVoices(){
  if(!browserSpeechSupported())return;
  const all=window.speechSynthesis.getVoices()||[];
  voices=all.filter(voice=>/^en(?:-|$)/i.test(voice.lang||''))
    .map(voice=>({name:voice.name,locale:normalizeLocale(voice.lang)}))
    .sort((a,b)=>a.locale.localeCompare(b.locale)||a.name.localeCompare(b.name));
  browserVoicesReady=voices.length>0;
  ready=true;
  renderVoiceOptions();
  render();
}

function stopAudio(notifyNative){
  generation++;
  currentId='';
  pausedId='';
  if(nativeBridge()){
    if(notifyNative)bridgeSend({type:'ttsStop'});
  }else if(browserSpeechSupported()){
    window.speechSynthesis.cancel();
  }
  browserUtterance=null;
}

function applyRange(id,charIndex){
  if(id!==currentId||state!=='playing')return;
  const offset=activeSliceBase+Math.max(0,Number(charIndex)||0);
  activeOffset=Math.max(0,Math.min(documentText.length,offset));
  persistPosition(activeOffset);
  renderProgress();
}

function completeChunk(token,id){
  if(token!==generation||id!==currentId||state!=='playing')return;
  const segment=segments[segmentIndex];
  if(!segment)return;
  activeOffset=segment.end;
  currentId='';
  segmentIndex++;
  if(segmentIndex>=segments.length){
    clearResume();
    setStatus('done');
    return;
  }
  persistPosition(activeOffset,true);
  speakCurrent(0);
}

function browserSpeak(text,id){
  const utterance=new window.SpeechSynthesisUtterance(text);
  const current=settings();
  utterance.lang=current.locale;
  utterance.rate=current.rate;
  utterance.pitch=1;
  const chosen=(window.speechSynthesis.getVoices()||[]).find(voice=>voice.name===current.voice&&/^en(?:-|$)/i.test(voice.lang||''));
  if(chosen)utterance.voice=chosen;
  utterance.onboundary=event=>{
    if(id===currentId&&event.name==='word')applyRange(id,event.charIndex||0);
  };
  utterance.onend=()=>completeChunk(generation,id);
  utterance.onerror=event=>{
    if(id!==currentId)return;
    setStatus('error');
    if(env&&env.notify)env.notify('浏览器英语语音播放失败：'+(event.error||'未知错误'));
  };
  browserUtterance=utterance;
  window.speechSynthesis.speak(utterance);
}

function speakCurrent(offsetWithinSegment=0){
  if(segmentIndex<0||segmentIndex>=segments.length)return;
  const segment=segments[segmentIndex];
  const text=segment.text.slice(Math.max(0,offsetWithinSegment));
  if(!text){
    completeChunk(generation,currentId);
    return;
  }
  const current=settings();
  const token=++generation;
  const id='tts-'+token+'-'+segmentIndex+'-'+Math.max(0,offsetWithinSegment);
  currentId=id;
  pausedId='';
  activeSliceBase=segment.start+Math.max(0,offsetWithinSegment);
  activeOffset=activeSliceBase;
  utteranceBase=activeSliceBase;
  utteranceStartAt=now();
  utteranceRate=current.rate;
  utteranceChars=text.length;
  exactPause=true;
  persistPosition(activeOffset,true);
  setStatus('playing');
  if(nativeBridge()){
    bridgeSend({type:'ttsSpeak',id,text,voice:current.voice,locale:current.locale,rate:current.rate});
  }else{
    browserSpeak(text,id);
  }
}

function start(){
  if(!ready){
    requestStatus(true);
    if(env&&env.notify)env.notify('英语语音仍在准备，请稍后重试。');
    return;
  }
  const stats=refreshDocument();
  const blocked=blockedReason(stats);
  if(blocked){
    if(env&&env.notify)env.notify(blocked);
    render();
    return;
  }
  /* 句级分段直接基于编辑器原文：rawStart/rawEnd 才能对上 CodeMirror 文档偏移。 */
  const splitResult=splitSpeechSegments(documentRaw);
  segments=splitResult.segments;
  if(!segments.length){
    if(env&&env.notify)env.notify('没有可朗读的文本。');
    return;
  }
  segmentsFingerprint=documentFingerprint;
  speakingPath=currentPath();
  const resumeOffset=currentResumeOffset();
  if(resumeOffset>0&&resumeOffset<documentText.length){
    segmentIndex=segmentForOffset(resumeOffset);
    activeOffset=Math.max(resumeOffset,segments[segmentIndex].start);
  }else{
    clearResume();
    segmentIndex=0;
    activeOffset=0;
  }
  speakCurrent(activeOffset-segments[segmentIndex].start);
}

/* (offset, limit] 内第一个单词开头；没有则返回 limit。严格在 offset 之后。 */
function wordBoundaryAfter(text,offset,limit){
  const end=Math.min(text.length,Math.max(0,limit));
  let i=Math.max(0,offset)+1;
  while(i<end){
    if(/[A-Za-z0-9]/.test(text.charAt(i))&&!/[A-Za-z0-9'-]/.test(text.charAt(i-1)))return i;
    i++;
  }
  return end;
}

/* 无 onRangeStart 回执时的暂停估算：已播秒数 × 字速 × 语速，向前对齐到词边界。
   铁律：结果只允许往前收敛——不得小于本次发声起点之后的第一个词边界，
   也不得越过本段结尾，绝不退回段首重读。 */
function estimatePauseOffset(){
  const segment=segments[segmentIndex];
  if(!segment)return activeOffset;
  const elapsed=Math.max(0,(now()-utteranceStartAt)/1000);
  const spoken=Math.floor(elapsed*CHARS_PER_SECOND*Math.max(MIN_RATE,utteranceRate||1));
  const guess=utteranceBase+spoken;
  if(guess<=utteranceBase)return wordBoundaryAfter(documentText,utteranceBase,segment.end);
  if(guess>=segment.end)return segment.end;
  return wordBoundaryAfter(documentText,guess-1,segment.end);
}

/* 估算只许前进：已有更靠前的精确进度（onboundary / ttsRange）时保留精确值。 */
function refinePausePosition(){
  const estimate=estimatePauseOffset();
  if(estimate>activeOffset)activeOffset=estimate;
}

function pause(){
  if(state!=='playing')return;
  const id=currentId;
  pausedId=id;
  generation++;
  currentId='';
  if(nativeBridge())bridgeSend({type:'ttsPause',id});
  else if(browserSpeechSupported())window.speechSynthesis.cancel();
  /* 先按已播时长把暂停点推进到词边界；原生随后回执精确 charIndex 时再精修。 */
  refinePausePosition();
  persistPosition(activeOffset,true);
  setStatus('paused');
}

function resume(){
  if(state!=='paused'||!segments.length)return;
  segmentIndex=segmentForOffset(activeOffset);
  const segment=segments[segmentIndex];
  const within=Math.max(0,activeOffset-segment.start);
  if(within>=segment.text.length){
    /* 暂停点落在最后一段的段尾：没有剩余内容，直接收尾。 */
    clearResume();
    setStatus('done');
    return;
  }
  speakCurrent(within);
}

function stop(){
  if(state==='idle'&&!segments.length&&!canResume())return;
  stopAudio(true);
  segments=[];
  segmentIndex=0;
  activeOffset=0;
  segmentsFingerprint='';
  speakingPath='';
  clearResume();
  setStatus('idle');
}

function resetRuntimeState(){
  cancelTimer(statsTimer);
  if(browserSpeechSupported())window.speechSynthesis.cancel();
  env=null;
  ui=null;
  voices=[];
  engineName='';
  ready=false;
  state='idle';
  segments=[];
  documentRaw='';
  documentText='';
  documentStats={...EMPTY_STATS};
  documentFingerprint='';
  segmentIndex=0;
  activeOffset=0;
  activeSliceBase=0;
  generation=0;
  currentId='';
  pausedId='';
  lastStatusRequest=0;
  browserVoicesReady=false;
  statsTimer=0;
  browserUtterance=null;
  exactPause=true;
  lastPersistAt=0;
  utteranceBase=0;
  utteranceStartAt=0;
  utteranceRate=1;
  utteranceChars=0;
  segmentsFingerprint='';
  speakingPath='';
  scrollBoundView=null;
  userScrollAt=0;
  userScrollSegment=-1;
  lastScrollKey='';
}

export function initTTS(config){
  resetRuntimeState();
  env=config;
  refreshDocument();
  if(typeof document==='undefined')return ttsDebug;
  const $=id=>document.getElementById(id);
  ui={
    bar:$('ttsBar'),
    meta:$('ttsMeta'),
    status:$('ttsStatus'),
    play:$('ttsPlay'),
    playText:$('ttsPlayText'),
    stop:$('ttsStop'),
    voice:$('ttsVoice'),
    rate:$('ttsRate'),
    rateValue:$('ttsRateValue'),
    progress:$('ttsProgressFill'),
    highlight:$('ttsHighlight'),
    autoscroll:$('ttsAutoscroll')
  };
  if(!ui.bar)return ttsDebug;
  ui.play.addEventListener('click',()=>{
    if(state==='playing')pause();
    else if(state==='paused')resume();
    else start();
  });
  ui.stop.addEventListener('click',stop);
  ui.voice.addEventListener('change',()=>{
    const selected=voices.find(voice=>voice.name===ui.voice.value);
    updateSettings({...settings(),voice:selected?selected.name:'',locale:selected?selected.locale:'en-US'});
    render();
  });
  ui.rate.addEventListener('input',()=>{
    updateSettings({...settings(),rate:rateValue(ui.rate.value)});
    ui.rateValue.textContent=rateValue(ui.rate.value).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'x';
  });
  if(ui.highlight)ui.highlight.addEventListener('change',()=>{
    updateSettings({...settings(),highlight:ui.highlight.checked});
    syncHighlight();
  });
  if(ui.autoscroll)ui.autoscroll.addEventListener('change',()=>{
    updateSettings({...settings(),autoscroll:ui.autoscroll.checked});
  });
  if(nativeBridge())engineName='Android 英语语音';
  else{
    loadBrowserVoices();
    if(browserSpeechSupported()&&typeof window.speechSynthesis.addEventListener==='function'){
      window.speechSynthesis.addEventListener('voiceschanged',loadBrowserVoices);
    }
  }
  renderVoiceOptions();
  render();
  return ttsDebug;
}

export function ttsSerialize(){
  return settings();
}

export function ttsAfterRestore(){
  refreshDocument();
  renderVoiceOptions();
  render();
}

export function ttsHideBar(){
  if(ui&&ui.bar)ui.bar.hidden=true;
}

export function ttsShowBar(){
  if(ui&&ui.bar)ui.bar.hidden=false;
}

export function ttsModeEnter(){
  ttsShowBar();
  refreshDocument();
  if(!nativeBridge()){
    if(!browserVoicesReady)loadBrowserVoices();
  }else if(!ready){
    requestStatus(true);
  }
  render();
}

export function ttsModeLeave(){
  if(state==='playing')pause();
  /* body.tts 类要在 applyMode 里稍后才会摘掉，延后一拍再清当前句高亮。 */
  schedule(()=>syncHighlight(),0);
}

/* kind='edited'：文档真的被编辑——停朗读、清位置（旧行为）。
   kind='switched'：切文件/进出 tts 模式——文档没变就保留暂停位置与状态，
   文档真的变了（指纹对不上）才停止并清空。 */
export function ttsDocumentChanged(kind='edited'){
  if(kind==='switched'){
    refreshDocument();
    if((state==='playing'||state==='paused')&&documentFingerprint!==segmentsFingerprint){
      stopAudio(true);
      state='idle';
      segments=[];
      segmentIndex=0;
      activeOffset=0;
      activeSliceBase=0;
      segmentsFingerprint='';
      speakingPath='';
      clearResume();
      if(env&&env.notify)env.notify('朗读内容已变化，朗读已停止。');
    }
    render();
    syncHighlight();
    return;
  }
  const interrupted=state==='playing'||state==='paused';
  if(interrupted){
    stopAudio(true);
    state='idle';
    if(env&&env.notify)env.notify('文本已修改，朗读已停止。');
  }
  segments=[];
  segmentIndex=0;
  activeOffset=0;
  activeSliceBase=0;
  segmentsFingerprint='';
  speakingPath='';
  clearResume();
  documentRaw='';
  documentText='';
  documentFingerprint='';
  syncHighlight();
  cancelTimer(statsTimer);
  statsTimer=schedule(()=>{
    statsTimer=0;
    refreshDocument();
    render();
  },650);
}

export function ttsStatusText(){
  return statusLabel(documentStats);
}

export function ttsReceive(message){
  const m=message||{};
  if(m.type==='ttsStatus'){
    ready=!!m.ready;
    engineName=!ready&&m.initializing?'正在准备 Android 英语语音…':m.engine||'Android 英语语音';
    if(Array.isArray(m.voices)){
      voices=m.voices.filter(voice=>voice&&typeof voice.name==='string'&&/^en(?:-|$)/i.test(String(voice.locale||'')))
        .map(voice=>({name:voice.name.slice(0,160),locale:normalizeLocale(voice.locale)}));
    }
    renderVoiceOptions();
    render();
    if(!ready&&m.error&&env&&env.notify)env.notify(m.error);
    return true;
  }
  if(m.type==='ttsStarted')return true;
  if(m.type==='ttsRange'){
    if(m.id===currentId)applyRange(m.id,m.start);
    return true;
  }
  if(m.type==='ttsDone'){
    completeChunk(generation,m.id);
    return true;
  }
  if(m.type==='ttsPaused'){
    if(m.id===pausedId){
      const start=Math.max(0,Number(m.charIndex)||0);
      if(m.supported===true||m.supported===undefined&&start>0){
        /* 引擎支持精确区间（或旧协议没带 supported 但给了有效 charIndex）：精修。 */
        exactPause=true;
        activeOffset=Math.max(activeSliceBase,Math.min(documentText.length,activeSliceBase+start));
      }else{
        /* 不支持区间回执：按已播时长估算，向前对齐词边界，绝不退回段首。 */
        exactPause=false;
        refinePausePosition();
      }
      persistPosition(activeOffset,true);
    }
    if(state==='playing')state='paused';
    render();
    return true;
  }
  if(m.type==='ttsStopped'){
    if(state!=='paused')setStatus('idle');
    return true;
  }
  if(m.type==='ttsError'){
    if(!m.id||m.id===currentId||m.id===pausedId){
      currentId='';
      pausedId='';
      setStatus('error');
      if(env&&env.notify)env.notify(m.message||'英语语音播放失败。');
    }
    return true;
  }
  return false;
}

export const ttsDebug={
  split:splitSpeechText,
  segments:splitSpeechSegments,
  stats:speechStats,
  info:()=>({
    state,
    ready,
    chunks:segments.length,
    chunkIndex:segmentIndex,
    textLength:documentText.length,
    offset:activeOffset,
    currentId,
    pausedId,
    exactPause,
    fingerprint:documentFingerprint,
    voices:voices.length,
    engine:engineName,
    utteranceBase,
    utteranceChars,
    settings:settings()
  }),
  start,
  pause,
  resume,
  stop
};
