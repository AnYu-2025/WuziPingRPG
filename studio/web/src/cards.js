/* 天工 · 记忆卡片（纯逻辑，不依赖 DOM，方便单元测试）
 * 间隔重复：简化 SM-2。每张卡 {id,front,back,ease,interval,reps,due,lapses}。
 * 评分 0=忘了 1=困难 2=良好 3=轻松。
 *  - 忘了：reps 归零、interval=0（10 分钟后再见，用 due=now+10min）、ease-0.2、lapses+1
 *  - 其余：reps+1；interval 依次 1天、3天、之后 round(interval*ease)；ease 按评分微调
 * 到期队列：due<=now 的卡，按 due 升序。 */

export const DAY=86400000;
export const MIN_EASE=1.3, MAX_EASE=2.8;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export function cardSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const front=typeof r.front==='string'?r.front.slice(0,500):'';
  const back=typeof r.back==='string'?r.back.slice(0,1000):'';
  if(!front.trim()||!back.trim())return null;
  return {
    id:Math.max(1,Math.floor(num(r.id,fallbackId))),
    front,back,
    ease:clamp(num(r.ease,2.5),MIN_EASE,MAX_EASE),
    interval:clamp(Math.round(num(r.interval,0)),0,3650),
    reps:clamp(Math.round(num(r.reps,0)),0,9999),
    due:Math.max(0,num(r.due,0)),
    lapses:clamp(Math.round(num(r.lapses,0)),0,9999)
  };
}

export function deckSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const cards=[];
  const list=Array.isArray(r.cards)?r.cards.slice(0,500):[];
  for(const c of list){const s=cardSanitize(c,cards.length+1);if(s)cards.push(s);}
  const seen=new Set();
  for(const c of cards){while(seen.has(c.id))c.id++;seen.add(c.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const c of cards)nextId=Math.max(nextId,c.id+1);
  return {nextId,cards};
}

export function addCard(deck,front,back,now){
  const d=deckSanitize(deck);
  const f=String(front||'').trim().slice(0,500), b=String(back||'').trim().slice(0,1000);
  if(!f||!b)return {deck:d,ok:false};
  const card={id:d.nextId,front:f,back:b,ease:2.5,interval:0,reps:0,due:now||0,lapses:0};
  return {deck:{nextId:d.nextId+1,cards:[...d.cards,card]},ok:true,card};
}

export function removeCard(deck,id){
  const d=deckSanitize(deck);
  return {nextId:d.nextId,cards:d.cards.filter(c=>c.id!==id)};
}

/* 评分后返回新卡（不改输入）。now 为毫秒时间戳。 */
export function reviewCard(card,rating,now){
  const c=cardSanitize(card,card&&card.id)||null;
  if(!c)return null;
  const r=clamp(Math.round(num(rating,2)),0,3);
  let {ease,interval,reps,lapses}=c;
  if(r===0){
    reps=0;interval=0;lapses+=1;ease=clamp(ease-0.2,MIN_EASE,MAX_EASE);
    return {...c,ease,interval,reps,lapses,due:now+10*60000};
  }
  reps+=1;
  if(reps===1)interval=1;
  else if(reps===2)interval=3;
  else interval=Math.max(1,Math.round(interval*ease));
  if(r===1)ease=clamp(ease-0.15,MIN_EASE,MAX_EASE);
  if(r===3)ease=clamp(ease+0.15,MIN_EASE,MAX_EASE);
  interval=clamp(interval,1,3650);
  return {...c,ease,interval,reps,due:now+interval*DAY};
}

/* 到期队列：due<=now，按 due 升序、再按 id。 */
export function dueCards(deck,now){
  const d=deckSanitize(deck);
  return d.cards.filter(c=>c.due<=now).sort((a,b)=>a.due-b.due||a.id-b.id);
}

export function deckStats(deck,now){
  const d=deckSanitize(deck);
  const due=d.cards.filter(c=>c.due<=now).length;
  const learned=d.cards.filter(c=>c.reps>0).length;
  const mature=d.cards.filter(c=>c.interval>=21).length;
  return {total:d.cards.length,due,learned,mature};
}