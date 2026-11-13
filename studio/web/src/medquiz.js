/* 天工 · 医学生刷题（纯逻辑，不依赖 DOM，方便单元测试）
 * 题库由调用方传入 bank（内置+用户导入合并去重后的数组）。
 * 会话 {mode,subject,difficulty,ids,pos,answers:{qid:choice},finished}。判分即时反馈。
 * 注意：与 quiz.js（笔记出题器）是两个独立模块，互不影响。 */

import {QUIZ_BANK,QUIZ_SUBJECTS} from './quiz-data.js';

export const QUIZ_MODES=['order','random','wrong'];
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
  return {
    answered:clamp(Math.round(num(r.answered,0)),0,999999),
    right:clamp(Math.round(num(r.right,0)),0,999999),
    wrong,
    lastSubject:typeof r.lastSubject==='string'&&(r.lastSubject==='全部'||QUIZ_SUBJECTS.includes(r.lastSubject))?r.lastSubject:'全部',
    lastMode:QUIZ_MODES.includes(r.lastMode)?r.lastMode:'order',
    lastDifficulty:[0,1,2,3].includes(+r.lastDifficulty)?+r.lastDifficulty:0
  };
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
  const diff=[1,2,3].includes(+difficulty)?+difficulty:0;
  let pool=b.filter(q=>subj==='全部'||q.subject===subj);
  if(diff)pool=pool.filter(q=>q.difficulty===diff);
  if(md==='wrong')pool=pool.filter(q=>s.wrong[q.id]);
  let ids=pool.map(q=>q.id);
  if(md==='random')ids=shuffle(ids,rnd);
  return {mode:md,subject:subj,difficulty:diff,ids,pos:0,answers:{},finished:ids.length===0};
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