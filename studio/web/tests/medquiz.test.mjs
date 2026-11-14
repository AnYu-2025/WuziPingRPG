import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_BANK,QUIZ_SUBJECTS,bankCount,getBank,parseBankText,mergeBank,qKey} from '../src/quiz-data.js';
import {buildQuiz,answerQuiz,nextQuiz,gradeQuiz,accuracy,sessionSummary,quizStatsSanitize,shuffle,displayOptions,chosenDisplay} from '../src/medquiz.js';

test('bank integrity: >=600 questions, unique ids & stems, valid answers',()=>{
  assert.ok(QUIZ_BANK.length>=600);
  const ids=new Set(QUIZ_BANK.map(q=>q.id));
  assert.equal(ids.size,QUIZ_BANK.length);
  const stems=new Set(QUIZ_BANK.map(q=>qKey(q.q)));
  assert.equal(stems.size,QUIZ_BANK.length);
  for(const q of QUIZ_BANK){
    assert.ok(q.options.length>=2);
    assert.ok(q.answer>=0&&q.answer<q.options.length);
    assert.ok(QUIZ_SUBJECTS.includes(q.subject));
    assert.ok([1,2,3,4].includes(q.difficulty));
  }
  assert.equal(bankCount('解剖'),77);
  // 挑战层：8 科各 12 道
  const ch=QUIZ_BANK.filter(q=>q.difficulty===4);
  assert.equal(ch.length,96);
  for(const s of QUIZ_SUBJECTS)assert.equal(ch.filter(q=>q.subject===s).length,12);
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

test('option permutation keeps correct answer and is a true shuffle',()=>{
  const s=buildQuiz(quizStatsSanitize(null),'全部','order');
  let moved=0;
  for(const q of QUIZ_BANK){
    const d=displayOptions(s,q);
    assert.equal(d.options.length,q.options.length);
    assert.equal(d.options[d.answer],q.options[q.answer]);
    assert.deepEqual(d.perm.slice().sort((a,b)=>a-b),q.options.map((_,i)=>i));
    if(d.answer!==q.answer)moved++;
  }
  assert.ok(moved>QUIZ_BANK.length*0.5); // 大多数题正确项不再原位
});

test('answer via displayed index grades correctly',()=>{
  const s=buildQuiz(quizStatsSanitize(null),'解剖','order');
  const q=QUIZ_BANK.find(x=>x.subject==='解剖');
  const d=displayOptions(s,q);
  const after=answerQuiz(s,q.id,d.perm[d.answer]);
  const st=gradeQuiz(quizStatsSanitize(null),q.id,after.answers[q.id]);
  assert.equal(st.right,1);
});

/* 回归：答对时只能标绿正确项，绝不能把别的选项标红。
   历史 bug：渲染用原始下标与展示下标比较，导致答对也标红。 */
test('correct answer marks only the right option (no stray red)',()=>{
  // 用固定 rnd 产生非恒等置换，确保展示下标≠原始下标
  const s=buildQuiz(quizStatsSanitize(null),'全部','order',()=>0.5);
  let checked=0;
  for(const q of QUIZ_BANK.slice(0,120)){
    const d=displayOptions(s,q);
    const after=answerQuiz(s,q.id,d.perm[d.answer]); // 选正确项
    const chosen=chosenDisplay(after,q);
    assert.equal(chosen,d.answer); // 已选展示下标==正确展示下标
    // 渲染逻辑：right 当 i===d.answer；wrong 当 i===chosen 且 i!==d.answer
    const reds=d.options.map((_,i)=>i).filter(i=>i!==d.answer&&i===chosen);
    assert.equal(reds.length,0);
    checked++;
  }
  assert.ok(checked>0);
});

test('wrong answer marks exactly one red (the chosen) plus green right',()=>{
  const s=buildQuiz(quizStatsSanitize(null),'全部','order',()=>0.5);
  for(const q of QUIZ_BANK.slice(0,120)){
    const d=displayOptions(s,q);
    const wrongOriginal=d.perm[(d.answer+1)%d.perm.length];
    const after=answerQuiz(s,q.id,wrongOriginal);
    const chosen=chosenDisplay(after,q);
    assert.notEqual(chosen,d.answer);
    const reds=d.options.map((_,i)=>i).filter(i=>i!==d.answer&&i===chosen);
    assert.equal(reds.length,1);
    assert.equal(reds[0],chosen);
  }
});

test('challenge difficulty filter returns only difficulty 4',()=>{
  const ch=buildQuiz(quizStatsSanitize(null),'全部','order',undefined,QUIZ_BANK,4);
  assert.equal(ch.ids.length,96);
  assert.ok(ch.ids.every(id=>QUIZ_BANK.find(q=>q.id===id).difficulty===4));
});