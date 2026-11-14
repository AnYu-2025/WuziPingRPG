/* 天工 · 医学生刷题（纯逻辑，不依赖 DOM，方便单元测试）
 * 题库由调用方传入 bank（内置+用户导入合并去重后的数组）。
 * 会话 {mode,subject,difficulty,ids,pos,answers:{qid:choice},finished}。判分即时反馈。
 * 注意：与 quiz.js（笔记出题器）是两个独立模块，互不影响。 */

import {QUIZ_BANK,QUIZ_SUBJECTS} from './quiz-data.js';

export const QUIZ_MODES=['order','random','wrong','star'];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const byId=(bank,id)=>bank.find(q=>q.id===id)||null;

export function quizStatsSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const wrong={};
  if(r.wrong&&typeof r.wrong==='object'){
    for(const k of Object.keys(r.wrong).slice(0,5000)){
      wrong[k]=clamp(Math.round(num(r.wrong[k],1)),1,99);
    }
  }
  const star={};
  if(r.star&&typeof r.star==='object'){
    for(const k of Object.keys(r.star).slice(0,5000)){
      if(r.star[k])star[k]=1;
    }
  }
  return {
    answered:clamp(Math.round(num(r.answered,0)),0,999999),
    right:clamp(Math.round(num(r.right,0)),0,999999),
    wrong,star,
    lastSubject:typeof r.lastSubject==='string'&&(r.lastSubject==='全部'||QUIZ_SUBJECTS.includes(r.lastSubject))?r.lastSubject:'全部',
    lastMode:QUIZ_MODES.includes(r.lastMode)?r.lastMode:'order',
    lastDifficulty:[0,1,2,3,4].includes(+r.lastDifficulty)?+r.lastDifficulty:0
  };
}

/* 收藏切换（不改其它字段）。 */
export function toggleStar(stats,qid){
  const s=quizStatsSanitize(stats);
  const star={...s.star};
  if(star[qid])delete star[qid];else star[qid]=1;
  return {...s,star};
}

/* 洗牌（可注入随机源便于测试）。 */
export function shuffle(arr,rnd){
  const a=arr.slice();
  const rand=typeof rnd==='function'?rnd:Math.random;
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

export function buildQuiz(stats,subject,mode,rnd,bank,difficulty){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  const s=quizStatsSanitize(stats);
  const subj=(subject==='全部'||QUIZ_SUBJECTS.includes(subject))?subject:'全部';
  const md=QUIZ_MODES.includes(mode)?mode:'order';
  const diff=[1,2,3,4].includes(+difficulty)?+difficulty:0;
  let pool=b.filter(q=>subj==='全部'||q.subject===subj);
  if(diff)pool=pool.filter(q=>q.difficulty===diff);
  if(md==='wrong')pool=pool.filter(q=>s.wrong[q.id]);
  if(md==='star')pool=pool.filter(q=>s.star[q.id]);
  let ids=pool.map(q=>q.id);
  if(md==='random')ids=shuffle(ids,rnd);
  /* 选项顺序打散，消除"正确答案总在A"的位置偏置；perm 按题固定于本会话。 */
  const perm={};
  const rand=typeof rnd==='function'?rnd:Math.random;
  for(const q of pool){
    const idx=q.options.map((_,i)=>i);
    for(let i=idx.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
    perm[q.id]=idx;
  }
  return {mode:md,subject:subj,difficulty:diff,ids,pos:0,answers:{},perm,finished:ids.length===0};
}

/* 本会话中某题的展示选项与正确选项的展示下标。 */
export function displayOptions(session,q){
  const p=(session&&session.perm&&session.perm[q.id])||q.options.map((_,i)=>i);
  return {options:p.map(i=>q.options[i]),answer:p.indexOf(q.answer),perm:p};
}

/* 用户已选答案对应的「展示下标」。
   注意：answers 里存的是原始下标，渲染标红/标绿必须换算回展示下标，
   否则答对时也会把另一个选项误标红。未作答返回 -1。 */
export function chosenDisplay(session,q){
  const a=session&&session.answers?session.answers[q.id]:null;
  if(a==null)return -1;
  const d=displayOptions(session,q);
  return d.perm.indexOf(a);
}

export function answerQuiz(session,qid,choice,bank){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  if(!session||session.finished)return session;
  const q=byId(b,qid);
  if(!q||session.answers[qid]!=null)return session;
  const c=clamp(Math.round(num(choice,-1)),0,q.options.length-1);
  return {...session,answers:{...session.answers,[qid]:c}};
}

export function nextQuiz(session){
  if(!session)return session;
  const pos=Math.min(session.ids.length,session.pos+1);
  return {...session,pos,finished:pos>=session.ids.length};
}

/* 判分后更新统计：答对从错题本移除，答错记一次。 */
export function gradeQuiz(stats,qid,choice,bank){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  const s=quizStatsSanitize(stats);
  const q=byId(b,qid);
  if(!q)return s;
  const ok=choice===q.answer;
  const wrong={...s.wrong};
  if(ok)delete wrong[qid];
  else wrong[qid]=(wrong[qid]||0)+1;
  return {...s,answered:s.answered+1,right:s.right+(ok?1:0),wrong};
}

export function accuracy(stats){
  const s=quizStatsSanitize(stats);
  return s.answered?Math.round(s.right/s.answered*100):0;
}

export function sessionSummary(session,bank){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  if(!session)return {total:0,right:0,wrong:0};
  let right=0,wrong=0;
  for(const qid of session.ids){
    const a=session.answers[qid];
    if(a==null)continue;
    const q=byId(b,qid);
    if(q&&a===q.answer)right++;else wrong++;
  }
  return {total:session.ids.length,right,wrong};
}

/* 会话恢复：中断后续刷。只接受结构合法的未完成会话；
   过滤掉已不在题库的 id，pos 收敛到有效范围。返回 null 表示无可恢复会话。 */
export function sanitizeSession(raw,bank){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  if(!raw||typeof raw!=='object')return null;
  if(!Array.isArray(raw.ids)||!raw.ids.length)return null;
  const ids=raw.ids.filter(id=>byId(b,id));
  if(!ids.length)return null;
  const answers={};
  if(raw.answers&&typeof raw.answers==='object'){
    for(const id of ids){
      const a=raw.answers[id];
      const q=byId(b,id);
      if(q&&Number.isFinite(+a)&&+a>=0&&+a<q.options.length)answers[id]=Math.round(+a);
    }
  }
  const perm={};
  for(const id of ids){
    const q=byId(b,id);
    const p=raw.perm&&Array.isArray(raw.perm[id])?raw.perm[id]:null;
    const valid=p&&p.length===q.options.length&&p.every(i=>Number.isInteger(i)&&i>=0&&i<q.options.length)&&new Set(p).size===p.length;
    perm[id]=valid?p:q.options.map((_,i)=>i);
  }
  const pos=clamp(Math.round(num(raw.pos,0)),0,ids.length);
  const mode=QUIZ_MODES.includes(raw.mode)?raw.mode:'order';
  const subject=typeof raw.subject==='string'&&(raw.subject==='全部'||QUIZ_SUBJECTS.includes(raw.subject))?raw.subject:'全部';
  const difficulty=[0,1,2,3,4].includes(+raw.difficulty)?+raw.difficulty:0;
  return {mode,subject,difficulty,ids,pos,answers,perm,finished:pos>=ids.length};
}

/* 交卷后错题回顾：返回本会话答错的题（含用户选择与正确项，原始下标）。 */
export function sessionWrongList(session,bank){
  const b=(bank&&bank.length)?bank:QUIZ_BANK;
  if(!session)return [];
  const out=[];
  for(const qid of session.ids){
    const a=session.answers[qid];
    if(a==null)continue;
    const q=byId(b,qid);
    if(!q||a===q.answer)continue;
    out.push({id:qid,q:q.q,subject:q.subject,options:q.options,chosen:a,answer:q.answer,explain:q.explain||''});
  }
  return out;
}