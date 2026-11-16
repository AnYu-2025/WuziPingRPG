import test from 'node:test';
import assert from 'node:assert/strict';
import {studyLogSanitize,logStudy,dayCounts,dayActive,lastNDaysStudy,weekReport} from '../src/study-log.js';

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

test('lastNDaysStudy returns n days ending today with checks',()=>{
  let s=logStudy(null,'2026-11-16','quiz',5);
  s=logStudy(s,'2026-11-14','focus',2);
  const days=lastNDaysStudy(s,7,'2026-11-16',{'2026-11-16':3});
  assert.equal(days.length,7);
  assert.equal(days[6].date,'2026-11-16');
  assert.equal(days[6].quiz,5);
  assert.equal(days[6].checks,3);
  assert.equal(days[6].total,8);
  assert.equal(days[4].date,'2026-11-14');
  assert.equal(days[4].focus,2);
  assert.equal(days[0].date,'2026-11-10');
  assert.equal(days[0].total,0);
});

test('weekReport compares current vs previous week',()=>{
  let s=null;
  // 本周（11-10..11-16）：quiz 共 10
  s=logStudy(s,'2026-11-16','quiz',6);
  s=logStudy(s,'2026-11-12','quiz',4);
  // 上周（11-03..11-09）：quiz 共 5
  s=logStudy(s,'2026-11-08','quiz',5);
  const r=weekReport(s,'2026-11-16',{'2026-11-16':2,'2026-11-09':1});
  assert.equal(r.cur.quiz,10);
  assert.equal(r.cur.checks,2);
  assert.equal(r.cur.total,12);
  assert.equal(r.prev.quiz,5);
  assert.equal(r.prev.checks,1);
  assert.equal(r.prev.total,6);
  assert.equal(r.delta.total,6);
  assert.equal(r.pct,100); // (12-6)/6
  assert.equal(r.activeDays,2);
});

test('weekReport pct null when previous week empty',()=>{
  const s=logStudy(null,'2026-11-16','quiz',3);
  const r=weekReport(s,'2026-11-16',{});
  assert.equal(r.prev.total,0);
  assert.equal(r.pct,null);
  assert.equal(r.cur.total,3);
});