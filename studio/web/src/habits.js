/* 天工 · 习惯打卡（纯逻辑，不依赖 DOM，方便单元测试）
 * 每个习惯 {id,name,created,checks:{'YYYY-MM-DD':1}}。
 * 连续天数 currentStreak：从今天往回数连续打卡；今天没打则从昨天往回（允许当天还没打）。
 * 最佳纪录 bestStreak：历史最长连续段。日期用 UTC 天序号比较，避免时区/夏令时干扰。 */

const DAY=86400000;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const pad=x=>String(x).padStart(2,'0');

/* 'YYYY-MM-DD' -> 整数天序号（UTC，稳定）。非法返回 NaN。 */
export function dayIndex(dateStr){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr||''))return NaN;
  const t=Date.parse(dateStr+'T00:00:00Z');
  return Number.isFinite(t)?Math.round(t/DAY):NaN;
}
export function indexToDay(idx){
  const d=new Date(idx*DAY);
  return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());
}

export function habitSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const name=typeof r.name==='string'?r.name.trim().slice(0,40):'';
  if(!name)return null;
  const checks={};
  if(r.checks&&typeof r.checks==='object'){
    for(const k of Object.keys(r.checks).slice(0,2000)){
      if(/^\d{4}-\d{2}-\d{2}$/.test(k))checks[k]=1;
    }
  }
  return {
    id:Math.max(1,Math.floor(num(r.id,fallbackId))),
    name,
    created:Math.max(0,num(r.created,0)),
    checks
  };
}

export function habitsSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const habits=[];
  const list=Array.isArray(r.habits)?r.habits.slice(0,100):[];
  for(const h of list){const s=habitSanitize(h,habits.length+1);if(s)habits.push(s);}
  const seen=new Set();
  for(const h of habits){while(seen.has(h.id))h.id++;seen.add(h.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const h of habits)nextId=Math.max(nextId,h.id+1);
  return {nextId,habits};
}

export function addHabit(book,name,now){
  const b=habitsSanitize(book);
  const n=String(name||'').trim().slice(0,40);
  if(!n)return {book:b,ok:false};
  if(b.habits.some(h=>h.name===n))return {book:b,ok:false,dup:true};
  const habit={id:b.nextId,name:n,created:now||0,checks:{}};
  return {book:{nextId:b.nextId+1,habits:[...b.habits,habit]},ok:true,habit};
}

export function removeHabit(book,id){
  const b=habitsSanitize(book);
  return {nextId:b.nextId,habits:b.habits.filter(h=>h.id!==id)};
}

export function isChecked(habit,dateStr){
  return !!(habit&&habit.checks&&habit.checks[dateStr]);
}

/* 切换某天的打卡，返回新 book（不改输入）。 */
export function toggleCheck(book,id,dateStr){
  const b=habitsSanitize(book);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr||''))return b;
  const habits=b.habits.map(h=>{
    if(h.id!==id)return h;
    const checks={...h.checks};
    if(checks[dateStr])delete checks[dateStr];else checks[dateStr]=1;
    return {...h,checks};
  });
  return {nextId:b.nextId,habits};
}

/* 当前连续天数：今天打了从今天数，否则从昨天数。 */
export function currentStreak(habit,todayStr){
  if(!habit||!habit.checks)return 0;
  let idx=dayIndex(todayStr);
  if(!Number.isFinite(idx))return 0;
  if(!habit.checks[indexToDay(idx)])idx-=1;
  let n=0;
  while(habit.checks[indexToDay(idx)]){n++;idx-=1;}
  return n;
}

/* 历史最长连续段。 */
export function bestStreak(habit){
  if(!habit||!habit.checks)return 0;
  const idxs=Object.keys(habit.checks).map(dayIndex).filter(Number.isFinite).sort((a,b)=>a-b);
  let best=0,run=0,prev=null;
  for(const i of idxs){
    if(prev!==null&&i===prev+1)run++;else run=1;
    if(run>best)best=run;
    prev=i;
  }
  return best;
}

export function totalChecks(habit){
  return habit&&habit.checks?Object.keys(habit.checks).length:0;
}

/* 最近 n 天（含今天）的 {date,done} 序列。 */
export function lastNDaysChecks(habit,n,todayStr){
  const base=dayIndex(todayStr);
  const out=[];
  for(let i=n-1;i>=0;i--){
    const date=indexToDay(base-i);
    out.push({date,done:isChecked(habit,date)});
  }
  return out;
}

export function habitsStats(book,todayStr){
  const b=habitsSanitize(book);
  let doneToday=0,totalChecksAll=0;
  for(const h of b.habits){
    if(isChecked(h,todayStr))doneToday++;
    totalChecksAll+=totalChecks(h);
  }
  return {total:b.habits.length,doneToday,totalChecks:totalChecksAll};
}