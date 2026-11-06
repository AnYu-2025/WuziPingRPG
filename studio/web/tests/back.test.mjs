import test from 'node:test';
import assert from 'node:assert/strict';
import {BACK,resolveBack} from '../src/back.js';

const base={
  dialogOpen:false,
  drawerOpen:false,
  drawing:false,
  searchOpen:false,
  landingOpen:false,
  now:10000,
  lastBackAt:0,
  doubleWindowMs:2000
};

test('dialog has priority over every other layer',()=>{
  assert.deepEqual(resolveBack({...base,dialogOpen:true,drawerOpen:true,drawing:true,searchOpen:true,landingOpen:true}),{
    action:BACK.DIALOG,
    nextLastBackAt:0
  });
});

test('drawer has priority over draw, search and landing',()=>{
  assert.deepEqual(resolveBack({...base,drawerOpen:true,drawing:true,searchOpen:true,landingOpen:true}),{
    action:BACK.DRAWER,
    nextLastBackAt:0
  });
});

test('drawing has priority over search and landing',()=>{
  assert.equal(resolveBack({...base,drawing:true,searchOpen:true,landingOpen:true}).action,BACK.DRAW);
});

test('search has priority over landing',()=>{
  assert.equal(resolveBack({...base,searchOpen:true,landingOpen:true}).action,BACK.SEARCH);
});

test('open landing is collapsed and starts a fresh double-back window',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,landingOpen:true,lastBackAt:9000}),{
    action:BACK.LANDING,
    nextLastBackAt:10000
  });
});

test('editor outside the double-back window opens landing and records now',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,lastBackAt:1000,doubleWindowMs:2000}),{
    action:BACK.LANDING,
    nextLastBackAt:10000
  });
});

test('editor inside the double-back window requests native exit',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,lastBackAt:9000,doubleWindowMs:2000}),{
    action:BACK.DOUBLE,
    nextLastBackAt:0
  });
});

test('exact double-back window boundary is treated as a double back',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,lastBackAt:8000,doubleWindowMs:2000}),{
    action:BACK.DOUBLE,
    nextLastBackAt:0
  });
});

test('picker collapse followed by a quick editor back requests exit',()=>{
  const first=resolveBack({...base,now:10000,lastBackAt:0});
  const second=resolveBack({...base,now:11000,lastBackAt:first.nextLastBackAt,landingOpen:true});
  const third=resolveBack({...base,now:12000,lastBackAt:second.nextLastBackAt});
  assert.equal(first.action,BACK.LANDING);
  assert.equal(second.action,BACK.LANDING);
  assert.equal(third.action,BACK.DOUBLE);
});

test('missing or undefined context fields do not throw',()=>{
  assert.doesNotThrow(()=>resolveBack());
  assert.doesNotThrow(()=>resolveBack({dialogOpen:undefined,drawerOpen:null,drawing:undefined,searchOpen:null,landingOpen:undefined,now:undefined,lastBackAt:undefined,doubleWindowMs:undefined}));
  assert.equal(typeof resolveBack().action,'string');
});
