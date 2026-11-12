import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBJECTS,mistakeSanitize,bookSanitize,addMistake,updateMistake,setMastery,removeMistake,filterMistakes,bookStats} from '../src/mistakes.js';

const NOW=1_700_000_000_000;

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