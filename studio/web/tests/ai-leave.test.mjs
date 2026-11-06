import test from 'node:test';
import assert from 'node:assert/strict';
import {aiLeavePlan} from '../src/ai.js';

test('busy AI with queued messages cancels and reports the dropped count',()=>{
  assert.deepEqual(aiLeavePlan({busy:true,queueLength:3}),{
    cancel:true,
    dropQueue:true,
    notice:3
  });
});

test('busy AI with an empty queue cancels without a notice',()=>{
  assert.deepEqual(aiLeavePlan({busy:true,queueLength:0}),{
    cancel:true,
    dropQueue:false,
    notice:0
  });
});

test('idle AI still drops a stale queue and reports it',()=>{
  assert.deepEqual(aiLeavePlan({busy:false,queueLength:4}),{
    cancel:false,
    dropQueue:true,
    notice:4
  });
});

test('idle AI with no queue does nothing',()=>{
  assert.deepEqual(aiLeavePlan({busy:false,queueLength:0}),{
    cancel:false,
    dropQueue:false,
    notice:0
  });
});
