import test from 'node:test';
import assert from 'node:assert/strict';
import {starSanitize} from '../src/star-data.js';

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

test('view preference defaults to sky and only accepts list',()=>{
  assert.equal(starSanitize({},IDS).view,'sky');
  assert.equal(starSanitize({view:'list'},IDS).view,'list');
  assert.equal(starSanitize({view:'bogus'},IDS).view,'sky');
  const p=starSanitize({view:'list',starred:['ai']},IDS);
  assert.deepEqual(starSanitize(p,IDS),p);
});
