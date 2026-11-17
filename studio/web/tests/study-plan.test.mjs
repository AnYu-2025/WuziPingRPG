import test from 'node:test';
import assert from 'node:assert/strict';
import {planSanitize,buildPlan,buildRecap} from '../src/study-plan.js';

test('planSanitize clamps and drops invalid',()=>{
  const d=planSanitize({cardsDue:-5,habitsLeft:2.6,exams:[{name:'期末',days:3},{name:'坏',days:'x'}],subjects:[{subject:'生化',answered:10,rate:55},{subject:'空',answered:0,rate:10}]});
  assert.equal(d.cardsDue,0);
  assert.equal(d.habitsLeft,3);
  assert.equal(d.exams.length,1);
  assert.equal(d.subjects.length,1);
});

test('buildPlan prioritizes near deadline then due cards then weak subject',()=>{
  const p=buildPlan({cardsDue:5,habitsLeft:1,mistakesOpen:2,focusToday:0,exams:[{name:'执业医考',days:2}],subjects:[{subject:'生化',answered:20,rate:45}]});
  assert.equal(p.length,3);
  assert.equal(p[0].id,'exam');
  assert.equal(p[1].id,'cards');
  assert.equal(p[2].id,'weak');
  assert.equal(p[2].params.subject,'生化');
  assert.ok(p[0].reason.includes('2'));
});

test('buildPlan weak subject needs >=5 answered and <60%',()=>{
  const few=buildPlan({subjects:[{subject:'解剖',answered:3,rate:30}]});
  assert.ok(!few.some(x=>x.id==='weak'));
  const strong=buildPlan({subjects:[{subject:'解剖',answered:30,rate:80}]});
  assert.ok(!strong.some(x=>x.id==='weak'));
});

test('buildPlan empty data gives seed guidance not fake advice',()=>{
  const p=buildPlan({});
  assert.equal(p.length,1);
  assert.equal(p[0].id,'seed');
  assert.equal(p[0].mode,'medquiz');
});

test('buildPlan cards auto review param',()=>{
  const p=buildPlan({cardsDue:3});
  const c=p.find(x=>x.id==='cards');
  assert.equal(c.params.auto,'review');
});

test('buildRecap sums today and picks tone and next',()=>{
  const r=buildRecap({focusToday:2,todayCards:4,todayQuiz:6,todayChecks:1,cardsDue:2},5);
  assert.equal(r.sum,13);
  assert.equal(r.tone,'good');
  assert.equal(r.streak,5);
  assert.ok(r.next);
  const rest=buildRecap({},0);
  assert.equal(rest.tone,'rest');
  assert.equal(rest.sum,0);
});