/* 天工 · 潮声白噪音景（纯逻辑，不依赖 DOM/WebAudio，方便单元测试）
 * 混音台状态 {layers:{id:{on,vol}},master,preset,timerEnd}。
 * 声音由 soundscape-audio.js 用 WebAudio 程序合成；这里只管状态/预设/定时。 */

export const LAYERS=[
  {id:'rain',name:'雨',icon:'🌧',desc:'细密雨丝'},
  {id:'wind',name:'风',icon:'🍃',desc:'掠过旷野'},
  {id:'waves',name:'海浪',icon:'🌊',desc:'潮起潮落'},
  {id:'fire',name:'篝火',icon:'🔥',desc:'噼啪火星'},
  {id:'night',name:'夜虫',icon:'🌙',desc:'夏夜虫鸣'},
  {id:'cafe',name:'咖啡馆',icon:'☕',desc:'人声低语'},
  {id:'white',name:'白噪',icon:'📻',desc:'均匀遮蔽'},
  {id:'brown',name:'棕噪',icon:'🟤',desc:'低沉轰鸣'}
];
export const LAYER_IDS=LAYERS.map(l=>l.id);

export const PRESETS=[
  {id:'focus',name:'深度专注',icon:'🎧',mix:{white:.35,cafe:.25}},
  {id:'rainynight',name:'雨夜',icon:'🌧',mix:{rain:.6,wind:.25,thunder:.3}},
  {id:'campfire',name:'篝火',icon:'🔥',mix:{fire:.6,wind:.2,night:.3}},
  {id:'seaside',name:'海边',icon:'🌊',mix:{waves:.6,wind:.3}},
  {id:'cafe',name:'咖啡馆',icon:'☕',mix:{cafe:.5,white:.15}},
  {id:'sleep',name:'助眠',icon:'😴',mix:{brown:.4,rain:.2}}
];
/* 预设里允许出现但不在主混音条的层（如 thunder）也合成。 */
export const EXTRA_IDS=['thunder'];

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export function defaultSoundscape(){
  const layers={};
  for(const id of LAYER_IDS)layers[id]={on:false,vol:.5};
  return {layers,master:.8,preset:'',timerEnd:0};
}

export function soundscapeSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const base=defaultSoundscape();
  const layers={};
  for(const id of LAYER_IDS){
    const src=r.layers&&r.layers[id];
    layers[id]={on:!!(src&&src.on),vol:clamp(num(src&&src.vol,.5),0,1)};
  }
  return {
    layers,
    master:clamp(num(r.master,.8),0,1),
    preset:typeof r.preset==='string'&&PRESETS.some(p=>p.id===r.preset)?r.preset:'',
    timerEnd:Math.max(0,num(r.timerEnd,0))
  };
}

export function setLayer(state,id,on,vol){
  const s=soundscapeSanitize(state);
  if(!s.layers[id])return s;
  s.layers[id]={on:on===undefined?s.layers[id].on:!!on,vol:vol===undefined?s.layers[id].vol:clamp(num(vol,.5),0,1)};
  s.preset='';
  return s;
}
export function setMaster(state,v){
  const s=soundscapeSanitize(state);
  s.master=clamp(num(v,.8),0,1);
  return s;
}

export function applyPreset(state,presetId){
  const p=PRESETS.find(x=>x.id===presetId);
  const s=soundscapeSanitize(state);
  if(!p)return s;
  for(const id of LAYER_IDS)s.layers[id]={on:false,vol:.5};
  for(const [id,v] of Object.entries(p.mix)){
    if(s.layers[id])s.layers[id]={on:true,vol:clamp(v,0,1)};
  }
  s.preset=p.id;
  return s;
}

/* 睡眠定时：timerEnd 为毫秒时间戳。 */
export function startTimer(state,minutes,now){
  const s=soundscapeSanitize(state);
  const m=clamp(Math.round(num(minutes,0)),0,240);
  s.timerEnd=m>0?now+m*60000:0;
  return s;
}
export function clearTimer(state){
  const s=soundscapeSanitize(state);
  s.timerEnd=0;
  return s;
}
export function timerRemaining(state,now){
  const s=soundscapeSanitize(state);
  if(!s.timerEnd)return 0;
  return Math.max(0,Math.ceil((s.timerEnd-now)/1000));
}
/* 淡出系数：剩余 fadeSec 内从 1 线性降到 0。 */
export function fadeGain(remainingSec,fadeSec=20){
  if(remainingSec<=0)return 0;
  if(remainingSec>=fadeSec)return 1;
  return remainingSec/fadeSec;
}
export function activeLayers(state){
  const s=soundscapeSanitize(state);
  return LAYER_IDS.filter(id=>s.layers[id].on);
}