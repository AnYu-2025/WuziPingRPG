import test from 'node:test';
import assert from 'node:assert/strict';
import {PERIODS,courseSanitize,scheduleSanitize,conflicts,addCourse,updateCourse,removeCourse,weekActive,coursesOnDay,nowInfo,currentStatus,fmtMin,weeksText} from '../src/schedule.js';

const mk=(o)=>courseSanitize(Object.assign({name:'高数',day:1,start:1,len:2},o),1);

test('courseSanitize clamps and requires name',()=>{
  assert.equal(courseSanitize({},1),null);
  const c=mk({start:12,len:5,day:9,color:99});
  assert.equal(c.len,1);assert.equal(c.day,7);assert.equal(c.color<=7,true);
});

test('scheduleSanitize dedupes ids',()=>{
  const s=scheduleSanitize({nextId:1,courses:[{name:'a',day:1,start:1},{name:'b',day:1,start:1}]});
  // second conflicts not filtered here (sanitize keeps), ids unique
  const ids=s.courses.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length);
});

test('conflicts detects same-day overlap and week intersection',()=>{
  const a=mk({day:1,start:1,len:2});
  const b=mk({day:1,start:2,len:2});
  assert.equal(conflicts(a,b),true);
  const c=mk({day:1,start:3,len:2});
  assert.equal(conflicts(a,c),false);
  const d=mk({day:2,start:1,len:2});
  assert.equal(conflicts(a,d),false);
  const w1=mk({day:1,start:1,len:2,weeks:[1,3,5]});
  const w2=mk({day:1,start:1,len:2,weeks:[2,4,6]});
  assert.equal(conflicts(w1,w2),false);
  const w3=mk({day:1,start:1,len:2,weeks:[3]});
  assert.equal(conflicts(w1,w3),true);
});

test('addCourse rejects conflict and blank',()=>{
  let s=scheduleSanitize(null);
  const r=addCourse(s,{name:'高数',day:1,start:1,len:2});
  assert.equal(r.ok,true);
  assert.equal(addCourse(r.sched,{name:'线代',day:1,start:2,len:2}).conflict,true);
  assert.equal(addCourse(r.sched,{name:'',day:3,start:1}).ok,false);
});

test('updateCourse and removeCourse',()=>{
  let s=addCourse(scheduleSanitize(null),{name:'高数',day:1,start:1,len:2}).sched;
  const u=updateCourse(s,1,{name:'高等数学',place:'A101'});
  assert.equal(u.ok,true);
  assert.equal(u.sched.courses[0].name,'高等数学');
  s=removeCourse(u.sched,1);
  assert.equal(s.courses.length,0);
});

test('weekActive and coursesOnDay filter+sort',()=>{
  let s=scheduleSanitize(null);
  s=addCourse(s,{name:'a',day:1,start:3,weeks:[2]}).sched;
  s=addCourse(s,{name:'b',day:1,start:1}).sched;
  assert.equal(coursesOnDay(s,1,1).length,1);
  assert.equal(coursesOnDay(s,1,2).length,2);
  assert.equal(coursesOnDay(s,1,2)[0].name,'b');
  assert.equal(weekActive(mk({weeks:[2]}),2),true);
  assert.equal(weekActive(mk({weeks:[2]}),3),false);
});

test('nowInfo computes day/minutes/week',()=>{
  const d=new Date(2026,8,7,9,30); // 2026-09-07 Monday
  const i=nowInfo(d,'2026-09-01');
  assert.equal(i.day,1);
  assert.equal(i.minutes,570);
  assert.equal(i.week>=1,true);
});

test('currentStatus finds now and next',()=>{
  let s=scheduleSanitize(null);
  s=addCourse(s,{name:'高数',day:1,start:3,len:2}).sched; // 10:00-11:40
  s=addCourse(s,{name:'英语',day:1,start:5,len:2}).sched; // 14:00
  const now=currentStatus(s,{day:1,minutes:610,week:1});
  assert.equal(now.now.name,'高数');
  assert.equal(now.next.course.name,'英语');
  const before=currentStatus(s,{day:1,minutes:400,week:1});
  assert.equal(before.now,null);
  assert.equal(before.next.course.name,'高数');
  assert.equal(before.next.deltaMin,200);
});

test('currentStatus wraps to next day when none left',()=>{
  let s=addCourse(scheduleSanitize(null),{name:'体育',day:2,start:1,len:2}).sched;
  const st=currentStatus(s,{day:1,minutes:1300,week:1});
  assert.equal(st.now,null);
  assert.equal(st.next.course.name,'体育');
  assert.equal(st.next.day,2);
  assert.equal(st.next.deltaMin,null);
});

test('fmtMin and weeksText',()=>{
  assert.equal(fmtMin(480),'08:00');
  assert.equal(weeksText(mk({})),'每周');
  assert.equal(weeksText(mk({weeks:[1,3,5]})),'1,3,5周');
});