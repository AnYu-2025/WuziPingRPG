import test from 'node:test';
import assert from 'node:assert/strict';
import {studyLogSanitize,logStudy,dayCounts,dayActive} from '../src/study-log.js';

const D='2026-11-16';

test('studyLogSanitize drops invalid days and clamps',()=>{
  const s=studyLogSanitize({days:{[D]:{focus:2,cards:-5,quiz:1.6},'bad':{focus:1},[D+'x']:{focus:1}}});
  assert.deepEqual(s.days[D],{focus:2,cards:0,quiz:2});
  assert.equal(Object.keys(s.days).length,1);
});

test('studyLogSanitize keeps only recent 90 days',()=>{
  const days={};
  for(let i=0;i<120;i++){const d=new Date(2026,0,1+i);const k=d.toISOString().slice(0,10);days[k]={focus:1,cards:0,quiz:0};}
  const s=studyLogSanitize({days});
  assert.equal(Object.keys(s.days).length,90);
});

test('logStudy increments metric without mutating input',()=>{
  const a=studyLogSanitize(null);
  const b=logStudy(a,D,'quiz',3);
  assert.equal(b.days[D].quiz,3);
  assert.equal(a.days[D],undefined); // 不改输入
  const c=logStudy(b,D,'quiz');
  assert.equal(c.days[D].quiz,4);
  const d=logStudy(c,D,'focus',2);
  assert.equal(d.days[D].focus,2);
  assert.equal(d.days[D].quiz,4);
});

test('logStudy rejects invalid date/metric',()=>{
  const a=studyLogSanitize(null);
  assert.deepEqual(logStudy(a,'bad','quiz'),a);
  assert.deepEqual(logStudy(a,D,'nope'),a);
});

test('dayCounts merges checks and totals',()=>{
  const s=logStudy(logStudy(logStudy(null,D,'focus',2),D,'cards',5),D,'quiz',10);
  const c=dayCounts(s,D,3);
  assert.equal(c.focus,2);
  assert.equal(c.cards,5);
  assert.equal(c.quiz,10);
  assert.equal(c.checks,3);
  assert.equal(c.total,20);
  const empty=dayCounts(s,'2026-11-17',0);
  assert.equal(empty.total,0);
});

test('dayActive reflects any metric or checks',()=>{
  const s=logStudy(null,D,'quiz',1);
  assert.equal(dayActive(s,D,0),true);
  assert.equal(dayActive(s,'2026-11-17',0),false);
  assert.equal(dayActive(s,'2026-11-17',2),true); // 仅打卡也算活跃
});