import test from 'node:test';
import assert from 'node:assert/strict';
import {radarData,radarPoints,radarPolygon} from '../src/study-radar.js';

const SUBJ=['解剖','生理','生化'];

test('radarData computes rate and flags no-data',()=>{
  const d=radarData(SUBJ,{'解剖':{answered:10,right:7},'生理':{answered:0,right:0}});
  assert.equal(d.length,3);
  assert.equal(d[0].rate,70);
  assert.equal(d[0].hasData,true);
  assert.equal(d[1].hasData,false);
  assert.equal(d[1].rate,0);
  assert.equal(d[2].hasData,false);
});

test('radarData clamps right to answered',()=>{
  const d=radarData(SUBJ,{'解剖':{answered:5,right:9}});
  assert.equal(d[0].rate,100);
});

test('radarPoints first vertex at top and scales by rate',()=>{
  const d=radarData(SUBJ,{'解剖':{answered:10,right:10},'生理':{answered:10,right:5},'生化':{answered:10,right:0}});
  const p=radarPoints(d,100,100,80);
  assert.equal(p[0].x,100);
  assert.equal(p[0].y,20); // 100% => top
  assert.equal(p[1].hasData,true);
  // 50% vertex distance = 40 from center
  const dx=p[1].x-100,dy=p[1].y-100;
  assert.ok(Math.abs(Math.hypot(dx,dy)-40)<0.5);
  // 0% vertex at center
  assert.equal(p[2].x,100);
  assert.equal(p[2].y,100);
});

test('radarPolygon joins points',()=>{
  const d=radarData(SUBJ,{'解剖':{answered:10,right:10}});
  const s=radarPolygon(radarPoints(d,100,100,80));
  assert.ok(s.includes('100,20'));
  assert.equal(s.split(' ').length,3);
});