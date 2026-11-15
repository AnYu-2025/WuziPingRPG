import test from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_TIERS,QUALITY_MODES,qualitySanitize,tierIndexOf,autoTierStep} from '../src/render-quality.js';

test('qualitySanitize accepts modes and falls back to auto',()=>{
  for(const m of QUALITY_MODES)assert.equal(qualitySanitize(m),m);
  assert.equal(qualitySanitize('ultra'),'auto');
  assert.equal(qualitySanitize(null),'auto');
  assert.equal(qualitySanitize(42),'auto');
});

test('tierIndexOf maps ids and clamps unknown',()=>{
  assert.equal(tierIndexOf('high'),0);
  assert.equal(tierIndexOf('med'),1);
  assert.equal(tierIndexOf('low'),2);
  assert.equal(tierIndexOf('nope'),0);
});

test('tiers ordered high to low with decreasing cost',()=>{
  assert.equal(QUALITY_TIERS.length,3);
  for(let i=1;i<QUALITY_TIERS.length;i++){
    assert.ok(QUALITY_TIERS[i].steps<QUALITY_TIERS[i-1].steps);
    assert.ok(QUALITY_TIERS[i].px<=QUALITY_TIERS[i-1].px);
  }
});

test('autoTierStep downgrades after two sustained low evaluations',()=>{
  let s={tier:0,holds:{low:0,high:0}};
  s=autoTierStep(s.tier,30,s.holds);
  assert.equal(s.tier,0); // 第一次只记命中
  s=autoTierStep(s.tier,30,s.holds);
  assert.equal(s.tier,1); // 第二次降档
  s=autoTierStep(s.tier,30,s.holds);
  s=autoTierStep(s.tier,30,s.holds);
  assert.equal(s.tier,2);
  s=autoTierStep(s.tier,30,s.holds);
  s=autoTierStep(s.tier,30,s.holds);
  assert.equal(s.tier,2); // 到底不再降
});

test('autoTierStep upgrades after three sustained high evaluations',()=>{
  let s={tier:2,holds:{low:0,high:0}};
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,60,s.holds);
  assert.equal(s.tier,2);
  s=autoTierStep(s.tier,60,s.holds);
  assert.equal(s.tier,1);
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,60,s.holds);
  assert.equal(s.tier,0);
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,60,s.holds);
  assert.equal(s.tier,0); // 到顶不再升
});

test('mid fps resets holds so no flapping',()=>{
  let s={tier:1,holds:{low:0,high:0}};
  s=autoTierStep(s.tier,30,s.holds);
  assert.equal(s.holds.low,1);
  s=autoTierStep(s.tier,50,s.holds);
  assert.equal(s.holds.low,0);
  assert.equal(s.holds.high,0);
  assert.equal(s.tier,1);
  s=autoTierStep(s.tier,60,s.holds);
  s=autoTierStep(s.tier,50,s.holds);
  assert.equal(s.holds.high,0);
  assert.equal(s.tier,1);
});