import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_BANK,QUIZ_SUBJECTS,quizById,bankCount} from '../src/quiz-data.js';
import {buildQuiz,answerQuiz,nextQuiz,gradeQuiz,accuracy,sessionSummary,quizStatsSanitize,shuffle} from '../src/medquiz.js';

test('bank integrity: 40 questions, unique ids, valid answers',()=>{
  assert.equal(QUIZ_BANK.length,40);
  const ids=new Set(QUIZ_BANK.map(q=>q.id));
  assert.equal(ids.size,40);
  for(const q of QUIZ_BANK){
    assert.equal(q.options.length,4);
    assert.ok(q.answer>=0&&q.answer<4);
    assert.ok(q.explain.length>5);
    assert.ok(QUIZ_SUBJECTS.includes(q.subject));
  }
  assert.equal(bankCount('解剖'),5);
  assert.equal(bankCount(),40);
});

test('buildQuiz order/random/wrong filters',()=>{
  const stats=quizStatsSanitize({wrong:{a1:2}});
  const order=buildQuiz(stats,'解剖','order');
  assert.equal(order.ids.length,5);
  assert.equal(order.ids[0],'a1');
  const wrong=buildQuiz(stats,'全部','wrong');
  assert.deepEqual(wrong.ids,['a1']);
  const empty=buildQuiz(quizStatsSanitize(null),'全部','wrong');
  assert.equal(empty.finished,true);
  const rnd=buildQuiz(stats,'全部','random',()=>0.5);
  assert.equal(rnd.ids.length,40);
});

test('shuffle keeps elements',()=>{
  const a=[1,2,3,4,5];
  const b=shuffle(a,()=>0.99);
  assert.deepEqual(b.slice().sort(),a);
});

test('answerQuiz locks answer and ignores unknown',()=>{
  const s=buildQuiz(quizStatsSanitize(null),'解剖','order');
  const s2=answerQuiz(s,'a1',1);
  assert.equal(s2.answers.a1,1);
  const s3=answerQuiz(s2,'a1',3); // locked
  assert.equal(s3.answers.a1,1);
  assert.equal(answerQuiz(s,'nope',1),s);
});

test('nextQuiz advances and finishes',()=>{
  let s=buildQuiz(quizStatsSanitize({wrong:{a1:1}}),'全部','wrong');
  assert.equal(s.finished,false);
  s=nextQuiz(s);
  assert.equal(s.finished,true);
});

test('gradeQuiz adds wrong and removes on correct',()=>{
  let st=quizStatsSanitize(null);
  st=gradeQuiz(st,'a1',0); // wrong (answer=1)
  assert.equal(st.answered,1);assert.equal(st.right,0);assert.equal(st.wrong.a1,1);
  st=gradeQuiz(st,'a1',1); // correct
  assert.equal(st.right,1);assert.equal(st.wrong.a1,undefined);
  assert.equal(accuracy(st),50);
});

test('sessionSummary counts right/wrong',()=>{
  let s=buildQuiz(quizStatsSanitize(null),'解剖','order');
  s=answerQuiz(s,'a1',1); // right
  s=answerQuiz(s,'a2',0); // wrong (answer=1)
  const sum=sessionSummary(s);
  assert.equal(sum.total,5);assert.equal(sum.right,1);assert.equal(sum.wrong,1);
});

test('quizStatsSanitize drops unknown wrong ids',()=>{
  const st=quizStatsSanitize({wrong:{zzz:3,a1:2},answered:-5});
  assert.equal(st.wrong.zzz,undefined);
  assert.equal(st.wrong.a1,2);
  assert.equal(st.answered,0);
});