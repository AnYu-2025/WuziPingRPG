import test from 'node:test';
import assert from 'node:assert/strict';
import {dayIndex,indexToDay,habitSanitize,habitsSanitize,addHabit,removeHabit,isChecked,toggleCheck,currentStreak,bestStreak,totalChecks,lastNDaysChecks,habitsStats} from '../src/habits.js';

const NOW=1_700_000_000_000;
const mk=(name,checks)=>({id:1,name,created:NOW,checks:checks||{}});

test('dayIndex/indexToDay round-trip and reject bad input',()=>{
  assert.equal(indexToDay(dayIndex('2026-01-05')),'2026-01-05');
  assert.equal(indexToDay(dayIndex('2026-12-31')),'2026-12-31');
  assert.ok(Number.isNaN(dayIndex('bad')));
  assert.ok(Number.isNaN(dayIndex('2026-1-5')));
  assert.equal(dayIndex('2026-01-06')-dayIndex('2026-01-05'),1);
});

test('habitSanitize requires name, keeps valid date keys',()=>{
  assert.equal(habitSanitize({name:'  '},1),null);
  const h=habitSanitize({name:'跑步',checks:{'2026-01-05':1,'bogus':1,'2026-1-5':1}},3);
  assert.equal(h.id,3);
  assert.deepEqual(Object.keys(h.checks),['2026-01-05']);
});

test('habitsSanitize dedupes ids and advances nextId',()=>{
  const b=habitsSanitize({nextId:1,habits:[{id:1,name:'a'},{id:1,name:'b'}]});
  const ids=b.habits.map(h=>h.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(b.nextId>Math.max(...ids));
});

test('addHabit rejects blank and duplicate',()=>{
  let b=habitsSanitize(null);
  const r=addHabit(b,'跑步',NOW);
  assert.equal(r.ok,true);
  assert.equal(addHabit(r.book,'',NOW).ok,false);
  assert.equal(addHabit(r.book,'跑步',NOW).dup,true);
});

test('removeHabit removes by id',()=>{
  let b=addHabit(habitsSanitize(null),'跑步',NOW).book;
  b=removeHabit(b,1);
  assert.equal(b.habits.length,0);
});

test('toggleCheck adds then removes, does not mutate input',()=>{
  let b=addHabit(habitsSanitize(null),'跑步',NOW).book;
  const before=JSON.stringify(b);
  const b2=toggleCheck(b,1,'2026-01-05');
  assert.equal(isChecked(b2.habits[0],'2026-01-05'),true);
  const b3=toggleCheck(b2,1,'2026-01-05');
  assert.equal(isChecked(b3.habits[0],'2026-01-05'),false);
  assert.equal(JSON.stringify(b),before);
  assert.deepEqual(toggleCheck(b,1,'bad'),habitsSanitize(b));
});

test('currentStreak counts back from today when checked',()=>{
  const h=mk('x',{'2026-01-03':1,'2026-01-04':1,'2026-01-05':1});
  assert.equal(currentStreak(h,'2026-01-05'),3);
});

test('currentStreak allows today not yet checked (counts from yesterday)',()=>{
  const h=mk('x',{'2026-01-03':1,'2026-01-04':1});
  assert.equal(currentStreak(h,'2026-01-05'),2);
});

test('currentStreak breaks on gap and is zero when none',()=>{
  const h=mk('x',{'2026-01-01':1,'2026-01-03':1,'2026-01-04':1,'2026-01-05':1});
  assert.equal(currentStreak(h,'2026-01-05'),3);
  assert.equal(currentStreak(mk('x',{}),'2026-01-05'),0);
  assert.equal(currentStreak(mk('x',{'2026-01-01':1}),'2026-01-05'),0);
});

test('bestStreak finds longest run regardless of today',()=>{
  const h=mk('x',{'2026-01-01':1,'2026-01-02':1,'2026-01-03':1,'2026-01-10':1,'2026-01-11':1});
  assert.equal(bestStreak(h),3);
  assert.equal(bestStreak(mk('x',{})),0);
  assert.equal(totalChecks(h),5);
});

test('lastNDaysChecks returns n entries ending today',()=>{
  const h=mk('x',{'2026-01-05':1});
  const seq=lastNDaysChecks(h,7,'2026-01-05');
  assert.equal(seq.length,7);
  assert.equal(seq[6].date,'2026-01-05');
  assert.equal(seq[6].done,true);
  assert.equal(seq[0].done,false);
});

test('habitsStats counts done today and total checks',()=>{
  let b=habitsSanitize(null);
  b=addHabit(b,'跑步',NOW).book;
  b=addHabit(b,'阅读',NOW).book;
  b=toggleCheck(b,1,'2026-01-05');
  b=toggleCheck(b,1,'2026-01-04');
  const s=habitsStats(b,'2026-01-05');
  assert.equal(s.total,2);
  assert.equal(s.doneToday,1);
  assert.equal(s.totalChecks,2);
});