import assert from 'node:assert/strict';
import test from 'node:test';
import {codeDeskFiles, codeFileStatus, createDeskDraft, cppRunScope} from '../src/desk-code.js';

const sample = {path: 'main.py', text: 'print(1)', savedText: 'print(1)', uri: ''};
const helper = {path: 'lesson/MATH.CPP', text: '', uri: ''};

test('unmodified starter and classroom notes do not become a personal recent file', () => {
  const state = {active: sample.path, files: [sample, {path:'课堂笔记.md', text:'text'}, {path:'English.txt', text:'text'}]};
  const desk = codeDeskFiles(state, [sample]);
  assert.deepEqual(desk.personal, []);
  assert.equal(desk.recent, undefined);
  assert.deepEqual(desk.examples.map(entry => entry.file), [sample]);
  assert.equal(codeDeskFiles(state, [sample], sample.path).recent.file, sample);
});

test('an imported or edited file with a starter name stays personal', () => {
  for (const file of [{...sample, uri:'content://provider/main'}, {...sample, text:'print(2)'}]) {
    const desk = codeDeskFiles({active:'课堂笔记.md', files:[file, helper]}, [sample], helper.path);
    assert.equal(desk.examples.length, 0);
    assert.equal(desk.recent.language, 'C++');
    assert.deepEqual(desk.personal.map(entry => entry.file), [file, helper]);
  }
});

test('drafts, browser copies and phone files have distinct save states', () => {
  assert.equal(codeFileStatus(sample), '本地草稿');
  assert.equal(codeFileStatus({...sample, uri:'browser:main.py'}), '导入副本');
  assert.equal(codeFileStatus({...sample, uri:'content://x', text:'edited'}), '已关联原文件 · 待写回');
  assert.equal(codeFileStatus({...sample, uri:'content://x'}), '已关联原文件');
});

test('new drafts allocate an empty directory and produce a runnable entry per language', () => {
  const files = [{path:'project-1/data.json'}, {path:'project-2'}, {path:'project-4/main.cpp'}];
  const expected = {cpp:'int main()', js:'console.log(', py:'print('};
  for (const [ext, code] of Object.entries(expected)) {
    const draft = createDeskDraft(files, ext);
    assert.equal(draft.path, 'project-3/main.' + ext);
    assert.equal(draft.deskProject, 'project-3');
    assert.ok(draft.text.includes(code));
    assert.equal(createDeskDraft([...files, draft], ext).deskProject, 'project-5');
  }
  assert.throws(() => createDeskDraft(files, '__proto__'));
});

test('only marked project directories bound C++ runs; source, headers and data travel together', () => {
  const legacy = [{path:'main.cpp'}, {path:'project-1/support.cc'}, {path:'lib/common.h'}, {path:'lib/data.json'}];
  const first = createDeskDraft(legacy, 'cpp');
  const firstFiles = [first, ...['helper.cpp','include/math.h','data.csv'].map(name=>({path:first.deskProject+'/'+name}))];
  const second = createDeskDraft([...legacy, ...firstFiles], 'cpp');
  const files = JSON.parse(JSON.stringify([...legacy, ...firstFiles, second]));
  for (const path of [first.path, firstFiles[1].path]) assert.deepEqual(cppRunScope(files,path), {root:first.deskProject,files:firstFiles});
  assert.deepEqual(cppRunScope(files,second.path), {root:second.deskProject,files:[second]});
  assert.deepEqual(cppRunScope(files,'project-1/support.cc'), {root:'',files:legacy});
  assert.deepEqual(cppRunScope(files,'main.cpp'), {root:'',files:legacy});
});
