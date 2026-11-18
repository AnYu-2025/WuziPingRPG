/* 天工 · 错题本（纯逻辑，不依赖 DOM，方便单元测试）
 * 每条错题 {id,subject,title,question,answer,reason,mastery,created,updated}
 * mastery: 0=未掌握 1=模糊 2=已掌握。按科目筛选、按掌握度统计。 */

import {QUIZ_SUBJECTS} from './quiz-data.js';
import {addCard} from './cards.js';

export const SUBJECTS=['数学','物理','化学','英语','语文','生物',...QUIZ_SUBJECTS,'其他'];
export const MASTERY=['未掌握','模糊','已掌握'];
/* 错因画像：记「为什么错」，统计分布并给针对性建议。 */
export const CAUSES=['概念不清','审题失误','粗心计算','完全不会'];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;
const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';

export function mistakeSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const title=str(r.title,120).trim();
  const question=str(r.question,2000);
  const answer=str(r.answer,2000);
  if(!title&&!question.trim())return null;
  const subject=SUBJECTS.includes(r.subject)?r.subject:'其他';
  return {
    id:Math.max(1,Math.floor(num(r.id,fallbackId))),
    subject,title:title||question.trim().slice(0,40),
    question,answer,reason:str(r.reason,1000),
    ...(typeof r.quizId==='string' && r.quizId ? {quizId:r.quizId} : {}),
    ...(Number.isSafeInteger(r.reviewCardId) && r.reviewCardId>0 ? {reviewCardId:r.reviewCardId} : {}),
    cause:CAUSES.includes(r.cause)?r.cause:'',
    mastery:clamp(Math.round(num(r.mastery,0)),0,2),
    created:Math.max(0,num(r.created,0)),
    updated:Math.max(0,num(r.updated,0))
  };
}

export function bookSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const items=[];
  const list=Array.isArray(r.items)?r.items.slice(0,500):[];
  for(const it of list){const s=mistakeSanitize(it,items.length+1);if(s)items.push(s);}
  const seen=new Set();
  for(const it of items){while(seen.has(it.id))it.id++;seen.add(it.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const it of items)nextId=Math.max(nextId,it.id+1);
  return {nextId,items};
}

export function addMistake(book,fields,now){
  const b=bookSanitize(book);
  if(b.items.length>=500)return {book:b,ok:false};
  const s=mistakeSanitize({...fields,created:now,updated:now},b.nextId);
  if(!s)return {book:b,ok:false};
  s.id=b.nextId;
  return {book:{nextId:b.nextId+1,items:[...b.items,s]},ok:true,item:s};
}

export function updateMistake(book,id,fields,now){
  const b=bookSanitize(book);
  let ok=false;
  const items=b.items.map(it=>{
    if(it.id!==id)return it;
    const merged=mistakeSanitize({...it,...fields,updated:now},it.id);
    if(!merged)return it;
    ok=true;return {...merged,created:it.created};
  });
  return {book:{nextId:b.nextId,items},ok};
}

export function setMastery(book,id,mastery,now){
  return updateMistake(book,id,{mastery},now);
}

export function recordQuizMistake(book, question, now) {
  const existing = book.items.find(item => item.quizId === question.id);
  if (existing) return setMastery(book, existing.id, 0, now);
  const choices = question.options.map((option, i) => `${'ABCDEF'[i]}. ${option}`);
  const answer = [question.options[question.answer], question.explain].filter(Boolean).join('\n');
  return addMistake(book, {
    quizId: question.id, subject: question.subject, title: question.q.slice(0, 40),
    question: [question.q, ...choices].join('\n'), answer,
  }, now);
}

export function unfiledQuizMistakes(book, wrong, bank) {
  const filed = new Set(book.items.map(item => item.quizId));
  return bank.filter(question => wrong[question.id] && !filed.has(question.id));
}

export function makeMistakeCard(book, deck, id, now) {
  const item = book.items.find(entry => entry.id === id);
  if (!item || !item.answer.trim()) return {ok:false, message:'请先补上正确答案。'};
  if (deck.cards.some(card => card.id === item.reviewCardId)) return {ok:false, message:'这道题已有复习卡。'};
  if (deck.cards.length >= 500) return {ok:false, message:'卡片已达 500 张。'};
  const result = addCard(deck, item.question || item.title, item.answer, now);
  if (!result.ok) return {ok:false, message:'请检查题目和答案。'};
  return {ok:true, deck:result.deck, book:updateMistake(book, id, {reviewCardId:result.card.id}, now).book};
}

export function removeMistake(book,id){
  const b=bookSanitize(book);
  return {nextId:b.nextId,items:b.items.filter(it=>it.id!==id)};
}

/* 筛选：subject='全部'或某科；mastery=-1 全部，否则 0/1/2。按 updated 降序。 */
export function filterMistakes(book,subject,mastery){
  const b=bookSanitize(book);
  return b.items
    .filter(it=>(subject==='全部'||it.subject===subject)&&(mastery<0||it.mastery===mastery))
    .sort((a,b2)=>b2.updated-a.updated||b2.id-a.id);
}

/* 错因分布 + 针对性建议：只统计已标记错因的题，不臆造。 */
export function causeStats(book){
  const b=bookSanitize(book);
  const byCause={};
  let tagged=0;
  for(const it of b.items){if(it.cause){byCause[it.cause]=(byCause[it.cause]||0)+1;tagged++;}}
  const top=Object.keys(byCause).sort((a,b2)=>byCause[b2]-byCause[a])[0]||'';
  const ADVICE={
    '概念不清':'先回教材/卡片把概念补上，再刷题巩固。',
    '审题失误':'做题先圈关键词，读完条件再动笔。',
    '粗心计算':'留出检查时间，分步写、回头验。',
    '完全不会':'这类题先看解析学思路，从基础题梯度练。'
  };
  return {byCause,tagged,total:b.items.length,top,advice:top?ADVICE[top]:''};
}

export function bookStats(book){
  const b=bookSanitize(book);
  const byMastery=[0,0,0],bySubject={};
  for(const it of b.items){
    byMastery[it.mastery]++;
    bySubject[it.subject]=(bySubject[it.subject]||0)+1;
  }
  const mastered=byMastery[2];
  const rate=b.items.length?Math.round(mastered/b.items.length*100):0;
  return {total:b.items.length,byMastery,bySubject,mastered,rate};
}
