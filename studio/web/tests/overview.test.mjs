import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,weeklyActivity,todayTasks,subjectMastery,upcomingExams,studyStreak,overviewLine,buildOverview} from '../src/overview.js';

const NOW=new Date(2026,10,14,10,0,0).getTime(); // 2026-11-14 周六
const d=n=>dayKey(new Date(2026,10,14-n));

test('dayKey pads',()=>{
  assert.equal(dayKey(new Date(2026,0,5)),'2026-01-05');
});

test('empty state yields zeros, no fabricated numbers',()=>{
  const s=buildOverview({},NOW);
  assert.equal(s.cards.total,0);
  assert.equal(s.mistakes.total,0);
  assert.equal(s.quiz.answered,0);
  assert.equal(s.streak,0);
  assert.equal(s.weekTotal,0);
  assert.equal(s.week.length,7);
  assert.deepEqual(s.subjects,[]);
  assert.deepEqual(s.exams,[]);
  assert.ok(s.line.includes('暂无待办'));
});

test('weeklyActivity merges focus history and habit checks',()=>{
  const state={
    focus:{history:{[d(0)]:2,[d(2)]:1}},
    habits:{habits:[{id:1,name:'跑步',checks:{[d(0)]:1,[d(1)]:1}}]}
  };
  const w=weeklyActivity(state,NOW);
  assert.equal(w.length,7);
  assert.equal(w[6].date,d(0));
  assert.equal(w[6].focus,2);
  assert.equal(w[6].checks,1);
  assert.equal(w[6].total,3);
  assert.equal(w[5].checks,1);
  assert.equal(w[4].focus,1);
});

test('todayTasks counts due cards, open mistakes, undone habits',()=>{
  const state={
    cards:{cards:[{id:1,front:'a',back:'b',due:NOW-1000},{id:2,front:'c',back:'d',due:NOW+86400000}]},
    mistakes:{items:[{id:1,subject:'数学',title:'x',mastery:0},{id:2,subject:'数学',title:'y',mastery:2}]},
    habits:{habits:[{id:1,name:'跑步',checks:{}},{id:2,name:'阅读',checks:{[d(0)]:1}}]}
  };
  const t=todayTasks(state,NOW);
  assert.equal(t.cardsDue,1);
  assert.equal(t.mistakesOpen,1);
  assert.equal(t.habitsTotal,2);
  assert.equal(t.habitsDone,1);
  assert.equal(t.habitsLeft,1);
  assert.deepEqual(t.undoneHabits,[{id:1,name:'跑步'}]);
});

test('todayTasks reads real schedule for today',()=>{
  // 2026-11-14 是周六 => day 6
  const state={schedule:{courses:[{id:1,name:'解剖',day:6,start:1,len:2},{id:2,name:'生理',day:1,start:1,len:2}]}};
  const t=todayTasks(state,NOW);
  assert.equal(t.coursesToday,1);
});

test('subjectMastery groups and sorts by size',()=>{
  const state={mistakes:{items:[
    {id:1,subject:'数学',title:'a',mastery:2},
    {id:2,subject:'数学',title:'b',mastery:0},
    {id:3,subject:'英语',title:'c',mastery:2}
  ]}};
  const s=subjectMastery(state);
  assert.equal(s[0].subject,'数学');
  assert.equal(s[0].total,2);
  assert.equal(s[0].mastered,1);
  assert.equal(s[0].rate,50);
  assert.equal(s[1].rate,100);
});

test('upcomingExams skips past and sorts nearest first',()=>{
  const state={exams:{exams:[
    {id:1,name:'远期',date:'2026-12-30'},
    {id:2,name:'已过',date:'2026-11-01'},
    {id:3,name:'临近',date:'2026-11-20',milestones:[{id:1,label:'一轮',done:true},{id:2,label:'二轮',done:false}]}
  ]}};
  const e=upcomingExams(state,NOW,3);
  assert.equal(e.length,2);
  assert.equal(e[0].name,'临近');
  assert.equal(e[0].days,6);
  assert.equal(e[0].pct,50);
});

test('studyStreak counts consecutive active days',()=>{
  const state={focus:{history:{[d(0)]:1,[d(1)]:2,[d(2)]:1}}};
  assert.equal(studyStreak(state,NOW),3);
  const gap={focus:{history:{[d(0)]:1,[d(2)]:1}}};
  assert.equal(studyStreak(gap,NOW),1);
});

test('studyStreak tolerates today not yet recorded',()=>{
  const state={focus:{history:{[d(1)]:1,[d(2)]:1}}};
  assert.equal(studyStreak(state,NOW),2);
});

test('studyStreak counts habit-only days',()=>{
  const state={habits:{habits:[{id:1,name:'x',checks:{[d(0)]:1,[d(1)]:1}}]}};
  assert.equal(studyStreak(state,NOW),2);
});

test('overviewLine uses only confirmed numbers',()=>{
  const s=buildOverview({cards:{cards:[{id:1,front:'a',back:'b',due:NOW-1}]}},NOW);
  assert.ok(s.line.includes('1 张卡片到期'));
  const clean=buildOverview({focus:{history:{[d(0)]:1}}},NOW);
  assert.ok(clean.line.includes('连续学习'));
});

test('buildOverview aggregates quiz accuracy',()=>{
  const s=buildOverview({medquiz:{answered:10,right:7,wrong:{q1:1,q2:2}}},NOW);
  assert.equal(s.quiz.answered,10);
  assert.equal(s.quiz.accuracy,70);
  assert.equal(s.quiz.wrong,2);
});

test('dirty data does not throw',()=>{
  const s=buildOverview({focus:null,cards:{cards:'bad'},mistakes:{items:[null,{}]},habits:{habits:[{name:''}]},exams:{exams:[{name:'x',date:'bad'}]},schedule:{courses:'bad'},medquiz:{answered:'x'}},NOW);
  assert.equal(s.cards.total,0);
  assert.equal(s.quiz.answered,0);
  assert.deepEqual(s.exams,[]);
  assert.equal(s.week.length,7);
});