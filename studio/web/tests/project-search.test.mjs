import test from 'node:test';
import assert from 'node:assert/strict';
import {searchProject} from '../src/project-search.js';

const FILES=[
  {path:'main.py',text:'import os\nprint("hello")\n# hello again\n'},
  {path:'util.py',text:'def hello():\n    return 1\n'},
  {path:'note.txt',text:'nothing here\n'}
];

test('finds matches across files with 1-based line/column',()=>{
  const r=searchProject(FILES,'hello');
  assert.equal(r.total,3);
  assert.equal(r.results.length,3);
  assert.deepEqual(r.results.map(x=>x.path+':'+x.line),['main.py:2','main.py:3','util.py:1']);
  assert.equal(r.results[0].column,8);
});

test('case-insensitive by default, sensitive when asked',()=>{
  const files=[{path:'a.py',text:'Hello\nhello\n'}];
  assert.equal(searchProject(files,'hello').total,2);
  assert.equal(searchProject(files,'hello',{caseSensitive:true}).total,1);
});

test('empty or whitespace query returns nothing',()=>{
  assert.deepEqual(searchProject(FILES,'').results,[]);
  assert.deepEqual(searchProject(FILES,'   ').results,[]);
  assert.equal(searchProject(FILES,'').total,0);
});

test('no match returns empty',()=>{
  const r=searchProject(FILES,'zzz-not-there');
  assert.equal(r.total,0);
  assert.deepEqual(r.results,[]);
});

test('maxResults caps output and flags truncated',()=>{
  const r=searchProject(FILES,'hello',{maxResults:2});
  assert.equal(r.results.length,2);
  assert.equal(r.total,3);
  assert.equal(r.truncated,true);
});

test('maxPerFile caps per-file hits',()=>{
  const files=[{path:'a.py',text:'x\nx\nx\nx\n'}];
  const r=searchProject(files,'x',{maxPerFile:2});
  assert.equal(r.results.length,2);
  assert.equal(r.total,4);
  assert.equal(r.truncated,true);
});

test('long lines are trimmed to a context snippet',()=>{
  const long='a'.repeat(300)+'needle'+'b'.repeat(300);
  const r=searchProject([{path:'a.py',text:long}],'needle');
  assert.equal(r.results.length,1);
  assert.ok(r.results[0].text.length<=160);
  assert.ok(r.results[0].text.includes('needle'));
});

test('skips malformed file entries safely',()=>{
  const r=searchProject([null,{path:'a'},{text:'x'},{path:'ok.py',text:'hit'}],'hit');
  assert.equal(r.total,1);
  assert.equal(r.results[0].path,'ok.py');
});