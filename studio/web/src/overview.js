/* 天工 · 学习总览（纯逻辑，不依赖 DOM，方便单元测试）
 * 只做汇总，不新增数据源：全部复用各模块自己的 sanitize / stats，
 * 保证口径与模块内显示一致。缺失或脏数据一律按 0 处理，不臆造数字。 */

import {focusSanitize,lastNDays} from './focus.js';
import {deckSanitize,deckStats} from './cards.js';
import {bookSanitize,bookStats} from './mistakes.js';
import {habitsSanitize,habitsStats,currentStreak,isChecked} from './habits.js';
import {examsSanitize,sortExams,daysUntil,examProgress} from './exams.js';
import {scheduleSanitize,coursesOnDay,nowInfo,currentStatus} from './schedule.js';
import {quizStatsSanitize,accuracy} from './medquiz.js';
import {studyLogSanitize,dayCounts,lastNDaysStudy,weekReport} from './study-log.js';
import {buildPlan,buildRecap} from './study-plan.js';

const pad=x=>String(x).padStart(2,'0');
export function dayKey(d){
  const t=d instanceof Date?d:new Date(d);
  return t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate());
}

/* 七日活跃：专注段数 + 打卡次数，同一坐标系里两条真实数据。 */
export function weeklyActivity(state,now){
  const today=dayKey(now);
  const focus=focusSanitize(state&&state.focus);
  const days=lastNDays(focus.history||{},7,today);
  const habits=habitsSanitize(state&&state.habits).habits;
  return days.map(d=>{
    let checks=0;
    for(const h of habits)if(isChecked(h,d.date))checks++;
    return {date:d.date,focus:d.count,checks,total:d.count+checks};
  });
}

/* 今日待办：到期卡片、未掌握错题、未打卡习惯、今日课程。 */
export function todayTasks(state,now){
  const today=dayKey(now);
  const cards=deckStats(state&&state.cards,now);
  const mistakes=bookStats(state&&state.mistakes);
  const habits=habitsSanitize(state&&state.habits);
  const hs=habitsStats(habits,today);
  const sched=scheduleSanitize(state&&state.schedule);
  const info=nowInfo(now,sched.termStart);
  const courses=coursesOnDay(sched,info.day,info.week);
  const status=currentStatus(sched,info);
  const undone=habits.habits.filter(h=>!isChecked(h,today));
  return {
    cardsDue:cards.due,
    mistakesOpen:mistakes.total-mistakes.mastered,
    habitsLeft:Math.max(0,hs.total-hs.doneToday),
    habitsDone:hs.doneToday,
    habitsTotal:hs.total,
    undoneHabits:undone.map(h=>({id:h.id,name:h.name})),
    coursesToday:courses.length,
    nowCourse:status.now?{name:status.now.name,place:status.now.place}:null,
    nextCourse:status.next?{name:status.next.course.name,day:status.next.day,deltaMin:status.next.deltaMin}:null
  };
}

/* 各科掌握：错题本按科目统计（唯一有科目维度的真实数据）。 */
export function subjectMastery(state){
  const b=bookSanitize(state&&state.mistakes);
  const map={};
  for(const it of b.items){
    const k=it.subject||'其他';
    if(!map[k])map[k]={subject:k,total:0,mastered:0};
    map[k].total++;
    if(it.mastery===2)map[k].mastered++;
  }
  return Object.values(map)
    .map(x=>({...x,rate:x.total?Math.round(x.mastered/x.total*100):0}))
    .sort((a,b)=>b.total-a.total||a.subject.localeCompare(b.subject));
}

/* 最近考试：未考的按临近排序，取前 n 个。 */
export function upcomingExams(state,now,n=3){
  const sorted=sortExams(state&&state.exams,now);
  const out=[];
  for(const e of sorted){
    const d=daysUntil(e.date,now);
    if(!Number.isFinite(d)||d<0)continue;
    const p=examProgress(e);
    out.push({id:e.id,name:e.name,date:e.date,days:d,done:p.done,total:p.total,pct:p.pct});
    if(out.length>=n)break;
  }
  return out;
}

/* 连续学习天数：以「当天有专注/卡片/刷题/打卡任一动作」为准，从今天往回数；
 * 今天还没记录时从昨天起算，避免早上打开就显示断签。 */
export function studyStreak(state,now){
  const focus=focusSanitize(state&&state.focus);
  const habits=habitsSanitize(state&&state.habits).habits;
  const log=studyLogSanitize(state&&state.studyLog);
  const active=k=>{
    if(focus.history&&focus.history[k]>0)return true;
    for(const h of habits)if(isChecked(h,k))return true;
    const d=log.days[k];
    if(d&&(d.focus>0||d.cards>0||d.quiz>0))return true;
    return false;
  };
  const base=new Date(now);
  let cursor=new Date(base.getFullYear(),base.getMonth(),base.getDate());
  if(!active(dayKey(cursor)))cursor.setDate(cursor.getDate()-1);
  let n=0;
  while(active(dayKey(cursor))&&n<3650){n++;cursor.setDate(cursor.getDate()-1);}
  return n;
}

/* 一句话概览：只用已确认的数字，没有数据就说没有。 */
export function overviewLine(sum){
  if(!sum)return '';
  const bits=[];
  if(sum.tasks.cardsDue>0)bits.push(sum.tasks.cardsDue+' 张卡片到期');
  if(sum.tasks.habitsLeft>0)bits.push(sum.tasks.habitsLeft+' 个习惯没打卡');
  if(sum.tasks.mistakesOpen>0)bits.push(sum.tasks.mistakesOpen+' 道错题没吃透');
  if(sum.exams.length&&sum.exams[0].days<=30)bits.push('距「'+sum.exams[0].name+'」'+sum.exams[0].days+' 天');
  if(!bits.length)return sum.streak>0?('已连续学习 '+sum.streak+' 天，今天暂无待办。'):'今天暂无待办，去添加卡片或习惯开始吧。';
  return bits.join(' · ');
}

/* 从 habits.checks 推导每天的打卡数，供学习日历热力图/周报。 */
export function checksByDate(state){
  const map={};
  for(const h of habitsSanitize(state&&state.habits).habits){
    for(const k of Object.keys(h.checks||{})){map[k]=(map[k]||0)+1;}
  }
  return map;
}

export function buildOverview(state,now){
  const t=now==null?Date.now():now;
  const quiz=quizStatsSanitize(state&&state.medquiz);
  const cards=deckStats(state&&state.cards,t);
  const mistakes=bookStats(state&&state.mistakes);
  const tasks=todayTasks(state,t);
  const exams=upcomingExams(state,t,3);
  const streak=studyStreak(state,t);
  const week=weeklyActivity(state,t);
  /* 今日学习四宫格：专注/卡片/刷题来自学习日历，打卡由 habits 实时推导。 */
  const todayChecks=habitsSanitize(state&&state.habits).habits.filter(h=>isChecked(h,dayKey(t))).length;
  const todayStudy=dayCounts(state&&state.studyLog,dayKey(t),todayChecks);
  const checksMap=checksByDate(state);
  const heat=lastNDaysStudy(state&&state.studyLog,28,dayKey(t),checksMap);
  const report=weekReport(state&&state.studyLog,dayKey(t),checksMap);
  /* 今日驾驶舱：把真实数据汇成可解释建议与晚间复盘。 */
  const habitsAll=habitsSanitize(state&&state.habits).habits;
  const planInput={
    cardsDue:cards.due,
    habitsLeft:habitsAll.filter(h=>!isChecked(h,dayKey(t))).length,
    mistakesOpen:mistakes.total-mistakes.mastered,
    coursesToday:tasks.coursesToday,
    focusToday:todayStudy.focus,
    todayCards:todayStudy.cards,todayQuiz:todayStudy.quiz,todayChecks:todayStudy.checks,
    exams:sortExams(state&&state.exams,t).map(e=>({name:e.name,days:daysUntil(e.date,t)})),
    subjects:Object.entries(quiz.bySubject||{}).map(([subject,v])=>({subject,answered:v.answered,rate:v.answered?Math.round(v.right/v.answered*100):0}))
  };
  const plan=buildPlan(planInput);
  const recap=buildRecap(planInput,streak);
  const sum={
    today:dayKey(t),
    streak,
    tasks,
    todayStudy,
    heat,
    report,
    plan,
    recap,
    week,
    weekTotal:week.reduce((a,b)=>a+b.total,0),
    subjects:subjectMastery(state),
    exams,
    cards:{total:cards.total,due:cards.due,learned:cards.learned,mature:cards.mature},
    mistakes:{total:mistakes.total,mastered:mistakes.mastered,rate:mistakes.rate},
    quiz:{answered:quiz.answered,right:quiz.right,wrong:Object.keys(quiz.wrong).length,accuracy:accuracy(quiz)}
  };
  sum.line=overviewLine(sum);
  return sum;
}