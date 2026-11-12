import test from 'node:test';
import assert from 'node:assert/strict';
import {starSanitize,starPositions} from '../src/star-home.js';

const IDS=['lecture','tts','scan','python','notepad','photo','model','ai','game'];

test('star prefs fall back to defaults on malformed data',()=>{
  for(const raw of [null,undefined,{},[],{starred:'nope'}]){
    const p=starSanitize(raw,IDS);
    assert.deepEqual(p.starred,[]);
    assert.equal(p.motion,true);
  }
});

test('starred keeps only known ids and dedupes',()=>{
  const p=starSanitize({starred:['ai','ai','bogus','game']},IDS);
  assert.deepEqual(p.starred,['ai','game']);
});

test('motion can be turned off and survives sanitize',()=>{
  const p=starSanitize({motion:false,starred:['model']},IDS);
  assert.equal(p.motion,false);
  assert.deepEqual(p.starred,['model']);
  assert.deepEqual(starSanitize(p,IDS),p);
});

test('star positions sit on the sphere and stay distinct',()=>{
  const pos=starPositions(9,5);
  assert.equal(pos.length,9);
  for(const [x,y,z] of pos){
    const r=Math.hypot(x,y,z);
    assert.ok(Math.abs(r-5)<1e-6,r);
  }
  for(let i=0;i<pos.length;i++){
    for(let j=i+1;j<pos.length;j++){
      const d=Math.hypot(pos[i][0]-pos[j][0],pos[i][1]-pos[j][1],pos[i][2]-pos[j][2]);
      assert.ok(d>1,d);
    }
  }
});

test('single star and empty list do not throw',()=>{
  assert.equal(starPositions(1).length,1);
  assert.equal(starPositions(0).length,0);
});

test('view preference defaults to sky and only accepts list',()=>{
  assert.equal(starSanitize({},IDS).view,'sky');
  assert.equal(starSanitize({view:'list'},IDS).view,'list');
  assert.equal(starSanitize({view:'bogus'},IDS).view,'sky');
  const p=starSanitize({view:'list',starred:['ai']},IDS);
  assert.deepEqual(starSanitize(p,IDS),p);
});