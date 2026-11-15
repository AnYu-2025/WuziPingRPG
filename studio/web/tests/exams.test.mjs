import test from 'node:test';
import assert from 'node:assert/strict';
import {daysUntil,todayStr,examsSanitize,addExam,removeExam,updateExam,addMilestone,toggleMilestone,removeMilestone,sortExams,examProgress,countdownText} from '../src/exams.js';

const NOW=new Date(2026,10,14,12,0,0); // 2026-11-14 本地

test('daysUntil counts calendar days',()=>{
  assert.equal(daysUntil('2026-11-14',NOW),0);
  assert.equal(daysUntil('2026-11-15',NOW),1);
  assert.equal(daysUntil('2026-12-14',NOW),30);
  assert.equal(daysUntil('2026-11-13',NOW),-1);
  assert.ok(Number.isNaN(daysUntil('bad',NOW)));
});

test('todayStr pads',()=>{
  assert.equal(todayStr(NOW),'2026-11-14');
  assert.equal(todayStr(new Date(2026,0,5)),'2026-01-05');
});

test('examsSanitize drops invalid and dedupes ids',()=>{
  const s=examsSanitize({nextId:1,exams:[{name:'a',date:'2026-12-01'},{name:'b',date:'bad'},{name:'c',date:'2026-12-02'}]});
  assert.equal(s.exams.length,2);
  const ids=s.exams.map(e=>e.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(s.nextId>Math.max(...ids));
});

test('addExam rejects blank/bad date/dup',()=>{
  let s=examsSanitize(null);
  const r=addExam(s,'执业医考','2026-12-20');
  assert.equal(r.ok,true);
  assert.equal(addExam(r.store,'','2026-12-20').ok,false);
  assert.equal(addExam(r.store,'x','bad').ok,false);
  assert.equal(addExam(r.store,'执业医考','2026-12-20').dup,true);
});

test('removeExam removes',()=>{
  let s=addExam(examsSanitize(null),'a','2026-12-01').store;
  s=removeExam(s,1);
  assert.equal(s.exams.length,0);
});

test('milestones add/toggle/remove',()=>{
  let s=addExam(examsSanitize(null),'a','2026-12-01').store;
  s=addMilestone(s,1,'一轮复习').store;
  s=addMilestone(s,1,'二轮刷题').store;
  assert.equal(s.exams[0].milestones.length,2);
  s=toggleMilestone(s,1,1);
  assert.equal(s.exams[0].milestones[0].done,true);
  const p=examProgress(s.exams[0]);
  assert.equal(p.done,1);assert.equal(p.pct,50);
  s=removeMilestone(s,1,1);
  assert.equal(s.exams[0].milestones.length,1);
});

test('sortExams upcoming first then past',()=>{
  let s=examsSanitize(null);
  s=addExam(s,'past','2026-11-01').store;
  s=addExam(s,'far','2026-12-30').store;
  s=addExam(s,'near','2026-11-20').store;
  const sorted=sortExams(s,NOW).map(e=>e.name);
  assert.deepEqual(sorted,['near','far','past']);
});

test('countdownText',()=>{
  const e={date:'2026-11-20'};
  assert.equal(countdownText(e,NOW),'还有 6 天');
  assert.equal(countdownText({date:'2026-11-14'},NOW),'就是今天');
  assert.equal(countdownText({date:'2026-11-10'},NOW),'已过 4 天');
});

test('updateExam renames/reschedules keeping milestones and id',()=>{
  let s=examsSanitize(null);
  const added=addExam(s,'旧名','2026-11-20');
  s=added.store;
  const id=added.exam.id;
  s=addMilestone(s,id,'一轮').store;
  const r=updateExam(s,id,'新名','2026-12-01');
  assert.ok(r.ok);
  const e=r.store.exams.find(x=>x.id===id);
  assert.equal(e.name,'新名');
  assert.equal(e.date,'2026-12-01');
  assert.equal(e.milestones.length,1); // 里程碑保留
  assert.equal(e.id,id);
});

test('updateExam rejects invalid and duplicate',()=>{
  let s=examsSanitize(null);
  const a=addExam(s,'A','2026-11-20').store;
  const b=addExam(a,'B','2026-11-25').store;
  const idA=b.exams[0].id,idB=b.exams[1].id;
  assert.equal(updateExam(b,idA,'','2026-11-20').ok,false); // 空名
  assert.equal(updateExam(b,idA,'X','bad').ok,false); // 坏日期
  assert.equal(updateExam(b,idA,'B','2026-11-25').dup,true); // 撞B
  assert.equal(updateExam(b,idA,'A','2026-11-20').ok,true); // 自身同名同日期允许
  assert.equal(updateExam(b,999,'C','2026-11-20').ok,false); // 不存在
});