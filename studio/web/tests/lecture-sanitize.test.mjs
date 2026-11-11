import test from 'node:test';
import assert from 'node:assert/strict';
import { lectureSanitize, parseTime } from '../src/lecture.js';

/* storeSlideImage 产出的对象形状（DOM-free 复刻）：尺寸必须能原样穿过保存/恢复边界。 */
const storedSlide = dims => ({
  id: 's1',
  name: 'photo',
  ref: 'lecture-media/slide-1.jpg',
  ...dims,
  anchorTime: null,
  createdAt: 1700000000000
});

test('slide dimensions survive the save/restore round-trip', () => {
  const clean = lectureSanitize({ slides: [storedSlide({ width: 1024, height: 1365 })] });
  assert.equal(clean.slides.length, 1);
  const slide = clean.slides[0];
  assert.equal(slide.width, 1024);
  assert.equal(slide.height, 1365);
  assert.equal(slide.id, 's1');
  assert.equal(slide.name, 'photo');
  assert.equal(slide.ref, 'lecture-media/slide-1.jpg');
});

test('legacy snapshots stored with w/h keys recover their real sizes', () => {
  const clean = lectureSanitize({ slides: [storedSlide({ w: 1024, h: 1365 })] });
  assert.equal(clean.slides.length, 1);
  assert.equal(clean.slides[0].width, 1024);
  assert.equal(clean.slides[0].height, 1365);
});

test('slides without any dimensions fall back to the sanitize defaults', () => {
  const clean = lectureSanitize({ slides: [storedSlide({})] });
  assert.equal(clean.slides[0].width, 1024);
  assert.equal(clean.slides[0].height, 768);
});

test('parseTime parses mm:ss, h:mm:ss and plain seconds', () => {
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('1:2:3'), 3723);
  assert.equal(parseTime('12.5'), 12.5);
});

test('parseTime rejects negative and invalid input instead of storing it', () => {
  assert.equal(parseTime('-5'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:xx'), null);
});

test('parseTime rejects a negative field even when the weighted total is positive', () => {
  // 1*-60 + -2 === 58 with the old reducer, which sanitize would then keep.
  assert.equal(parseTime('1:-2'), null);
  assert.equal(parseTime('-1:00'), null);
  assert.equal(parseTime('1:2:-3'), null);
  assert.equal(parseTime('0'), 0);
  assert.equal(parseTime('00:00'), 0);
});

test('parseTime rejects non-finite totals from an overlong plain number', () => {
  assert.equal(parseTime('9'.repeat(400)), null);
  assert.equal(Number('9'.repeat(400)), Infinity);
});
