import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FOCUS,focusSanitize,focusToggle,focusReset,focusSkip,focusTick,focusSetMinutes,phaseSeconds,fmtTime,bumpHistory,lastNDays} from '../src/focus.js';

test('sanitize defaults and clamps',()=>{
  const s=focusSanitize(null);
  assert.equal(s.phase,'work');
  assert.equal(s.remaining,25*60);
  assert.equal(s.running,false);
  const bad=focusSanitize({phase:'nope',workMin:999,remaining:-5});
  assert.equal(bad.phase,'work');
  assert.equal(bad.workMin,90);
  assert.equal(bad.remaining,0);
});

test('toggle and reset',()=>{
  let s=DEFAULT_FOCUS();
  s=focusToggle(s);assert.equal(s.running,true);
  s=focusTick(s,'2026-01-01').state;assert.equal(s.remaining,25*60-1);
  s=focusReset(s);assert.equal(s.running,false);assert.equal(s.remaining,25*60);
});

test('tick to zero completes work and moves to short break',()=>{
  let s={...DEFAULT_FOCUS(),remaining:1,running:true};
  const r=focusTick(s,'2026-01-01');
  assert.equal(r.finished,true);
  assert.equal(r.state.phase,'short');
  assert.equal(r.state.completed,1);
  assert.equal(r.state.today.count,1);
  assert.equal(r.state.running,false);
});

test('four work segments lead to long break',()=>{
  let s=DEFAULT_FOCUS();
  for(let i=0;i<4;i++){
    s={...s,phase:'work',remaining:1,running:true};
    s=focusTick(s,'2026-01-01').state;
    if(i<3){assert.equal(s.phase,'short');s={...s,phase:'work'};}
  }
  assert.equal(s.phase,'long');
  assert.equal(s.completed,4);
});

test('break tick returns to work without counting',()=>{
  let s={...DEFAULT_FOCUS(),phase:'short',remaining:1,running:true,completed:2};
  const r=focusTick(s,'2026-01-01');
  assert.equal(r.state.phase,'work');
  assert.equal(r.state.completed,2);
});

test('skip does not count work',()=>{
  const s=focusSkip({...DEFAULT_FOCUS(),completed:3});
  assert.equal(s.phase,'short');
  assert.equal(s.completed,3);
});

test('setMinutes clamps and resets remaining',()=>{
  const s=focusSetMinutes(DEFAULT_FOCUS(),'workMin',200);
  assert.equal(s.workMin,90);
  assert.equal(s.remaining,90*60);
});

test('today count resets on new date',()=>{
  let s={...DEFAULT_FOCUS(),remaining:1,running:true,today:{date:'2026-01-01',count:5}};
  const r=focusTick(s,'2026-01-02');
  assert.equal(r.state.today.date,'2026-01-02');
  assert.equal(r.state.today.count,1);
});

test('fmtTime pads',()=>{
  assert.equal(fmtTime(0),'00:00');
  assert.equal(fmtTime(65),'01:05');
  assert.equal(fmtTime(25*60),'25:00');
});

test('phaseSeconds respects settings',()=>{
  const s=focusSetMinutes(DEFAULT_FOCUS(),'shortMin',10);
  assert.equal(phaseSeconds(s,'short'),600);
});

test('bumpHistory increments and caps at 30 days',()=>{
  let h={};
  h=bumpHistory(h,'2026-01-01');
  h=bumpHistory(h,'2026-01-01');
  assert.equal(h['2026-01-01'],2);
  for(let i=1;i<=40;i++){const d=new Date(2026,0,i);const p=x=>String(x).padStart(2,'0');h=bumpHistory(h,'2026-'+p(d.getMonth()+1)+'-'+p(d.getDate()));}
  assert.ok(Object.keys(h).length<=30);
  assert.deepEqual(bumpHistory(h,'bad-date'),h);
});

test('lastNDays returns n entries ending today with counts',()=>{
  const h={'2026-01-05':3};
  const seq=lastNDays(h,7,'2026-01-05');
  assert.equal(seq.length,7);
  assert.equal(seq[6].date,'2026-01-05');
  assert.equal(seq[6].count,3);
  assert.equal(seq[0].count,0);
});

test('completing work bumps history for the date',()=>{
  let s={...DEFAULT_FOCUS(),remaining:1,running:true};
  const r=focusTick(s,'2026-01-05');
  assert.equal(r.state.history['2026-01-05'],1);
});

test('sanitize keeps valid history keys only',()=>{
  const s=focusSanitize({history:{'2026-01-05':2,'bogus':9,'2026-01-06':-4}});
  assert.equal(s.history['2026-01-05'],2);
  assert.equal(s.history['2026-01-06'],0);
  assert.equal(s.history.bogus,undefined);
});