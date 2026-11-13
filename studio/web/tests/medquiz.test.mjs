import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_BANK,QUIZ_SUBJECTS,bankCount,getBank,parseBankText,mergeBank,qKey} from '../src/quiz-data.js';
import {buildQuiz,answerQuiz,nextQuiz,gradeQuiz,accuracy,sessionSummary,quizStatsSanitize,shuffle} from '../src/medquiz.js';

test('bank integrity: >=160 questions, unique ids & stems, valid answers',()=>{
  assert.ok(QUIZ_BANK.length>=160);
  const ids=new Set(QUIZ_BANK.map(q=>q.id));
  assert.equal(ids.size,QUIZ_BANK.length);
  const stems=new Set(QUIZ_BANK.map(q=>qKey(q.q)));
  assert.equal(stems.size,QUIZ_BANK.length);
  for(const q of QUIZ_BANK){
    assert.ok(q.options.length>=2);
    assert.ok(q.answer>=0&&q.answer<q.options.length);
    assert.ok(QUIZ_SUBJECTS.includes(q.subject));
    assert.ok([1,2,3].includes(q.difficulty));
  }
  assert.equal(bankCount('解剖'),20);
});

test('mergeBank dedupes by normalized stem',()=>{
  const a=[{q:'人体最大的器官是？',options:['皮肤','肝'],answer:0,subject:'解剖'}];
  const b=[{q:'人体最大的器官是?',options:['肝','皮肤'],answer:1,subject:'解剖'},{q:'新题？',options:['a','b'],answer:0,subject:'诊断'}];
  const m=mergeBank(a,b);
  assert.equal(m.length,2); // 重复题干只留先者
  assert.equal(m[0].id.startsWith('b:'),true);
});

test('parseBankText accepts JSON array / JSONL / {questions}',()=>{
  const arr=parseBankText('[{"q":"x?","options":["a","b"],"answer":1}]');
  assert.equal(arr.list.length,1);
  const jl=parseBankText('{"q":"y?","options":["a","b"],"answer":0}\n{"q":"z?","options":["a","b"],"answer":1}');
  assert.equal(jl.list.length,2);
  const obj=parseBankText('{"questions":[{"q":"w?","options":["a","b"],"answer":0}]}');
  assert.equal(obj.list.length,1);
  const bad=parseBankText('not json');
  assert.equal(bad.list.length,0);
});

test('buildQuiz difficulty filter',()=>{
  const hard=buildQuiz(quizStatsSanitize(null),'全部','order',undefined,QUIZ_BANK,3);
  assert.ok(hard.ids.length>0);
  assert.ok(hard.ids.every(id=>QUIZ_BANK.find(q=>q.id===id).difficulty===3));
  const all=buildQuiz(quizStatsSanitize(null),'全部','order',undefined,QUIZ_BANK,0);
  assert.equal(all.ids.length,QUIZ_BANK.length);
});

test('buildQuiz order/random/wrong',()=>{
  const first=QUIZ_BANK[0].id;
  const stats=quizStatsSanitize({wrong:{[first]:2}});
  const order=buildQuiz(stats,'全部','order');
  assert.equal(order.ids[0],first);
  const wrong=buildQuiz(stats,'全部','wrong');
  assert.deepEqual(wrong.ids,[first]);
  const rnd=buildQuiz(stats,'全部','random',()=>0.5);
  assert.equal(rnd.ids.length,QUIZ_BANK.length);
});

test('answerQuiz locks and nextQuiz finishes',()=>{
  let s=buildQuiz(quizStatsSanitize({wrong:{[QUIZ_BANK[0].id]:1}}),'全部','wrong');
  s=answerQuiz(s,QUIZ_BANK[0].id,0);
  const locked=answerQuiz(s,QUIZ_BANK[0].id,3);
  assert.equal(locked.answers[QUIZ_BANK[0].id],0);
  s=nextQuiz(s);
  assert.equal(s.finished,true);
});

test('gradeQuiz wrong then correct updates stats',()=>{
  const q=QUIZ_BANK[0];
  const wrongChoice=(q.answer+1)%q.options.length;
  let st=quizStatsSanitize(null);
  st=gradeQuiz(st,q.id,wrongChoice);
  assert.equal(st.wrong[q.id],1);assert.equal(st.right,0);
  st=gradeQuiz(st,q.id,q.answer);
  assert.equal(st.wrong[q.id],undefined);assert.equal(st.right,1);
  assert.equal(accuracy(st),50);
});

test('sessionSummary with custom bank',()=>{
  const custom=[{id:'c1',q:'自定义题？',options:['a','b'],answer:1,subject:'诊断',difficulty:3}];
  const bank=getBank(custom);
  let s=buildQuiz(quizStatsSanitize(null),'全部','order',undefined,bank,0);
  const cid=bank.find(q=>q.id.startsWith('c:')).id;
  s=answerQuiz(s,cid,1,bank);
  const sum=sessionSummary(s,bank);
  assert.equal(sum.right,1);
});