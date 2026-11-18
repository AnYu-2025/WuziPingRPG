import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBJECTS,CAUSES,mistakeSanitize,bookSanitize,addMistake,updateMistake,setMastery,removeMistake,filterMistakes,bookStats,causeStats} from '../src/mistakes.js';
import {recordQuizMistake,unfiledQuizMistakes,makeMistakeCard} from '../src/mistakes.js';
import {deckSanitize,dueCards,removeCard} from '../src/cards.js';

const NOW=1_700_000_000_000;

const question={id:'b:demo',q:'选择正确的选项',subject:'解剖',options:['甲','乙'],answer:1,explain:'选乙的依据'};

test('复习错题保留题干、选项、解析、原科目与学习者的批注',()=>{
  let book=recordQuizMistake(bookSanitize(null),question,NOW).book;
  const item=book.items[0];
  assert.equal(item.subject,'解剖');
  assert.equal(item.answer,'乙\n选乙的依据');
  assert.equal(item.question,'选择正确的选项\nA. 甲\nB. 乙');
  book=updateMistake(book,item.id,{reason:'读错了',cause:'审题失误',mastery:2},NOW+1).book;
  book=recordQuizMistake(bookSanitize(book),question,NOW+2).book;
  assert.equal(book.items.length,1);
  assert.equal(book.items[0].reason,'读错了');
  assert.equal(book.items[0].cause,'审题失误');
  assert.equal(book.items[0].mastery,0);
  assert.equal(book.items[0].created,NOW);
  assert.deepEqual(unfiledQuizMistakes(book,{[question.id]:1,unavailable:3},[question]),[]);
  assert.deepEqual(unfiledQuizMistakes(bookSanitize(null),{[question.id]:2,unavailable:3},[question]),[question]);
});

test('从错题制卡会进入到期队列，能恢复关联，删卡后可以重新制卡',()=>{
  const book=addMistake(bookSanitize(null),{title:'纸上录入',answer:'答案'},NOW).book;
  const result=makeMistakeCard(book,deckSanitize(null),book.items[0].id,NOW);
  assert.ok(result.ok);
  assert.equal(dueCards(result.deck,NOW)[0].front,'纸上录入');
  const restored=bookSanitize(result.book);
  assert.equal(makeMistakeCard(restored,deckSanitize(result.deck),1,NOW).ok,false);
  const empty=removeCard(result.deck,restored.items[0].reviewCardId);
  const next=makeMistakeCard(restored,empty,1,NOW+1);
  assert.equal(next.book.items[0].reviewCardId,next.deck.cards[0].id);
  assert.equal(next.deck.cards.length,1);
});

test('mistakeSanitize requires title or question, defaults subject',()=>{
  assert.equal(mistakeSanitize({},1),null);
  assert.equal(mistakeSanitize({title:'  '},1),null);
  const m=mistakeSanitize({question:'1+1=?'},5);
  assert.equal(m.id,5);
  assert.equal(m.subject,'其他');
  assert.equal(m.title,'1+1=?');
  assert.equal(m.mastery,0);
});

test('mistakeSanitize clamps mastery and subject whitelist',()=>{
  const m=mistakeSanitize({title:'x',mastery:9,subject:'黑客'},1);
  assert.equal(m.mastery,2);
  assert.equal(m.subject,'其他');
  assert.ok(SUBJECTS.includes('数学'));
});

test('bookSanitize dedupes ids and advances nextId',()=>{
  const b=bookSanitize({nextId:1,items:[{id:1,title:'a'},{id:1,title:'b'}]});
  const ids=b.items.map(i=>i.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(b.nextId>Math.max(...ids));
});

test('addMistake assigns id and timestamps',()=>{
  const r=addMistake(bookSanitize(null),{title:'错题1',subject:'数学',question:'q',answer:'a'},NOW);
  assert.equal(r.ok,true);
  assert.equal(r.item.id,1);
  assert.equal(r.item.created,NOW);
  assert.equal(addMistake(r.book,{title:''},NOW).ok,false);
});

test('updateMistake merges and keeps created',()=>{
  let b=addMistake(bookSanitize(null),{title:'t',question:'q'},NOW).book;
  const r=updateMistake(b,1,{answer:'new',mastery:2},NOW+5);
  assert.equal(r.ok,true);
  const it=r.book.items[0];
  assert.equal(it.answer,'new');
  assert.equal(it.mastery,2);
  assert.equal(it.created,NOW);
  assert.equal(it.updated,NOW+5);
});

test('setMastery updates only mastery',()=>{
  let b=addMistake(bookSanitize(null),{title:'t'},NOW).book;
  const r=setMastery(b,1,1,NOW+1);
  assert.equal(r.book.items[0].mastery,1);
});

test('removeMistake removes by id',()=>{
  let b=addMistake(bookSanitize(null),{title:'t'},NOW).book;
  b=removeMistake(b,1);
  assert.equal(b.items.length,0);
});

test('filterMistakes by subject and mastery, sorted by updated desc',()=>{
  let b=bookSanitize(null);
  b=addMistake(b,{title:'a',subject:'数学',mastery:0},NOW).book;
  b=addMistake(b,{title:'b',subject:'英语',mastery:2},NOW+10).book;
  b=addMistake(b,{title:'c',subject:'数学',mastery:2},NOW+20).book;
  assert.equal(filterMistakes(b,'全部',-1).length,3);
  assert.equal(filterMistakes(b,'数学',-1).length,2);
  assert.equal(filterMistakes(b,'全部',2).length,2);
  assert.equal(filterMistakes(b,'数学',2)[0].title,'c');
  assert.equal(filterMistakes(b,'全部',-1)[0].title,'c');
});

test('bookStats counts mastery, subject and rate',()=>{
  let b=bookSanitize(null);
  b=addMistake(b,{title:'a',subject:'数学',mastery:2},NOW).book;
  b=addMistake(b,{title:'b',subject:'数学',mastery:0},NOW).book;
  b=addMistake(b,{title:'c',subject:'英语',mastery:1},NOW).book;
  const s=bookStats(b);
  assert.equal(s.total,3);
  assert.deepEqual(s.byMastery,[1,1,1]);
  assert.equal(s.bySubject['数学'],2);
  assert.equal(s.mastered,1);
  assert.equal(s.rate,33);
});

test('empty book stats are zero',()=>{
  const s=bookStats(bookSanitize(null));
  assert.equal(s.total,0);
  assert.equal(s.rate,0);
});

test('update does not mutate input',()=>{
  const b=addMistake(bookSanitize(null),{title:'t'},NOW).book;
  const before=JSON.stringify(b);
  updateMistake(b,1,{mastery:2},NOW+1);
  assert.equal(JSON.stringify(b),before);
});

test('cause sanitize keeps valid cause and drops invalid',()=>{
  const ok=mistakeSanitize({title:'t',cause:'审题失误'},1);
  assert.equal(ok.cause,'审题失误');
  const bad=mistakeSanitize({title:'t',cause:'瞎写'},1);
  assert.equal(bad.cause,'');
});

test('causeStats counts tagged and gives top advice',()=>{
  let b=bookSanitize(null);
  b=addMistake(b,{title:'a',cause:'粗心计算'},NOW).book;
  b=addMistake(b,{title:'b',cause:'粗心计算'},NOW).book;
  b=addMistake(b,{title:'c',cause:'概念不清'},NOW).book;
  b=addMistake(b,{title:'d'},NOW).book;
  const s=causeStats(b);
  assert.equal(s.tagged,3);
  assert.equal(s.total,4);
  assert.equal(s.top,'粗心计算');
  assert.ok(s.advice.includes('检查'));
});

test('causeStats empty when none tagged',()=>{
  const b=addMistake(bookSanitize(null),{title:'a'},NOW).book;
  const s=causeStats(b);
  assert.equal(s.tagged,0);
  assert.equal(s.top,'');
  assert.equal(s.advice,'');
});
