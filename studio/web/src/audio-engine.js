/* 上课模式 · 音频引擎
   MediaRecorder 录制（webm/opus，离线）+ AudioContext 能量分析：
   - 每 500ms 采样一次 RMS，维护 10 秒滚动平均做动态阈值
   - 能量 VAD：语音段中点 → speech 锚点；语音后长沉默起点 → silence 锚点
   - 波形包络（RMS 序列，固定 0.5s 间距）随录音累积，用于时间轴渲染与持久化 */

const WINDOW_MS=500;          // RMS 分析窗口
const HISTORY=20;             // 动态阈值滚动平均窗口（20×0.5s = 10 秒）
const THRESHOLD_X=1.5;        // 阈值倍数：滚动平均 × 1.5
const FLOOR=0.012;            // 绝对能量下限，避免安静房间的本底噪声被放大
const MIN_SPEECH_MS=1000;     // 短于 1s 的语音段视为噪声，不生成锚点
const SILENCE_HOLD_MS=2000;   // 低于阈值×0.5 持续 2s → 判定语音段结束
const SILENCE_ANCHOR_MS=3000; // 语音结束后沉默超过 3s → 在沉默起点记 silence 锚点
const MAX_MS=2*60*60*1000;    // 单次录音上限 2 小时（base64 存工作区）
const BITS_PER_SECOND=16000;  // opus 语音码率：1 小时 ≈ 7MB，2 小时仍在保存上限内

/* 拿麦克风：先要带降噪的约束，失败后逐级退回，最后走旧版 getUserMedia。
   某些 WebView 不支持 echoCancellation/noiseSuppression 这类约束，会直接抛
   OverconstrainedError；层级回退可以避免“点了没反应”。 */
async function requestStream(){
  const attempts=[{audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}},{audio:true}];
  let lastError=null;
  const modern=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;
  if(modern){
    for(const constraints of attempts){
      try{return await navigator.mediaDevices.getUserMedia(constraints);}
      catch(e){
        lastError=e;
        const name=e&&e.name;
        if(name==='NotAllowedError'||name==='SecurityError'||name==='NotFoundError'||name==='NotReadableError')break;
      }
    }
  }
  const legacy=navigator.getUserMedia||navigator.webkitGetUserMedia;
  if(legacy){
    try{
      return await new Promise((resolve,reject)=>legacy.call(navigator,{audio:true},resolve,reject));
    }catch(e){lastError=e;}
  }
  throw lastError||new Error('无法访问麦克风：getUserMedia 不可用');
}

export class AudioEngine{
  constructor(onAutoStop){
    this.onAutoStop=onAutoStop||null;
    this.state='idle';           // idle | recording | paused
    this.elapsedMs=0;            // 已录音时长（不含当前进行中的片段）
    this.resumeAt=0;
    this.stream=null;this.recorder=null;this.chunks=[];this.mime='';
    this.ctx=null;this.analyser=null;this.buf=null;
    this.timer=0;
    this.envelope=[];            // [{序号隐含时间, 值}]，间距 0.5s
    this.anchors=[];             // 与 lecture.js 共享引用（含手动锚点）
    this.windowVals=[];
    this.vad={inSpeech:false,speechStart:0,lastLoud:0,quietSince:0,gapStart:-1,silenceMarked:true};
    this.seq=0;
  }
  static supported(){
    const devices=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;
    const legacy=navigator.getUserMedia||navigator.webkitGetUserMedia;
    return typeof MediaRecorder!=='undefined'&&!!(devices||legacy);
  }
  elapsedSec(){
    return (this.elapsedMs+(this.state==='recording'?Math.max(0,Date.now()-this.resumeAt):0))/1000;
  }
  async start(){
    this.stream=await requestStream();
    let mime='';
    for(const t of ['audio/webm;codecs=opus','audio/webm','audio/mp4']){
      try{if(MediaRecorder.isTypeSupported(t)){mime=t;break;}}catch(e){/* 旧实现缺 isTypeSupported */}
    }
    try{
      this.recorder=mime?new MediaRecorder(this.stream,{mimeType:mime,audioBitsPerSecond:BITS_PER_SECOND})
                        :new MediaRecorder(this.stream,{audioBitsPerSecond:BITS_PER_SECOND});
    }catch(e){
      this.recorder=new MediaRecorder(this.stream);
    }
    this.mime=this.recorder.mimeType||mime||'audio/webm';
    this.chunks=[];
    this.recorder.ondataavailable=e=>{if(e.data&&e.data.size)this.chunks.push(e.data);};
    this.recorder.start(WINDOW_MS*2); // 每 1s 收集一个 chunk，限制单块内存
    try{this.ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:44100});}
    catch(e){this.ctx=new (window.AudioContext||window.webkitAudioContext)();}
    const source=this.ctx.createMediaStreamSource(this.stream);
    this.analyser=this.ctx.createAnalyser();
    this.analyser.fftSize=2048;
    this.buf=new Uint8Array(this.analyser.fftSize);
    source.connect(this.analyser);
    this.elapsedMs=0;this.resumeAt=Date.now();
    this.envelope=[];this.windowVals=[];
    this.vad={inSpeech:false,speechStart:0,lastLoud:0,quietSince:0,gapStart:-1,silenceMarked:true};
    this.state='recording';
    this.timer=setInterval(()=>this.window(),WINDOW_MS);
  }
  pause(){
    if(this.state!=='recording')return;
    this.elapsedMs+=Math.max(0,Date.now()-this.resumeAt);
    try{this.recorder.pause();}catch(e){/* 部分实现不支持暂停 */}
    this.state='paused';
  }
  resume(){
    if(this.state!=='paused')return;
    try{this.recorder.resume();}catch(e){/* 与 pause 对应 */}
    this.resumeAt=Date.now();
    this.state='recording';
  }
  window(){
    if(this.state!=='recording'||!this.analyser)return;
    if(this.elapsedSec()*1000>=MAX_MS){if(this.onAutoStop)this.onAutoStop();return;}
    let sum=0;
    this.analyser.getByteTimeDomainData(this.buf);
    for(let i=0;i<this.buf.length;i++){const v=(this.buf[i]-128)/128;sum+=v*v;}
    const rms=Math.sqrt(sum/this.buf.length);
    const t=this.elapsedSec();
    this.envelope.push(Math.round(rms*10000)/10000);
    const hist=this.windowVals;
    hist.push(rms);if(hist.length>HISTORY)hist.shift();
    let avg=0;for(const v of hist)avg+=v;avg/=Math.max(1,hist.length);
    const threshold=Math.max(FLOOR,avg*THRESHOLD_X);
    const vad=this.vad;
    if(!vad.inSpeech){
      if(rms>=threshold){vad.inSpeech=true;vad.speechStart=t;vad.lastLoud=t;vad.quietSince=0;}
    }else{
      if(rms>=threshold*0.5){vad.lastLoud=t;vad.quietSince=0;}
      else if(!vad.quietSince)vad.quietSince=t;
      if(vad.quietSince&&(t-vad.quietSince)*1000>=SILENCE_HOLD_MS){
        const start=vad.speechStart,end=vad.lastLoud;
        if((end-start)*1000>=MIN_SPEECH_MS)this.push(Math.round(((start+end)/2)*10)/10,'speech','');
        vad.inSpeech=false;vad.quietSince=0;vad.gapStart=end;vad.silenceMarked=false;
      }
    }
    if(!vad.inSpeech&&!vad.silenceMarked&&vad.gapStart>=0&&(t-vad.gapStart)*1000>=SILENCE_ANCHOR_MS){
      this.push(Math.round(vad.gapStart*10)/10,'silence','');
      vad.silenceMarked=true;
    }
  }
  push(time,type,label){
    const anchor={id:'a'+(++this.seq)+'-'+Math.round(time*10),time,type:type||'manual',label:label||'',slideId:null};
    this.anchors.push(anchor);
    return anchor;
  }
  markManual(label){
    const t=Math.round(this.elapsedSec()*10)/10;
    return this.push(t,'manual',label||('标记 '+fmt(t)));
  }
  stop(){
    return new Promise(resolve=>{
      const rec=this.recorder;
      if(!rec){resolve(null);return;}
      if(this.state==='recording')this.elapsedMs+=Math.max(0,Date.now()-this.resumeAt);
      clearInterval(this.timer);this.timer=0;
      const envelope=this.envelope,anchors=this.anchors,mime=this.mime,duration=this.elapsedMs/1000;
      rec.onstop=()=>{
        const blob=new Blob(this.chunks,{type:mime});
        try{if(this.stream)this.stream.getTracks().forEach(track=>track.stop());}catch(e){/* 已停止 */}
        try{if(this.ctx)this.ctx.close();}catch(e){/* 已关闭 */}
        this.state='idle';this.recorder=null;this.stream=null;this.ctx=null;this.analyser=null;
        resolve({blob,mime,duration,envelope,anchors});
      };
      try{rec.stop();}catch(e){rec.onstop();}
    });
  }
}

/* 录音回放：base64 → blob → objectURL。<audio> 交给调用方驱动。 */
export class Playback{
  constructor(){
    this.audio=new Audio();
    this.audio.preload='metadata';
    this.url=null;
    this.audio.addEventListener('loadedmetadata',()=>{
      /* MediaRecorder 产出的 webm 常缺少时长元数据（duration=Infinity），
         先跳到远处逼 WebView 计算真实时长，再回到开头。 */
      if(this.audio.duration===Infinity){
        const back=()=>{this.audio.removeEventListener('timeupdate',back);try{this.audio.currentTime=0;}catch(e){}};
        this.audio.addEventListener('timeupdate',back);
        try{this.audio.currentTime=1e7;}catch(e){back();}
      }
    });
  }
  load(base64,mime){
    this.release();
    const blob=base64ToBlob(base64,mime);
    if(!blob)return false;
    this.url=URL.createObjectURL(blob);
    this.audio.src=this.url;
    return true;
  }
  release(){
    try{this.audio.pause();}catch(e){/* 尚未播放 */}
    if(this.url){URL.revokeObjectURL(this.url);this.url=null;}
    this.audio.removeAttribute('src');
  }
}

export function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('音频数据读取失败'));
    reader.onload=()=>{const s=String(reader.result||'');resolve(s.slice(s.indexOf(',')+1));};
    reader.readAsDataURL(blob);
  });
}
export function base64ToBlob(b64,mime){
  try{
    const bin=atob(b64),bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new Blob([bytes],{type:mime||'audio/webm'});
  }catch(e){return null;}
}
export function fmt(sec){
  sec=Math.max(0,Math.floor(Number(sec)||0));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60,p=n=>String(n).padStart(2,'0');
  return h?p(h)+':'+p(m)+':'+p(s):p(m)+':'+p(s);
}
