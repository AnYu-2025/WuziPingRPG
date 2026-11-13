import test from 'node:test';
import assert from 'node:assert/strict';
import {splitChapters,novelSettingsSanitize,shelfSanitize,bookSanitize,progressText} from '../src/novel.js';

test('splitChapters recognizes 第X章 and keeps 前言',()=>{
  const t='开头闲话\n第一章 起风了\n正文一\n第二章 落雨\n正文二';
  const ch=splitChapters(t);
  assert.equal(ch.length,3);
  assert.equal(ch[0].title,'前言');
  assert.equal(ch[1].title,'第一章 起风了');
  assert.equal(ch[1].body,'正文一');
  assert.equal(ch[2].body,'正文二');
});

test('splitChapters handles 中文数字与节/回',()=>{
  const t='第一百零三回 大结局\n完';
  const ch=splitChapters(t);
  assert.equal(ch.length,1);
  assert.equal(ch[0].title,'第一百零三回 大结局');
});

test('splitChapters without marks splits ~4000 chars',()=>{
  const para='这是一段小说正文。\n'.repeat(300); // ~3300 chars
  const t=para+para+para; // ~9900
  const ch=splitChapters(t);
  assert.ok(ch.length>=2);
  assert.ok(ch.every(c=>c.body.length<=4200));
  assert.equal(ch[0].title,'第 1 段');
});

test('splitChapters empty returns []',()=>{
  assert.deepEqual(splitChapters(''),[]);
  assert.deepEqual(splitChapters('   \n '),[]);
});

test('novelSettingsSanitize clamps',()=>{
  const s=novelSettingsSanitize({fontSize:99,theme:'hacker',line:9});
  assert.equal(s.fontSize,30);
  assert.equal(s.theme,'paper');
  assert.equal(s.line,2.6);
});

test('shelfSanitize dedupes and fixes current',()=>{
  const s=shelfSanitize({nextId:1,current:99,books:[{title:'a',chapterCount:3},{title:'b',chapterCount:2}]});
  assert.equal(s.current,null);
  const ids=s.books.map(b=>b.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(s.nextId>Math.max(...ids));
});

test('bookSanitize clamps ch to chapterCount-1',()=>{
  const b=bookSanitize({title:'x',chapterCount:5,ch:99},1);
  assert.equal(b.ch,4);
  assert.equal(bookSanitize({title:'  '},1),null);
});

test('progressText',()=>{
  assert.equal(progressText({ch:0,chapterCount:4}),'读到第 1/4 章 · 25%');
  assert.equal(progressText(null),'未开始');
});