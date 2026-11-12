/* 天工 · 专注番茄钟（纯逻辑，不依赖 DOM，方便单元测试）
 * 工作/短休/长休循环：每完成 4 个工作段进入长休。
 * 状态：{phase:'work'|'short'|'long', remaining:秒, running:bool,
 *        completed:累计完成工作段, cycle:当前循环内工作段(0-3),
 *        workMin, shortMin, longMin, today:{date, count}} */

export const DEFAULT_FOCUS=()=>({
  phase:'work',remaining:25*60,running:false,completed:0,cycle:0,
  workMin:25,shortMin:5,longMin:15,today:{date:'',count:0}
});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export function focusSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const d=DEFAULT_FOCUS();
  const phase=['work','short','long'].includes(r.phase)?r.phase:'work';
  const workMin=clamp(Math.round(num(r.workMin,25)),1,90);
  const shortMin=clamp(Math.round(num(r.shortMin,5)),1,30);
  const longMin=clamp(Math.round(num(r.longMin,15)),1,60);
  const maxSec=(phase==='work'?workMin:phase==='short'?shortMin:longMin)*60;
  const today=r.today&&typeof r.today==='object'&&typeof r.today.date==='string'
    ?{date:r.today.date.slice(0,10),count:clamp(Math.round(num(r.today.count,0)),0,999)}
    :{date:'',count:0};
  return {
    phase,
    remaining:clamp(Math.round(num(r.remaining,maxSec)),0,maxSec),
    running:r.running===true,
    completed:clamp(Math.round(num(r.completed,0)),0,99999),
    cycle:clamp(Math.round(num(r.cycle,0)),0,3),
    workMin,shortMin,longMin,today
  };
}

export function phaseSeconds(s,phase){
  return (phase==='work'?s.workMin:phase==='short'?s.shortMin:s.longMin)*60;
}

/* 开始/暂停 */
export function focusToggle(s){return {...s,running:!s.running};}

/* 重置当前段 */
export function focusReset(s){return {...s,running:false,remaining:phaseSeconds(s,s.phase)};}

/* 跳过当前段，进入下一段（不累计完成） */
export function focusSkip(s){return advance(s,false);}

function advance(s,countWork){
  let completed=s.completed,cycle=s.cycle,today=s.today;
  let next;
  if(s.phase==='work'){
    if(countWork){
      completed++;cycle=(cycle+1)%4;
      today={...today,count:today.count+1};
    }
    next=cycle===0&&countWork?'long':'short';
    /* 跳过工作段不进入长休判定，直接短休 */
    if(!countWork)next='short';
  }else{
    next='work';
  }
  return {...s,phase:next,remaining:phaseSeconds(s,next),running:false,completed,cycle,today};
}

/* 每秒 tick：running 时递减；到 0 自动进入下一段并累计。
 * 返回 {state, finished:bool} */
export function focusTick(s,dateStr){
  if(!s.running)return {state:s,finished:false};
  if(s.remaining>1)return {state:{...s,remaining:s.remaining-1},finished:false};
  /* 到 0：完成当前段 */
  let st={...s,remaining:0};
  if(st.phase==='work'){
    st={...st,completed:st.completed+1,cycle:(st.cycle+1)%4,
        today:{date:dateStr||st.today.date,count:(st.today.date===(dateStr||st.today.date)?st.today.count:0)+1}};
    const next=st.cycle===0?'long':'short';
    st={...st,phase:next,remaining:phaseSeconds(st,next),running:false};
  }else{
    st={...st,phase:'work',remaining:phaseSeconds(st,'work'),running:false};
  }
  return {state:st,finished:true};
}

/* 修改时长（分钟），重置当前段剩余 */
export function focusSetMinutes(s,key,minutes){
  const lim=key==='workMin'?[1,90]:key==='shortMin'?[1,30]:[1,60];
  const v=clamp(Math.round(num(minutes,s[key])),lim[0],lim[1]);
  const ns={...s,[key]:v};
  return {...ns,remaining:phaseSeconds(ns,ns.phase),running:false};
}

export function fmtTime(sec){
  const m=Math.floor(sec/60),ss=sec%60;
  return String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');
}