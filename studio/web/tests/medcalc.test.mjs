import test from 'node:test';
import assert from 'node:assert/strict';
import {CALCULATORS,calcById,runCalc} from '../src/medcalc.js';

test('10 calculators with valid structure',()=>{
  assert.equal(CALCULATORS.length,10);
  for(const c of CALCULATORS){
    assert.ok(c.id&&c.name&&c.formula&&c.unit);
    assert.ok(Array.isArray(c.inputs)&&c.inputs.length>=1);
    assert.equal(typeof c.compute,'function');
    assert.equal(typeof c.interpret,'function');
  }
});

test('BMI normal and obese',()=>{
  const r=runCalc('bmi',{w:60,h:170});
  assert.ok(Math.abs(r.rounded-20.76)<0.01);
  assert.equal(r.tone,'ok');
  const o=runCalc('bmi',{w:90,h:170});
  assert.equal(o.tone,'bad');
});

test('BSA Mosteller',()=>{
  const r=runCalc('bsa',{h:170,w:60});
  assert.ok(Math.abs(r.rounded-1.68)<0.01);
});

test('MAP',()=>{
  const r=runCalc('map',{s:120,d:80});
  assert.ok(Math.abs(r.rounded-93.33)<0.01);
  assert.equal(r.tone,'ok');
  const low=runCalc('map',{s:70,d:40});
  assert.equal(low.tone,'bad');
});

test('AG normal and high',()=>{
  const r=runCalc('ag',{na:140,cl:104,hco3:24});
  assert.equal(r.rounded,12);
  assert.equal(r.tone,'ok');
  const hi=runCalc('ag',{na:140,cl:90,hco3:12});
  assert.equal(hi.rounded,38);
  assert.equal(hi.tone,'bad');
});

test('corrected calcium',()=>{
  const r=runCalc('ca',{ca:2.2,alb:40});
  assert.equal(r.rounded,2.2);
  const low=runCalc('ca',{ca:2.0,alb:20});
  assert.equal(low.rounded,2.4);
});

test('Ccr male and female',()=>{
  const m=runCalc('ccr',{age:40,w:60,scr:80,female:0});
  const f=runCalc('ccr',{age:40,w:60,scr:80,female:1});
  assert.ok(Math.abs(f.value-m.value*0.85)<0.01);
  assert.ok(m.value>90);
});

test('drip rate',()=>{
  const r=runCalc('drip',{vol:500,factor:15,min:120});
  assert.equal(r.rounded,62.5);
});

test('pump rate',()=>{
  const r=runCalc('pump',{vol:500,h:8});
  assert.equal(r.rounded,62.5);
});

test('dose by weight',()=>{
  const r=runCalc('dose',{mgkg:10,w:60});
  assert.equal(r.rounded,600);
});

test('osmolality',()=>{
  const r=runCalc('osm',{na:140,glu:5,urea:5});
  assert.equal(r.rounded,290);
  assert.equal(r.tone,'ok');
});

test('invalid input returns null',()=>{
  assert.equal(runCalc('bmi',{w:0,h:170}),null);
  assert.equal(runCalc('bmi',{w:60,h:999}),null);
  assert.equal(runCalc('nope',{}),null);
  assert.equal(runCalc('bmi',{w:'abc',h:170}),null);
});

test('calcById',()=>{
  assert.equal(calcById('bmi').id,'bmi');
  assert.equal(calcById('zzz'),null);
});