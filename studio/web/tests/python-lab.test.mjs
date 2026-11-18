import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {PYTHON_LABS, normalizeLabProgress} from '../src/python-lab.js';

test('the three experiments run offline with their stated results and editable inputs', async () => {
  const base = fileURLToPath(new URL('../../src/main/assets/studio/runtime/', import.meta.url));
  const {loadPyodide} = createRequire(import.meta.url)(join(base, 'pyodide.js'));
  const python = await loadPyodide({indexURL: base});
  const changes = {
    'paper-folds': ['folds = 5', 'folds = 7', '128'],
    'dry-spell': ['0, 0, 2,', '0, 0, 0,', '6'],
    'hall-lights': ['count = 6', 'count = 10', '1 4 9']
  };
  assert.deepEqual(PYTHON_LABS.map(lab => lab.id).sort(), Object.keys(changes).sort());
  for (const lab of PYTHON_LABS) {
    for (const field of ['title', 'prompt', 'explanation', 'challenge']) assert(lab[field]?.trim());
    const [before, after, expected] = changes[lab.id];
    for (const [program, result] of [[lab.starter, lab.expectedOutput], [lab.starter.replace(before, after), expected]]) {
      const output = [];
      python.setStdout({batched: line => output.push(line)});
      await python.runPythonAsync(program);
      assert.equal(output.join('\n'), result, lab.title);
    }
  }
});

test('workspaces from before labs and unknown entries do not start experiments', () => {
  for (const raw of [undefined, null, [], 'bad', {}, {removed: {hasRun: true}}, {'paper-folds': []}]) {
    assert.deepEqual(normalizeLabProgress(raw), {});
  }
  assert.deepEqual(normalizeLabProgress(Object.create({'dry-spell': {path:'fake.py'}})), {});
});

test('normalizing preserves predictions, real output and source across save/restore', () => {
  const progress = normalizeLabProgress({
    'paper-folds': {path: '实验/我的折纸.PY', prediction: '16\n或 32'},
    'hall-lights': {path:'亮灯.py', hasRun:true, output:'1 4 9\n', runSource:'count = 10\nprint(1, 4, 9)\n'}
  });
  assert.deepEqual(progress['paper-folds'], {
    path: '实验/我的折纸.PY', prediction: '16\n或 32', hasRun:false, output:'', runSource:''
  });
  assert.deepEqual(progress['hall-lights'], {
    path:'亮灯.py', prediction:'', hasRun:true, output:'1 4 9\n', runSource:'count = 10\nprint(1, 4, 9)\n'
  });
  assert.deepEqual(normalizeLabProgress(JSON.parse(JSON.stringify(progress))), progress);
});

test('invalid paths and damaged fields do not bind external files or invent completed runs', () => {
  for (const path of ['../test.py', 'a/../b.py', 'bad//file', '/abs.py', 'C:\\abs.py', 'a'.repeat(201)]) {
    assert.deepEqual(normalizeLabProgress({'dry-spell': {path}}), {});
  }
  const partial = normalizeLabProgress({'dry-spell': {
    path:'../bad.py', prediction:'?'.repeat(700), hasRun:'yes', output:'stale', runSource:'stale'
  }})['dry-spell'];
  assert.deepEqual(partial, {path:'', prediction:'?'.repeat(500), hasRun:false, output:'', runSource:''});
  const run = normalizeLabProgress({'dry-spell': {
    hasRun:true, output:'x'.repeat(3000), runSource:'s'.repeat(2 * 1024 * 1024 + 1)
  }})['dry-spell'];
  assert.equal(run.output.length, 2048);
  assert.equal(run.runSource.length, 2 * 1024 * 1024);
});
