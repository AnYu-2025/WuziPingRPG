import test from 'node:test';
import assert from 'node:assert/strict';
import { slideScale } from '../src/lecture.js';

test('portrait photos scale by the longest side, not the width', () => {
  assert.deepEqual(slideScale(3000, 4000), { width: 768, height: 1024 });
});

test('landscape slides keep the documented 1024px width', () => {
  assert.deepEqual(slideScale(4000, 3000), { width: 1024, height: 768 });
});

test('square images cap both sides at 1024', () => {
  assert.deepEqual(slideScale(3000, 3000), { width: 1024, height: 1024 });
});

test('already-small images are never upscaled', () => {
  assert.deepEqual(slideScale(800, 600), { width: 800, height: 600 });
  assert.deepEqual(slideScale(1024, 1024), { width: 1024, height: 1024 });
});

test('a custom max applies to the longest side', () => {
  assert.deepEqual(slideScale(3000, 4000, 512), { width: 384, height: 512 });
  assert.deepEqual(slideScale(4000, 3000, 512), { width: 512, height: 384 });
});

test('missing or invalid dimensions fall back to the old defaults', () => {
  assert.deepEqual(slideScale(0, 0), { width: 1024, height: 768 });
  assert.deepEqual(slideScale(undefined, undefined), { width: 1024, height: 768 });
  assert.deepEqual(slideScale(NaN, Infinity), { width: 1024, height: 768 });
  assert.deepEqual(slideScale(-3000, -4000), { width: 1024, height: 768 });
});

test('extreme aspect ratios still produce positive integer sizes', () => {
  assert.deepEqual(slideScale(1, 20000), { width: 1, height: 1024 });
  assert.deepEqual(slideScale(20000, 1), { width: 1024, height: 1 });
});

test('the longest side never exceeds the cap for mixed orientations', () => {
  for (const [w, h] of [[3000, 4000], [4000, 3000], [3000, 3000], [5000, 100], [100, 5000], [1025, 1], [1, 1025]]) {
    const size = slideScale(w, h);
    assert.ok(Math.max(size.width, size.height) <= 1024, w + 'x' + h + ' -> ' + size.width + 'x' + size.height);
    assert.ok(Number.isInteger(size.width) && size.width >= 1);
    assert.ok(Number.isInteger(size.height) && size.height >= 1);
  }
});
