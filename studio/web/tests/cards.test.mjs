import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY,cardSanitize,deckSanitize,addCard,removeCard,reviewCard,dueCards,deckStats,MIN_EASE,MAX_EASE} from '../src/cards.js';

const NOW=1_700_000_000_000;

test('cardSanitize rejects empty front/back and clamps',()=>{
  assert.equal(cardSanitize({front:'',back:'x'},1),null);
  assert.equal(cardSanitize({front:'x',back:' '},1),null);
  const c=cardSanitize({front:'q',back:'a',ease:9,interval:-5,reps:-1},7);
  assert.equal(c.id,7);
  assert.equal(c.ease,MAX_EASE);
  assert.equal(c.interval,0);
  assert.equal(c.reps,0);
});

test('deckSanitize dedupes ids and advances nextId',()=>{
  const d=deckSanitize({nextId:1,cards:[{id:1,front:'a',back:'b'},{id:1,front:'c',back:'d'}]});
  const ids=d.cards.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(d.nextId>Math.max(...ids));
});

test('addCard trims and rejects blank',()=>{
  let d=deckSanitize(null);
  const r=addCard(d,'  q  ','  a  ',NOW);
  assert.equal(r.ok,true);
  assert.equal(r.card.front,'q');
  assert.equal(r.card.due,NOW);
  assert.equal(addCard(r.deck,'','x',NOW).ok,false);
});

test('removeCard removes by id',()=>{
  let d=addCard(deckSanitize(null),'q','a',NOW).deck;
  d=removeCard(d,1);
  assert.equal(d.cards.length,0);
});

test('review good schedules 1d then 3d then interval*ease',()=>{
  let c=cardSanitize({front:'q',back:'a'},1);
  c=reviewCard(c,2,NOW);
  assert.equal(c.interval,1);assert.equal(c.reps,1);assert.equal(c.due,NOW+DAY);
  c=reviewCard(c,2,NOW);
  assert.equal(c.interval,3);assert.equal(c.reps,2);
  c=reviewCard(c,2,NOW);
  assert.ok(c.interval>=3);assert.equal(c.reps,3);
});

test('review again resets and schedules 10min, lowers ease, counts lapse',()=>{
  let c=cardSanitize({front:'q',back:'a',ease:2.5,interval:10,reps:5},1);
  c=reviewCard(c,0,NOW);
  assert.equal(c.reps,0);assert.equal(c.interval,0);
  assert.equal(c.lapses,1);
  assert.ok(Math.abs(c.ease-2.3)<1e-9);
  assert.equal(c.due,NOW+10*60000);
});

test('easy raises ease, hard lowers, both clamped',()=>{
  let c=cardSanitize({front:'q',back:'a',ease:2.7},1);
  c=reviewCard(c,3,NOW);
  assert.equal(c.ease,MAX_EASE);
  let h=cardSanitize({front:'q',back:'a',ease:1.35},1);
  h=reviewCard(h,1,NOW);
  assert.equal(h.ease,MIN_EASE);
});

test('dueCards returns only due sorted by due',()=>{
  let d=deckSanitize(null);
  d=addCard(d,'a','1',NOW-100).deck;   // due earlier
  d=addCard(d,'b','2',NOW+DAY).deck;   // not due
  d=addCard(d,'c','3',NOW-50).deck;
  const due=dueCards(d,NOW);
  assert.equal(due.length,2);
  assert.equal(due[0].front,'a');
  assert.equal(due[1].front,'c');
});

test('deckStats counts total/due/learned/mature',()=>{
  let d=deckSanitize(null);
  d=addCard(d,'a','1',NOW).deck;
  d=addCard(d,'b','2',NOW+DAY).deck;
  d={...d,cards:d.cards.map((c,i)=>i===0?{...c,reps:3,interval:30}:c)};
  const s=deckStats(d,NOW);
  assert.equal(s.total,2);
  assert.equal(s.due,1);
  assert.equal(s.learned,1);
  assert.equal(s.mature,1);
});

test('review does not mutate input',()=>{
  const c=cardSanitize({front:'q',back:'a'},1);
  const before=JSON.stringify(c);
  reviewCard(c,2,NOW);
  assert.equal(JSON.stringify(c),before);
});