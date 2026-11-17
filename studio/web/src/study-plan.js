/* 天工 · 今日建议引擎（纯逻辑，可单测，完全离线）
 * 把各模块真实数据（到期卡片/薄弱科目/未掌握错题/临近DDL/未打卡/今日专注）
 * 汇成按优先级排序、可解释的「今天做什么」建议；每条带一键直达参数。
 * 不联网、不臆造数据：所有理由都引用真实计数，无数据时给出引导而非假建议。 */

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export function planSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const cardsDue=clamp(Math.round(num(r.cardsDue,0)),0,9999);
  const habitsLeft=clamp(Math.round(num(r.habitsLeft,0)),0,99);
  const mistakesOpen=clamp(Math.round(num(r.mistakesOpen,0)),0,9999);
  const coursesToday=clamp(Math.round(num(r.coursesToday,0)),0,99);
  const focusToday=clamp(Math.round(num(r.focusToday,0)),0,999);
  const exams=(Array.isArray(r.exams)?r.exams:[])
    .filter(e=>e&&typeof e.name==='string'&&Number.isFinite(+e.days))
    .slice(0,8)
    .map(e=>({name:String(e.name).slice(0,40),days:clamp(Math.round(+e.days),-999,999)}));
  const subjects=(Array.isArray(r.subjects)?r.subjects:[])
    .filter(s=>s&&typeof s.subject==='string'&&num(s.answered,0)>0)
    .slice(0,20)
    .map(s=>({subject:s.subject,answered:clamp(Math.round(num(s.answered,0)),0,99999),rate:clamp(Math.round(num(s.rate,0)),0,100)}));
  const topCause=typeof r.topCause==='string'?r.topCause:'';
  return {cardsDue,habitsLeft,mistakesOpen,coursesToday,focusToday,exams,subjects,topCause};
}

/* 生成今日建议：优先级=临近DDL>到期卡片>薄弱科目>错题>打卡>专注>引导。
   每条 {id,icon,title,reason,cta,mode,params,priority}。 */
export function buildPlan(raw){
  const d=planSanitize(raw);
  const out=[];
  /* 1 临近任务（7天内） */
  const soon=d.exams.filter(e=>e.days>=0&&e.days<=7).sort((a,b)=>a.days-b.days);
  if(soon.length){
    const e=soon[0];
    out.push({id:'exam',icon:'⏳',priority:100+(7-e.days),
      title:'先顾「'+e.name+'」',
      reason:e.days===0?'就是今天截止，别拖到最后。':'还有 '+e.days+' 天截止，今天推进一点。',
      cta:'看任务',mode:'exams',params:{}});
  }
  /* 2 到期卡片 */
  if(d.cardsDue>0){
    out.push({id:'cards',icon:'🗂',priority:80+Math.min(d.cardsDue,20),
      title:'复习 '+d.cardsDue+' 张到期卡片',
      reason:'间隔重复到期了，现在复习记忆效果最好。',
      cta:'开始复习',mode:'cards',params:{auto:'review'}});
  }
  /* 3 薄弱科目（正确率<60 且答过>=5） */
  const weak=d.subjects.filter(s=>s.rate<60&&s.answered>=5).sort((a,b)=>a.rate-b.rate)[0];
  if(weak){
    out.push({id:'weak',icon:'✍️',priority:60+(60-weak.rate),
      title:'补「'+weak.subject+'」（正确率 '+weak.rate+'%）',
      reason:'这科答了 '+weak.answered+' 题只对 '+weak.rate+'%，值得专项刷一轮。',
      cta:'刷这科',mode:'medquiz',params:{auto:'quiz',subject:weak.subject}});
  }
  /* 4 未掌握错题（结合错因画像给针对性理由） */
  if(d.mistakesOpen>0){
    const CAUSE_TIP={'概念不清':'多为概念不清，先补概念再回顾。','审题失误':'多为审题失误，回顾时先圈关键词。','粗心计算':'多为粗心，回顾时重算一遍。','完全不会':'多为完全不会，先看解析学思路。'};
    out.push({id:'mist',icon:'📝',priority:50+Math.min(d.mistakesOpen,10),
      title:'吃透 '+d.mistakesOpen+' 道错题',
      reason:d.topCause&&CAUSE_TIP[d.topCause]?CAUSE_TIP[d.topCause]:'错题不回顾，下次还会错。',
      cta:'去回顾',mode:'mistakes',params:{}});
  }
  /* 5 未打卡 */
  if(d.habitsLeft>0){
    out.push({id:'habit',icon:'🌱',priority:40+d.habitsLeft,
      title:'还有 '+d.habitsLeft+' 个习惯没打卡',
      reason:'连续记录别断在今天。',
      cta:'去打卡',mode:'habits',params:{}});
  }
  /* 6 今日还没专注（仅在有其它学习信号时建议，空数据走引导） */
  const hasSignal=d.cardsDue>0||d.habitsLeft>0||d.mistakesOpen>0||d.coursesToday>0||d.exams.length>0||d.subjects.length>0||d.focusToday>0;
  if(hasSignal&&d.focusToday===0){
    out.push({id:'focus',icon:'🍅',priority:30,
      title:'来一个 25 分钟专注',
      reason:'今天还没开始专注，先做一个番茄进入状态。',
      cta:'开始专注',mode:'focus',params:{auto:'focus'}});
  }
  /* 7 完全无学习信号时的引导（有任一真实数据就不给假引导） */
  if(!hasSignal){
    out.push({id:'seed',icon:'✨',priority:10,
      title:'从今天的第一道题开始',
      reason:'还没有学习记录，刷几道题、加几张卡片，建议就会越来越准。',
      cta:'去刷题',mode:'medquiz',params:{auto:'quiz'}});
    return out;
  }
  return out.sort((a,b)=>b.priority-a.priority).slice(0,3);
}

/* 晚间复盘：今日四类计数 + 连续天数 + 明天预告。 */
export function buildRecap(raw,streak){
  const d=planSanitize(raw);
  const done={focus:d.focusToday,cards:clamp(Math.round(num(raw&&raw.todayCards,0)),0,9999),quiz:clamp(Math.round(num(raw&&raw.todayQuiz,0)),0,9999),checks:clamp(Math.round(num(raw&&raw.todayChecks,0)),0,99)};
  const sum=done.focus+done.cards+done.quiz+done.checks;
  const tone=sum===0?'rest':sum<6?'light':'good';
  const headline=tone==='rest'?'今天还没开始，明天早点出发':tone==='light'?'今天小步前进，保持住':'今天学得很扎实，给自己点个赞';
  const next=buildPlan(raw)[0];
  return {done,sum,streak:clamp(Math.round(num(streak,0)),0,9999),tone,headline,next:next?{title:next.title,cta:next.cta,mode:next.mode,params:next.params}:null};
}