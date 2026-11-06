/*
 * English text-to-speech for 天工.
 *
 * Android owns the speech engine. The frontend keeps stable document offsets,
 * resumes inside a chunk when the engine reports range progress, and falls
 * back to Web Speech outside the APK.
 */

const DEFAULT_CHUNK=2800;
const MAX_CHUNK=3600;
const MAX_SPEECH_CHARS=500000;
const MIN_RATE=0.75;
const MAX_RATE=1.5;
const EMPTY_STATS={characters:0,words:0,paragraphs:0,hasEnglish:false};

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
    fingerprint:typeof source.fingerprint==='string'&&/^[0-9a-f]{8}$/.test(source.fingerprint)?source.fingerprint:''
  };
}

function normalizeDocument(value){
  return String(value||'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
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

export function splitSpeechSegments(value,maxChars=DEFAULT_CHUNK){
  const text=normalizeDocument(value);
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
  return {text,segments};
}

export function splitSpeechText(value,maxChars=DEFAULT_CHUNK){
  return splitSpeechSegments(value,maxChars).segments.map(segment=>segment.text);
}

let env=null;
let ui=null;
let voices=[];
let engineName='';
let ready=false;
let state='idle';
let segments=[];
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

function requestStatus(force=false){
  if(!nativeBridge())return;
  const time=now();
  if(!force&&time-lastStatusRequest<1200)return;
  lastStatusRequest=time;
  bridgeSend({type:'ttsStatus'});
}

function refreshDocument(){
  const next=normalizeDocument(env&&env.getText?env.getText():'');
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
  if(state==='paused')return exactPause?'已暂停，可从当前位置继续':'已暂停，继续会重读本段';
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
  renderProgress();
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
  const document=splitSpeechSegments(documentText);
  segments=document.segments;
  if(!segments.length){
    if(env&&env.notify)env.notify('没有可朗读的文本。');
    return;
  }
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

function pause(){
  if(state!=='playing')return;
  const id=currentId;
  pausedId=id;
  generation++;
  currentId='';
  if(nativeBridge())bridgeSend({type:'ttsPause',id});
  else if(browserSpeechSupported())window.speechSynthesis.cancel();
  persistPosition(activeOffset,true);
  setStatus('paused');
}

function resume(){
  if(state!=='paused'||!segments.length)return;
  segmentIndex=segmentForOffset(activeOffset);
  speakCurrent(activeOffset-segments[segmentIndex].start);
}

function stop(){
  if(state==='idle'&&!segments.length&&!canResume())return;
  stopAudio(true);
  segments=[];
  segmentIndex=0;
  activeOffset=0;
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
    progress:$('ttsProgressFill')
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
}

export function ttsDocumentChanged(){
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
  clearResume();
  documentText='';
  documentFingerprint='';
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
      exactPause=m.supported!==false;
      const start=Math.max(0,Number(m.charIndex)||0);
      activeOffset=Math.min(documentText.length,activeSliceBase+start);
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
    settings:settings()
  }),
  start,
  pause,
  resume,
  stop
};
