import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTTS,
  splitSpeechSegments,
  splitSpeechText,
  speechStats,
  ttsDebug,
  ttsDocumentChanged,
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

/* 与 harness 相同，但 now() 是一只可手动推进的时钟，用来驱动暂停估算。 */
function timedHarness(text,initial={}){
  let settings=ttsSanitize(initial);
  const requests=[];
  const notices=[];
  let time=1000;
  let timer=0;
  const env={
    native:true,
    getText:()=>text,
    getSettings:()=>settings,
    setSettings:value=>{settings=ttsSanitize(value);},
    saveSettings:()=>{},
    send:(type,data)=>requests.push(data),
    notify:message=>notices.push(message),
    now:()=>time,
    setTimeout:()=>++timer,
    clearTimeout:()=>{}
  };
  initTTS(env);
  ttsReceive({type:'ttsStatus',ready:true,voices:[{name:'Test English',locale:'en-US'}]});
  return {requests,notices,settings:()=>settings,advance:ms=>{time+=ms;}};
}

const longText=Array.from({length:180},(_,index)=>(
  'Paragraph '+(index+1)+' explains one English idea with enough detail to keep the reader moving forward.'
)).join(' ');

test('empty and whitespace-only text has no speech chunks',()=>{
  assert.deepEqual(splitSpeechText(''),[]);
  assert.deepEqual(splitSpeechText('  \n\t  '),[]);
});

test('short English paragraphs remain a single chunk',()=>{
  /* 空行现在是硬段界（不跨空行合并），故本用例用单段短文本验证「短文本不拆段」。 */
  const text='The morning is quiet. A new page is waiting.';
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
    fingerprint:'',
    highlight:true,
    autoscroll:false
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
  /* 句级分段后首段约一两百字符，用段内中点代替旧的大块偏移，意图不变。 */
  const at=Math.floor(first.text.length/2);
  ttsReceive({type:'ttsRange',id:first.id,start:at,end:at+10});
  assert.equal(ttsDebug.info().offset,at);
  ttsDebug.pause();
  const pause=env.requests.find(request=>request.type==='ttsPause');
  assert.ok(pause);
  ttsReceive({type:'ttsPaused',id:pause.id,charIndex:at,supported:true});
  assert.equal(ttsDebug.info().state,'paused');
  assert.equal(ttsDebug.info().offset,at);
  ttsDebug.resume();
  const second=env.requests.filter(request=>request.type==='ttsSpeak')[1];
  assert.ok(second);
  assert.equal(second.text,first.text.slice(at));
  assert.equal(ttsDebug.info().offset,at);
});

test('resume position survives reinitialization for the same document',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  const at=Math.floor(first.text.length/2);
  ttsReceive({type:'ttsRange',id:first.id,start:at,end:at+10});
  ttsDebug.pause();
  const saved=env.settings();
  const resumed=harness(longText,saved);
  ttsDebug.start();
  const request=resumed.requests.find(item=>item.type==='ttsSpeak');
  assert.equal(ttsDebug.info().offset,at);
  assert.equal(request.text,first.text.slice(at));
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

test('default splitting packs whole sentences within the 400 character cap',()=>{
  const text=('The quick brown fox jumps over the lazy dog near the quiet river bank. ').repeat(30);
  const document=splitSpeechSegments(text);
  assert.ok(document.segments.length>1);
  assert.ok(document.segments.every(segment=>segment.text.length<=400));
  assert.ok(document.segments.slice(0,-1).every(segment=>/[.!?]["')\]]*$/.test(segment.text)),'segments end at sentence punctuation');
  assert.equal(document.segments.map(segment=>segment.text).join(' '),text.trim().replace(/\s+/g,' '));
});

test('unpunctuated long text falls back to 400 character cuts aligned to spaces',()=>{
  const text=Array.from({length:300},(_,index)=>'word'+index).join(' ');
  const chunks=splitSpeechText(text);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.length<=400));
  assert.ok(chunks.every(chunk=>!/^\s|\s$/.test(chunk)),'cuts stay aligned to spaces');
  assert.equal(chunks.join(' '),text);
});

test('segments carry raw editor offsets for highlighting',()=>{
  const sentence='A clear sentence explains one idea with enough detail to matter.';
  const raw='  '+Array.from({length:12},()=>sentence).join('\r\n')+'\r\n';
  const document=splitSpeechSegments(raw);
  assert.ok(document.segments.length>1);
  for(const segment of document.segments){
    /* 段首/段尾都不是空白，规范化只可能在段内把 \r\n 收成 \n。 */
    assert.equal(raw.slice(segment.rawStart,segment.rawEnd).replace(/\r\n?/g,'\n'),segment.text);
  }
  const first=splitSpeechSegments(raw).segments[0];
  assert.equal(raw.charAt(first.rawStart),first.text.charAt(0));
});

test('raw offsets stay aligned through CRLF, blank-line runs, and edge newlines',()=>{
  const raw='\n\n\n\r\nFirst one here. Second follows.\r\n\r\n\r\n\r\n\r\nLast part arrives.';
  const document=splitSpeechSegments(raw);
  /* 空行是硬段界：两侧短句不得合并进同一段。 */
  assert.equal(document.segments.length,2);
  assert.equal(document.segments[0].text,'First one here. Second follows.');
  assert.equal(document.segments[1].text,'Last part arrives.');
  /* 段首落在原文的 'F' 上，而不是被压缩/trim 吃掉的 '\r'。 */
  assert.equal(raw.charAt(document.segments[0].rawStart),'F');
  for(const segment of document.segments){
    assert.equal(raw.slice(segment.rawStart,segment.rawEnd).trim(),segment.text);
  }
});

test('pause without range support estimates position from elapsed time',()=>{
  const env=timedHarness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  assert.ok(first);
  const segment=splitSpeechSegments(longText).segments[0];
  env.advance(4000); // 4 秒 × 15 字/秒 × 1x ≈ 60 字符
  ttsDebug.pause();
  ttsReceive({type:'ttsPaused',id:env.requests.find(request=>request.type==='ttsPause').id,supported:false});
  const info=ttsDebug.info();
  assert.equal(info.state,'paused');
  assert.equal(info.exactPause,false);
  assert.ok(info.offset>0,'never rewinds to the segment start');
  assert.ok(info.offset<=segment.end,'stays inside the current segment');
  assert.ok(info.offset>=55&&info.offset<=90,'follows the elapsed-time estimate');
  const text=splitSpeechSegments(longText).text;
  assert.ok(/[A-Za-z0-9]/.test(text.charAt(info.offset))&&!/[A-Za-z0-9'-]/.test(text.charAt(info.offset-1)),'aligned to a word boundary');
});

test('a late unsupported pause reply does not skip words spoken after the tap',()=>{
  const env=timedHarness(longText);
  ttsDebug.start();
  env.advance(4000);
  ttsDebug.pause();
  const frozen=ttsDebug.info().offset;
  assert.ok(frozen>0);
  env.advance(5000);
  const pause=env.requests.find(request=>request.type==='ttsPause');
  ttsReceive({type:'ttsPaused',id:pause.id,supported:false});
  assert.equal(ttsDebug.info().offset,frozen);
  assert.equal(ttsDebug.info().exactPause,false);
});

test('estimated pause converges forward, never back to the segment start',()=>{
  const env=timedHarness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  const segment=splitSpeechSegments(longText).segments[0];
  const at=Math.floor(segment.text.length/2);
  ttsReceive({type:'ttsRange',id:first.id,start:at,end:at+10});
  ttsDebug.pause();
  ttsReceive({type:'ttsPaused',id:env.requests.find(request=>request.type==='ttsPause').id,charIndex:at,supported:true});
  assert.equal(ttsDebug.info().offset,at);
  ttsDebug.resume();
  const second=env.requests.filter(request=>request.type==='ttsSpeak')[1];
  assert.equal(second.text,first.text.slice(at));
  /* 恢复后立刻再暂停：已播 0 秒，估算不推进；结果必须收敛到起点之后的第一个词边界。 */
  ttsDebug.pause();
  const pauses=env.requests.filter(request=>request.type==='ttsPause');
  ttsReceive({type:'ttsPaused',id:pauses[pauses.length-1].id,supported:false});
  const info=ttsDebug.info();
  assert.ok(info.offset>at,'converges forward past the utterance base, never back to re-read');
  assert.ok(info.offset<=segment.end,'stays inside the current segment');
});

test('document changes distinguish real edits from file switches',()=>{
  const env=harness(longText);
  ttsDebug.start();
  const first=env.requests.find(request=>request.type==='ttsSpeak');
  const at=Math.floor(first.text.length/2);
  ttsReceive({type:'ttsRange',id:first.id,start:at,end:at+10});
  ttsDebug.pause();
  ttsReceive({type:'ttsPaused',id:env.requests.find(request=>request.type==='ttsPause').id,charIndex:at,supported:true});
  /* 切文件/进出模式：同一文档，暂停位置与状态保留。 */
  ttsDocumentChanged('switched');
  assert.equal(ttsDebug.info().state,'paused');
  assert.equal(env.settings().resumeOffset,at);
  ttsDebug.resume();
  assert.equal(ttsDebug.info().state,'playing');
  assert.equal(ttsDebug.info().offset,at);
  /* 文档真的被编辑：停止朗读并清空位置。 */
  ttsDocumentChanged('edited');
  assert.equal(ttsDebug.info().state,'idle');
  assert.equal(env.settings().resumeOffset,0);
  assert.equal(env.settings().fingerprint,'');
  assert.ok(env.notices.includes('文本已修改，朗读已停止。'));
});

test('highlight and autoscroll settings are sanitized with safe defaults',()=>{
  assert.equal(ttsSanitize(null).highlight,true);
  assert.equal(ttsSanitize(null).autoscroll,false);
  assert.equal(ttsSanitize({}).highlight,true);
  assert.equal(ttsSanitize({}).autoscroll,false);
  assert.equal(ttsSanitize({highlight:false}).highlight,false);
  assert.equal(ttsSanitize({highlight:1}).highlight,true);
  assert.equal(ttsSanitize({autoscroll:true}).autoscroll,true);
  assert.equal(ttsSanitize({autoscroll:0}).autoscroll,false);
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
