/* 天工 · 错题本（纯逻辑，不依赖 DOM，方便单元测试）
 * 每条错题 {id,subject,title,question,answer,reason,mastery,created,updated}
 * mastery: 0=未掌握 1=模糊 2=已掌握。按科目筛选、按掌握度统计。 */

export const SUBJECTS=['数学','物理','化学','英语','语文','生物','其他'];
export const MASTERY=['未掌握','模糊','已掌握'];
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