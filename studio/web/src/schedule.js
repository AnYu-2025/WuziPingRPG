/* 天工 · 课程表（纯逻辑，不依赖 DOM，方便单元测试）
 * 周课表：7 天 × 12 节。课程 {id,name,place,teacher,day,start,len,color,weeks}。
 * weeks 为空数组=每周都上；否则只在上那些周。day 1=周一..7=周日。
 * 提供"正在上 / 下一节课"实时判定与冲突检测。 */

export const DAYS=['周一','周二','周三','周四','周五','周六','周日'];
/* 常见高校作息（分钟） */
export const PERIODS=[
  [480,525],[535,580],[600,645],[655,700],
  [840,885],[895,940],[960,1005],[1015,1060],
  [1140,1185],[1195,1240],[1250,1295],[1305,1350]
];
export const COURSE_COLORS=['#e05545','#f6a13c','#c7a24b','#4f8f7b','#2fd4bf','#5b8cff','#8a6fc0','#ff5dc8'];
const DAYMS=86400000;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';

export function courseSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const name=str(r.name,40).trim();
  if(!name)return null;
  const start=clamp(Math.round(num(r.start,1)),1,12);
  const len=clamp(Math.round(num(r.len,2)),1,12-start+1);
  const weeks=Array.isArray(r.weeks)?[...new Set(r.weeks.map(w=>clamp(Math.round(num(w,0)),1,30)).filter(w=>w>=1))].sort((a,b)=>a-b):[];
  return {
    id:Math.max(1,Math.floor(num(r.id,fallbackId))),
    name,place:str(r.place,40),teacher:str(r.teacher,20),
    day:clamp(Math.round(num(r.day,1)),1,7),
    start,len,
    color:clamp(Math.round(num(r.color,0)),0,COURSE_COLORS.length-1),
    weeks
  };
}

export function scheduleSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const courses=[];
  const list=Array.isArray(r.courses)?r.courses.slice(0,200):[];
  for(const c of list){const s=courseSanitize(c,courses.length+1);if(s)courses.push(s);}
  const seen=new Set();
  for(const c of courses){while(seen.has(c.id))c.id++;seen.add(c.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const c of courses)nextId=Math.max(nextId,c.id+1);
  const termStart=(/^\d{4}-\d{2}-\d{2}$/).test(r.termStart||'')?r.termStart:'';
  return {nextId,termStart,courses};
}

/* 两门课是否在同一天、节次重叠、周次相交。 */
export function conflicts(a,b){
  if(a.day!==b.day)return false;
  const aS=a.start,aE=a.start+a.len-1,bS=b.start,bE=b.start+b.len-1;
  if(aE<bS||bE<aS)return false;
  if(!a.weeks.length||!b.weeks.length)return true;
  return a.weeks.some(w=>b.weeks.includes(w));
}

export function addCourse(sched,fields){
  const s=scheduleSanitize(sched);
  const c=courseSanitize({...fields},s.nextId);
  if(!c)return {sched:s,ok:false};
  if(s.courses.some(x=>conflicts(x,c)))return {sched:s,ok:false,conflict:true};
  c.id=s.nextId;
  return {sched:{...s,nextId:s.nextId+1,courses:[...s.courses,c]},ok:true,course:c};
}
export function updateCourse(sched,id,fields){
  const s=scheduleSanitize(sched);
  const cur=s.courses.find(c=>c.id===id);
  if(!cur)return {sched:s,ok:false};
  const merged=courseSanitize({...cur,...fields},id);
  if(!merged)return {sched:s,ok:false};
  if(s.courses.some(x=>x.id!==id&&conflicts(x,merged)))return {sched:s,ok:false,conflict:true};
  return {sched:{...s,courses:s.courses.map(c=>c.id===id?merged:c)},ok:true};
}
export function removeCourse(sched,id){
  const s=scheduleSanitize(sched);
  return {...s,courses:s.courses.filter(c=>c.id!==id)};
}

export function weekActive(course,week){
  return !course.weeks.length||course.weeks.includes(week);
}
export function coursesOnDay(sched,day,week){
  return scheduleSanitize(sched).courses
    .filter(c=>c.day===day&&weekActive(c,week))
    .sort((a,b)=>a.start-b.start||a.id-b.id);
}

/* 由日期与开学日推算 {day,minutes,week}。 */
export function nowInfo(date,termStart){
  const d=date instanceof Date?date:new Date(date);
  const day=((d.getDay()+6)%7)+1;
  const minutes=d.getHours()*60+d.getMinutes();
  let week=1;
  if(termStart){
    const t=new Date(termStart+'T00:00:00');
    const a=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    week=clamp(Math.floor((a-t)/(7*DAYMS))+1,1,30);
  }
  return {day,minutes,week};
}

/* 正在上 / 下一节课。next 带 day 与 deltaMin（今天为分钟差，跨天为 null）。 */
export function currentStatus(sched,info){
  const s=scheduleSanitize(sched);
  const today=coursesOnDay(s,info.day,info.week);
  let now=null,next=null;
  for(const c of today){
    const [ps,pe]=PERIODS[c.start-1];
    const end=PERIODS[c.start+c.len-2]?PERIODS[c.start+c.len-2][1]:pe;
    if(info.minutes>=ps&&info.minutes<end){now=c;break;}
  }
  for(const c of today){
    const ps=PERIODS[c.start-1][0];
    if(ps>info.minutes){next={course:c,day:info.day,deltaMin:ps-info.minutes};break;}
  }
  if(!next){
    for(let off=1;off<=7;off++){
      const day=((info.day-1+off)%7)+1;
      const list=coursesOnDay(s,day,info.week);
      if(list.length){next={course:list[0],day,deltaMin:null};break;}
    }
  }
  return {now,next,week:info.week,day:info.day};
}

export function fmtMin(m){
  const h=Math.floor(m/60),mm=m%60;
  return String(h).padStart(2,'0')+':'+String(mm).padStart(2,'0');
}
export function weeksText(c){
  if(!c.weeks.length)return '每周';
  if(c.weeks.length>6)return c.weeks[0]+'-'+c.weeks[c.weeks.length-1]+'周';
  return c.weeks.join(',')+'周';
}