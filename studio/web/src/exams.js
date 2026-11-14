/* 天工 · 考试倒计时（纯逻辑，不依赖 DOM，方便单元测试）
 * 考试 {id,name,date:'YYYY-MM-DD',milestones:[{id,label,done}]}。
 * 天数按本地日历日差计算（含今天=0），避免时区/夏令时干扰。 */

const DAY=86400000;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const pad=x=>String(x).padStart(2,'0');

export function parseDay(dateStr){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr||''))return NaN;
  const [y,m,d]=dateStr.split('-').map(Number);
  const t=new Date(y,m-1,d).getTime();
  return Number.isFinite(t)?t:NaN;
}
export function todayStr(now){
  const d=now instanceof Date?now:new Date(now);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
/* 考试日距今天的天数：今天=0，明天=1，昨天=-1。 */
export function daysUntil(dateStr,now){
  const a=parseDay(dateStr),b=parseDay(todayStr(now));
  if(!Number.isFinite(a)||!Number.isFinite(b))return NaN;
  return Math.round((a-b)/DAY);
}

export function milestoneSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const label=typeof r.label==='string'?r.label.trim().slice(0,60):'';
  if(!label)return null;
  return {id:Math.max(1,Math.floor(num(r.id,fallbackId))),label,done:r.done===true};
}

export function examSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const name=typeof r.name==='string'?r.name.trim().slice(0,40):'';
  if(!name)return null;
  if(!Number.isFinite(parseDay(r.date)))return null;
  const milestones=[];
  const list=Array.isArray(r.milestones)?r.milestones.slice(0,30):[];
  for(const m of list){const s=milestoneSanitize(m,milestones.length+1);if(s)milestones.push(s);}
  const seen=new Set();
  for(const m of milestones){while(seen.has(m.id))m.id++;seen.add(m.id);}
  let nextM=1;for(const m of milestones)nextM=Math.max(nextM,m.id+1);
  return {id:Math.max(1,Math.floor(num(r.id,fallbackId))),name,date:r.date,milestones,nextM};
}

export function examsSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const exams=[];
  const list=Array.isArray(r.exams)?r.exams.slice(0,50):[];
  for(const e of list){const s=examSanitize(e,exams.length+1);if(s)exams.push(s);}
  const seen=new Set();
  for(const e of exams){while(seen.has(e.id))e.id++;seen.add(e.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const e of exams)nextId=Math.max(nextId,e.id+1);
  return {nextId,exams};
}

export function addExam(store,name,date){
  const s=examsSanitize(store);
  const n=String(name||'').trim().slice(0,40);
  if(!n||!Number.isFinite(parseDay(date)))return {store:s,ok:false};
  if(s.exams.some(e=>e.name===n&&e.date===date))return {store:s,ok:false,dup:true};
  const exam={id:s.nextId,name:n,date,milestones:[],nextM:1};
  return {store:{nextId:s.nextId+1,exams:[...s.exams,exam]},ok:true,exam};
}
export function removeExam(store,id){
  const s=examsSanitize(store);
  return {nextId:s.nextId,exams:s.exams.filter(e=>e.id!==id)};
}
export function addMilestone(store,examId,label){
  const s=examsSanitize(store);
  const l=String(label||'').trim().slice(0,60);
  if(!l)return {store:s,ok:false};
  let ok=false;
  const exams=s.exams.map(e=>{
    if(e.id!==examId||e.milestones.length>=30)return e;
    ok=true;
    return {...e,nextM:e.nextM+1,milestones:[...e.milestones,{id:e.nextM,label:l,done:false}]};
  });
  return {store:{nextId:s.nextId,exams},ok};
}
export function toggleMilestone(store,examId,mId){
  const s=examsSanitize(store);
  const exams=s.exams.map(e=>e.id!==examId?e:{...e,milestones:e.milestones.map(m=>m.id===mId?{...m,done:!m.done}:m)});
  return {nextId:s.nextId,exams};
}
export function removeMilestone(store,examId,mId){
  const s=examsSanitize(store);
  const exams=s.exams.map(e=>e.id!==examId?e:{...e,milestones:e.milestones.filter(m=>m.id!==mId)});
  return {nextId:s.nextId,exams};
}

/* 排序：未到的在前（越近越前），已过的在后（越近越前）。 */
export function sortExams(store,now){
  const s=examsSanitize(store);
  const t=parseDay(todayStr(now));
  return s.exams.slice().sort((a,b)=>{
    const da=Math.round((parseDay(a.date)-t)/DAY),db=Math.round((parseDay(b.date)-t)/DAY);
    const fa=da<0?1:0,fb=db<0?1:0;
    if(fa!==fb)return fa-fb;
    return fa?db-da:da-db;
  });
}
export function examProgress(exam){
  const total=exam.milestones.length;
  const done=exam.milestones.filter(m=>m.done).length;
  return {total,done,pct:total?Math.round(done/total*100):0};
}
export function countdownText(exam,now){
  const d=daysUntil(exam.date,now);
  if(!Number.isFinite(d))return '';
  if(d>0)return '还有 '+d+' 天';
  if(d===0)return '就是今天';
  return '已过 '+(-d)+' 天';
}