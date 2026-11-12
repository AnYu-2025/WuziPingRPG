import test from 'node:test';
import assert from 'node:assert/strict';
import {SNIPPETS,snippetsFor,snippetById} from '../src/snippets.js';

test('every snippet has required fields and non-empty code',()=>{
  const ids=new Set();
  for(const s of SNIPPETS){
    assert.ok(s.id&&!ids.has(s.id),'duplicate id '+s.id);
    ids.add(s.id);
    assert.ok(s.title&&s.title.length>0,s.id);
    assert.ok(typeof s.desc==='string',s.id);
    assert.ok(Array.isArray(s.langs)&&s.langs.length>0,s.id);
    assert.ok(typeof s.code==='string'&&s.code.trim().length>0,s.id);
    for(const l of s.langs)assert.equal(l,l.toLowerCase(),s.id);
  }
});

test('snippetsFor filters by extension',()=>{
  const py=snippetsFor('py');
  assert.ok(py.length>0);
  assert.ok(py.every(s=>s.langs.includes('py')));
  const cpp=snippetsFor('cpp');
  assert.ok(cpp.some(s=>s.id==='cpp-main'));
  assert.ok(!cpp.some(s=>s.id==='py-main'));
});

test('snippetsFor is case-insensitive and handles unknown/empty',()=>{
  assert.deepEqual(snippetsFor('PY'),snippetsFor('py'));
  assert.deepEqual(snippetsFor('xyz'),[]);
  assert.deepEqual(snippetsFor(''),[]);
  assert.deepEqual(snippetsFor(null),[]);
});

test('C snippets appear for .c but C++-only ones do not',()=>{
  const c=snippetsFor('c');
  assert.ok(c.some(s=>s.id==='c-main'));
  assert.ok(c.some(s=>s.id==='cpp-main'));
  assert.ok(!c.some(s=>s.id==='cpp-vector'));
});

test('snippetById finds and misses safely',()=>{
  assert.equal(snippetById('py-main').id,'py-main');
  assert.equal(snippetById('nope'),null);
});