/* 天工 · 学习日历（纯逻辑，不依赖 DOM，方便单元测试）
 * 把专注/卡片/刷题/打卡四类学习动作按天累计，供总览「今日学习」与连续学习天数。
 * 结构 {days:{'YYYY-MM-DD':{focus,cards,quiz,checks}}}，只保留最近 90 天。
 * 打卡数不在此累计（避免取消打卡难以回退），由 habits.checks 实时推导。 */

const MAX_DAYS=90;
const METRICS=['focus','cards','quiz'];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const isDay=k=>/^\d{4}-\d{2}-\d{2}$/.test(k||'');

export function studyLogSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const days={};
  if(r.days&&typeof r.days==='object'){
    for(const k of Object.keys(r.days)){
      if(!isDay(k))continue;
      const v=r.days[k];
      if(!v||typeof v!=='object')continue;
      days[k]={
        focus:clamp(Math.round(num(v.focus,0)),0,999),
        cards:clamp(Math.round(num(v.cards,0)),0,9999),
        quiz:clamp(Math.round(num(v.quiz,0)),0,9999)
      };
    }
  }
  /* 只留最近 MAX_DAYS 天 */
  const keys=Object.keys(days).sort();
  while(keys.length>MAX_DAYS)delete days[keys.shift()];
  return {days};
}

/* 给某天的某个指标 +n（默认 1），返回新 log（不改输入）。非法日期/指标原样返回。 */
export function logStudy(log,dateStr,metric,n=1){
  const s=studyLogSanitize(log);
  if(!isDay(dateStr)||!METRICS.includes(metric))return s;
  const d=s.days[dateStr]||{focus:0,cards:0,quiz:0};
  const inc=clamp(Math.round(num(n,1)),1,999);
  const days={...s.days,[dateStr]:{...d,[metric]:clamp(d[metric]+inc,0,9999)}};
  return studyLogSanitize({days});
}

/* 某天的四类计数：focus/cards/quiz 来自 log，checks 由调用方传入（habits 实时推导）。 */
export function dayCounts(log,dateStr,checks=0){
  const s=studyLogSanitize(log);
  const d=s.days[dateStr]||{focus:0,cards:0,quiz:0};
  return {focus:d.focus,cards:d.cards,quiz:d.quiz,checks:clamp(Math.round(num(checks,0)),0,999),
          total:d.focus+d.cards+d.quiz+clamp(Math.round(num(checks,0)),0,999)};
}

/* 当天是否有学习动作（任一指标 >0）。 */
export function dayActive(log,dateStr,checks=0){
  return dayCounts(log,dateStr,checks).total>0;
}