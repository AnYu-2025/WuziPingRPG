import test from 'node:test';
import assert from 'node:assert/strict';
import {PELICAN_DEFAULT,pelicanSanitize,pelicanStart,pelicanJump,pelicanTick,GRAVITY,JUMP_V} from '../src/pelican.js';

test('sanitize keeps best only',()=>{
  assert.equal(pelicanSanitize({best:42}).best,42);
  assert.equal(pelicanSanitize(null).best,0);
  assert.equal(pelicanSanitize({best:-5}).best,0);
});

test('start resets and marks started',()=>{
  const s=pelicanStart(10);
  assert.equal(s.started,true);
  assert.equal(s.over,false);
  assert.equal(s.best,10);
  assert.equal(s.y,0);
});

test('jump only when on ground',()=>{
  let s=pelicanStart(0);
  s=pelicanJump(s);
  assert.equal(s.vy,JUMP_V);
  assert.equal(s.onGround,false);
  const again=pelicanJump(s);
  assert.equal(again.vy,JUMP_V); /* 空中不二次跳 */
});

test('tick advances distance and score',()=>{
  let s=pelicanStart(0);
  for(let i=0;i<60;i++)s=pelicanTick(s,1/60);
  assert.ok(s.distance>0);
  assert.equal(s.score,Math.floor(s.distance));
});

test('gravity brings jumper back to ground',()=>{
  let s=pelicanJump(pelicanStart(0));
  let airborne=false;
  for(let i=0;i<240;i++){s=pelicanTick(s,1/60);if(s.y>0)airborne=true;if(s.over)break;}
  assert.ok(airborne);
  assert.equal(s.y,0);
  assert.equal(s.onGround,true);
});

test('collision ends game when obstacle reaches pelican on ground',()=>{
  let s=pelicanStart(0);
  /* 手动放一个障碍在鹈鹕处 */
  s={...s,obstacles:[{x:-0.2,w:0.6,h:1.0}]};
  s=pelicanTick(s,1/60);
  assert.equal(s.over,true);
});

test('jumping over obstacle avoids collision',()=>{
  let s=pelicanStart(0);
  s={...s,obstacles:[{x:2.0,w:0.6,h:0.8}]};
  /* 跳起 */
  s=pelicanJump(s);
  let hit=false;
  for(let i=0;i<120;i++){s=pelicanTick(s,1/60);if(s.over){hit=true;break;}}
  /* 跳跃高度足以越过 0.8 障碍 */
  assert.equal(hit,false);
});

test('best updates to max score',()=>{
  let s=pelicanStart(5);
  for(let i=0;i<120;i++)s=pelicanTick(s,1/60);
  assert.ok(s.best>=s.score);
  assert.ok(s.best>=5);
});

test('not started or over tick is noop',()=>{
  const a=PELICAN_DEFAULT();
  assert.equal(pelicanTick(a,1/60),a);
  const b={...pelicanStart(0),over:true};
  assert.equal(pelicanTick(b,1/60),b);
});