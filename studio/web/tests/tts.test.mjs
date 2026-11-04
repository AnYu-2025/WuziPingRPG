import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTTS,
  splitSpeechSegments,
  splitSpeechText,
  speechStats,
  ttsDebug,
  ttsReceive,
  ttsSanitize
} from '../src/tts.js';

function harness(text,initial={}){
  let settings=ttsSanitize(initial);
  const requests=[];
  const notices=[];
  let timer=0;
  const env={
    native:true,
    getText:()=>text,
    getSettings:()=>settings,
    setSettings:value=>{settings=ttsSanitize(value);},
    saveSettings:()=>{},
    send:(type,data)=>requests.push(data),
    notify:message=>notices.push(message),
    now:()=>1000,
    setTimeout:()=>++timer,
    clearTimeout:()=>{}
  };
  initTTS(env);
  ttsReceive({type:'ttsStatus',ready:true,voices:[{name:'Test English',locale:'en-US'}]});
  return {requests,notices,settings:()=>settings};
}

const longText=Array.from({length:180},(_,index)=>(
  'Paragraph '+(index+1)+' explains one English idea with enough detail to keep the reader moving forward.'
)).join(' ');

test('empty and whitespace-only text has no speech chunks',()=>{
  assert.deepEqual(splitSpeechText(''),[]);
  assert.deepEqual(splitSpeechText('  \n\t  '),[]);
});

test('short English paragraphs remain a single chunk',()=>{
  const text='The morning is quiet.\n\nA new page is waiting.';
  assert.deepEqual(splitSpeechText(text),[text]);
});

test('long text is split without exceeding the requested limit',()=>{
  const text=('A clear sentence explains one idea. Another sentence makes the point easier to follow. ').repeat(100);
  const chunks=splitSpeechText(text,320);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.length<=320));
  assert.equal(chunks.join(' ').replace(/\s+/g,' ').trim(),text.replace(/\s+/g,' ').trim());
});

test('segments retain absolute offsets for resume',()=>{
  const document=splitSpeechSegments(longText,500);
  assert.ok(document.segments.length>1);
  assert.equal(document.segments[0].start,0);
  assert.ok(document.segments.every((segment,index)=>segment.text===
    document.text.slice(segment.start,segment.end)));
  assert.ok(document.segments.every((segment,index)=>index===0||segment.start>=document.segments[index-1].end));
});

test('sentence endings are preferred over arbitrary word boundaries',()=>{
  const text='First sentence gives useful context. Second sentence carries the next part.'.repeat(20);
  const chunks=splitSpeechText(text,150);
  assert.ok(chunks.length>1);
  assert.ok(/[.!?]$/.test(chunks[0]),'first chunk ends at punctuation');
});

test('an unbroken token is still bounded',()=>{
  const chunks=splitSpeechText('A'.repeat(900),240);
  assert.deepEqual(chunks.map(chunk=>chunk.length),[240,240,240,180]);
});

test('surrogate pairs are not cut in half',()=>{
  const text='English ' + '😀'.repeat(200);
  const chunks=splitSpeechText(text,241);
  assert.ok(chunks.every(chunk=>chunk.length<=241));
  assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk)),'chunk does not end with half a surrogate pair');
  assert.equal(chunks.join('').replace(/\s+/g,''),text.replace(/\s+/g,''));
});

test('statistics support long multi-paragraph English documents',()=>{
  const stats=speechStats("It's a useful guide.\n\nRead every paragraph.");
  assert.equal(stats.characters,43);
  assert.equal(stats.words,7);
  assert.equal(stats.paragraphs,2);
  assert.equal(stats.hasEnglish,true);
});

test('saved TTS settings are bounded and include a resume identity',()=>{
  assert.deepEqual(ttsSanitize({voice:'A'.repeat(200),locale:'zh-CN',rate:9,resumeOffset:-3,fingerprint:'broken'}),{
    voice:'A'.repeat(160),
    locale:'en-US',
    rate:1.5,
    resumeOffset:0,
    fingerprint:''
  });
  assert.equal(ttsSanitize({locale:'en-GB',rate:0.1,resumeOffset:42.9,fingerprint:'deadbeef'}).resumeOffset,42);
});

test('chunk size is capped to a value accepted by the native engine',()=>{
  const segments=splitSpeechSegments('A'.repeat(12000),6000).segments;
  assert.ok(segments.every(segment=>segment.text.length<=3600));
});

test('pause and resume continue inside the current speech chunk',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  assert.ok(first);
  ttsReceive({type:'ttsRange',id:first.id,start:300,end:310});
  assert.equal(ttsDebug.info().offset,300);
  ttsDebug.pause();
  const pause=env.requests.find(request=>request.type==='ttsPause');
  assert.ok(pause);
  ttsReceive({type:'ttsPaused',id:pause.id,charIndex:300,supported:true});
  assert.equal(ttsDebug.info().state,'paused');
  assert.equal(ttsDebug.info().offset,300);
  ttsDebug.resume();
  const second=env.requests.filter(request=>request.type==='ttsSpeak')[1];
  assert.ok(second);
  assert.equal(second.text,first.text.slice(300));
  assert.equal(ttsDebug.info().offset,300);
});

test('resume position survives reinitialization for the same document',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  ttsReceive({type:'ttsRange',id:first.id,start:420,end:430});
  ttsDebug.pause();
  const saved=env.settings();
  const resumed=harness(longText,saved);
  ttsDebug.start();
  const request=resumed.requests.find(item=>item.type==='ttsSpeak');
  assert.equal(ttsDebug.info().offset,420);
  assert.equal(request.text,first.text.slice(420));
});

test('duplicate completion callbacks cannot skip a chunk',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  ttsReceive({type:'ttsDone',id:first.id});
  assert.equal(env.requests.filter(request=>request.type==='ttsSpeak').length,2);
  ttsReceive({type:'ttsDone',id:first.id});
  assert.equal(env.requests.filter(request=>request.type==='ttsSpeak').length,2);
});

test('matching speech errors surface once and stop playback',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  ttsReceive({type:'ttsError',id:first.id,message:'Mock engine error'});
  assert.equal(ttsDebug.info().state,'error');
  assert.deepEqual(env.notices,['Mock engine error']);
  ttsReceive({type:'ttsError',id:first.id,message:'Duplicate'});
  assert.deepEqual(env.notices,['Mock engine error']);
});

test('native stop event leaves the state machine idle',()=>{
  const env=harness(longText);
  ttsDebug.start();
  assert.equal(ttsDebug.info().state,'playing');
  ttsReceive({type:'ttsStopped'});
  assert.equal(ttsDebug.info().state,'idle');
});

test('missing English and oversized documents explain why playback is blocked',()=>{
  const empty=harness('中文内容');
  ttsDebug.start();
  assert.ok(empty.notices.includes('这个文件里没有英文内容。'));
  assert.equal(empty.requests.some(request=>request.type==='ttsSpeak'),false);

  const oversized=harness('A'.repeat(500001));
  ttsDebug.start();
  assert.ok(oversized.notices.includes('文本超过 50 万字符，请先拆分文件。'));
  assert.equal(oversized.requests.some(request=>request.type==='ttsSpeak'),false);
});
