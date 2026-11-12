import test from 'node:test';
import assert from 'node:assert/strict';
import {parseErrorLocation,firstErrorLocation,splitLocations} from '../src/error-loc.js';

test('clang file:line:col is parsed',()=>{
  const loc=parseErrorLocation('main.cpp:12:5: error: use of undeclared identifier');
  assert.deepEqual(loc,{path:'main.cpp',line:12,column:5});
});

test('clang subdirectory path is kept relative',()=>{
  const loc=parseErrorLocation('src/util.cpp:3:87: warning: missing terminating');
  assert.deepEqual(loc,{path:'src/util.cpp',line:3,column:87});
});

test('Python File "path", line N is parsed',()=>{
  assert.deepEqual(parseErrorLocation('  File "main.py", line 12, in <module>'),{path:'main.py',line:12,column:1});
  assert.deepEqual(parseErrorLocation('File "/workspace/sub/x.py", line 3'),{path:'sub/x.py',line:3,column:1});
});

test('Node at path:line:col is parsed',()=>{
  assert.deepEqual(parseErrorLocation('    at /workspace/app.js:12:5'),{path:'app.js',line:12,column:5});
  assert.deepEqual(parseErrorLocation('app.js:7'),{path:'app.js',line:7,column:1});
});

test('system paths, URLs and pseudo-files are not linkable',()=>{
  assert.equal(parseErrorLocation('/usr/include/stdio.h:40:1: error: boom'),null);
  assert.equal(parseErrorLocation('C:\\x\\main.cpp:1:1: error: boom'),null);
  assert.equal(parseErrorLocation('https://a.com/main.cpp:1:1'),null);
  assert.equal(parseErrorLocation('File "<stdin>", line 1'),null);
  assert.equal(parseErrorLocation('a very ordinary line of program output 12:30'),null);
  assert.equal(parseErrorLocation(''),null);
  assert.equal(parseErrorLocation(null),null);
});

test('firstErrorLocation prefers an error line over notes',()=>{
  const text=[
    'main.cpp:1:1: note: something',
    'main.cpp:9:3: error: expected ;',
    'main.cpp:1:1: note: another'
  ].join('\n');
  assert.deepEqual(firstErrorLocation(text),{path:'main.cpp',line:9,column:3});
});

test('firstErrorLocation falls back to first linkable line',()=>{
  const text='helper.cpp:2:2: warning: unused\nmore output';
  assert.deepEqual(firstErrorLocation(text),{path:'helper.cpp',line:2,column:2});
  assert.equal(firstErrorLocation('no locations here'),null);
});

test('splitLocations keeps text intact and marks linkable lines',()=>{
  const text='line one\n  File "main.py", line 5, in <module>\nline three';
  const parts=splitLocations(text);
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.equal(parts.length,3);
  assert.equal(parts[0].loc,null);
  assert.deepEqual(parts[1].loc,{path:'main.py',line:5,column:1});
  assert.equal(parts[2].loc,null);
  assert.deepEqual(splitLocations(''),[]);
});