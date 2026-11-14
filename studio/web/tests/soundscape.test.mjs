import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYERS,PRESETS,defaultSoundscape,soundscapeSanitize,setLayer,setMaster,applyPreset,startTimer,clearTimer,timerRemaining,fadeGain,activeLayers} from '../src/soundscape.js';

test('8 layers and 6 presets',()=>{
  assert.equal(LAYERS.length,8);
  assert.equal(PRESETS.length,6);
});

test('default all off',()=>{
  const s=defaultSoundscape();
  assert.equal(activeLayers(s).length,0);
  assert.equal(s.master,.8);
});

test('sanitize clamps and drops unknown preset',()=>{
  const s=soundscapeSanitize({master:9,preset:'nope',layers:{rain:{on:true,vol:5}}});
  assert.equal(s.master,1);
  assert.equal(s.preset,'');
  assert.equal(s.layers.rain.vol,1);
  assert.equal(s.layers.rain.on,true);
});

test('setLayer toggles and clears preset',()=>{
  let s=applyPreset(defaultSoundscape(),'rainynight');
  assert.equal(s.preset,'rainynight');
  s=setLayer(s,'rain',true,.7);
  assert.equal(s.preset,'');
  assert.equal(s.layers.rain.vol,.7);
  s=setLayer(s,'rain',false);
  assert.equal(s.layers.rain.on,false);
});

test('applyPreset sets mix and clears others',()=>{
  let s=setLayer(defaultSoundscape(),'white',true,.5);
  s=applyPreset(s,'campfire');
  const act=activeLayers(s).sort();
  assert.deepEqual(act,['fire','night','wind']);
  assert.equal(s.layers.white.on,false);
  assert.equal(s.layers.fire.vol,.6);
});

test('setMaster clamps',()=>{
  assert.equal(setMaster(defaultSoundscape(),2).master,1);
  assert.equal(setMaster(defaultSoundscape(),-1).master,0);
});

test('timer start/remaining/clear',()=>{
  const now=1_000_000;
  let s=startTimer(defaultSoundscape(),30,now);
  assert.equal(s.timerEnd,now+30*60000);
  assert.equal(timerRemaining(s,now+60000),29*60);
  s=clearTimer(s);
  assert.equal(timerRemaining(s,now),0);
});

test('fadeGain ramps in last 20s',()=>{
  assert.equal(fadeGain(60),1);
  assert.equal(fadeGain(10),0.5);
  assert.equal(fadeGain(0),0);
});