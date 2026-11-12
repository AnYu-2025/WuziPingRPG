/* lectureSanitize 是课堂数据（音频/锚点/PPT/笔记）的持久化边界：
   这里只测纯函数，不碰 DOM，保证脏快照恢复时不会带进非法引用或越界数值。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lectureSanitize } from '../src/lecture.js';

const DATA_PREFIX = 'data:image/jpeg;base64,';
const SLIDE_DATA_CAP = 6 * 1024 * 1024;
const EMPTY_SESSION = {
  audio: null,
  anchors: [],
  slides: [],
  notes: [],
  translate: false,
  active: false,
  demoire: { enabled: true, strength: 0.6 },
  rate: 1
};

test('empty or non-object input yields a safe empty session', () => {
  for (const input of [null, undefined, {}, [], 'lecture', 42]) {
    assert.deepEqual(lectureSanitize(input), EMPTY_SESSION);
  }
});

test('media refs accept lecture-media paths and short data URLs only', () => {
  const cases = [
    ['lecture-media/foo.jpg', true],
    [DATA_PREFIX + 'xx', true],
    ['lecture-media/' + 'p'.repeat(186), true],   // exactly 200 chars
    ['https://evil.example/x', false],
    ['other-media/foo.jpg', false],
    ['/lecture-media/foo.jpg', false],
    ['lecture-mediaX/foo.jpg', false],
    ['lecture-media/' + 'p'.repeat(187), false],  // 201 chars
    ['', false]
  ];
  for (const [ref, ok] of cases) {
    const clean = lectureSanitize({ audio: { ref }, slides: [{ ref }] });
    const tag = ref.slice(0, 40);
    assert.equal(clean.audio !== null, ok, 'audio ref: ' + tag);
    assert.equal(clean.slides.length, ok ? 1 : 0, 'slide ref: ' + tag);
    if (ok) {
      assert.equal(clean.audio.ref, ref);
      assert.equal(clean.slides[0].ref, ref);
    }
  }
});

test('slide data URLs are rejected above the 6MB cap', () => {
  const atCap = DATA_PREFIX + 'x'.repeat(SLIDE_DATA_CAP - DATA_PREFIX.length);
  const overCap = atCap + 'x';
  assert.equal(atCap.length, SLIDE_DATA_CAP);
  assert.equal(lectureSanitize({ slides: [{ ref: atCap }] }).slides.length, 1);
  assert.equal(lectureSanitize({ slides: [{ ref: overCap }] }).slides.length, 0);
});

test('audio with an invalid ref or non-object shape becomes null', () => {
  assert.equal(lectureSanitize({ audio: 'lecture-media/rec.webm' }).audio, null);
  assert.equal(lectureSanitize({ audio: { ref: 'https://evil.example/x' } }).audio, null);
});

test('audio normalizes mime, duration, and envelope', () => {
  const clean = lectureSanitize({ audio: {
    ref: 'lecture-media/rec.webm',
    duration: -5,
    envelope: [0, 0.5, 1.23456, -0.1, 2, '0.3', NaN, Infinity]
  } });
  assert.equal(clean.audio.ref, 'lecture-media/rec.webm');
  assert.equal(clean.audio.mime, 'audio/webm');
  assert.equal(clean.audio.duration, 0);
  assert.deepEqual(clean.audio.envelope, [0, 0.5, 1.2346]);
  const bounded = lectureSanitize({ audio: { ref: 'lecture-media/rec.webm', mime: 'm'.repeat(120), duration: 12.34 } });
  assert.equal(bounded.audio.mime, 'm'.repeat(80));
  assert.equal(bounded.audio.duration, 12.3);
});

test('audio envelope is capped at 20000 samples', () => {
  const clean = lectureSanitize({ audio: { ref: 'lecture-media/rec.webm', envelope: Array.from({ length: 20001 }, () => 0.5) } });
  assert.equal(clean.audio.envelope.length, 20000);
});

test('anchors drop negative or non-numeric times and keep zero', () => {
  const bad = [null, undefined, {}, { time: -0.1 }, { time: '3' }, { time: NaN }, { time: Infinity }, { label: 'no time' }];
  const clean = lectureSanitize({ anchors: [...bad, { time: 0 }, ...bad] });
  assert.equal(clean.anchors.length, 1);
  assert.equal(clean.anchors[0].time, 0);
});

test('anchors sort by time and round to one decimal', () => {
  const clean = lectureSanitize({ anchors: [{ time: 5 }, { time: 1.26 }, { time: 3 }] });
  assert.deepEqual(clean.anchors.map(a => a.time), [1.3, 3, 5]);
});

test('anchors are capped at 2000 entries', () => {
  const many = Array.from({ length: 2001 }, (_, i) => ({ time: i }));
  const clean = lectureSanitize({ anchors: many });
  assert.equal(clean.anchors.length, 2000);
  assert.equal(clean.anchors[1999].time, 1999);
});

test('anchor labels slice to 40 chars and types fall back to manual', () => {
  const types = [['speech', 'speech'], ['silence', 'silence'], ['manual', 'manual'], ['auto', 'manual'], [undefined, 'manual'], [42, 'manual']];
  for (const [input, expected] of types) {
    const clean = lectureSanitize({ anchors: [{ time: 1, type: input, label: 'L'.repeat(60), slideId: 's'.repeat(40) }] });
    assert.equal(clean.anchors[0].type, expected);
    assert.equal(clean.anchors[0].label, 'L'.repeat(40));
    assert.equal(clean.anchors[0].slideId, 's'.repeat(32));
  }
  const bare = lectureSanitize({ anchors: [{ time: 1 }] });
  assert.equal(bare.anchors[0].label, '');
  assert.equal(bare.anchors[0].slideId, null);
  assert.equal(bare.anchors[0].id, 'a1');
});

test('slides cap at 50 after invalid refs are dropped', () => {
  const slides = Array.from({ length: 55 }, (_, i) => ({ ref: 'lecture-media/s' + i + '.jpg' }));
  slides.splice(10, 0, { ref: 'https://evil.example/x' }, { ref: '' }, null);
  const clean = lectureSanitize({ slides });
  assert.equal(clean.slides.length, 50);
  assert.equal(clean.slides[0].id, 's1');
  assert.equal(clean.slides[49].id, 's50');
});

test('slides default to 1024x768, clamp bounds, and round anchorTime', () => {
  const clean = lectureSanitize({ slides: [
    { ref: 'lecture-media/a.jpg' },
    { ref: 'lecture-media/b.jpg', width: 9999, height: -3, anchorTime: 7.89, name: 'N'.repeat(80), createdAt: 1701111100000 },
    { ref: 'lecture-media/c.jpg', width: 0, height: 0, anchorTime: 'soon' }
  ] });
  const [a, b, c] = clean.slides;
  assert.equal(a.width, 1024);
  assert.equal(a.height, 768);
  assert.equal(a.name, 'slide_1');
  assert.equal(a.anchorTime, null);
  assert.ok(a.createdAt > 0);
  assert.equal(b.width, 4096);
  assert.equal(b.height, 1);
  assert.equal(b.anchorTime, 7.9);
  assert.equal(b.name, 'N'.repeat(60));
  assert.equal(b.createdAt, 1701111100000);
  assert.equal(c.width, 1024);
  assert.equal(c.height, 768);
  assert.equal(c.anchorTime, null);
});

test('legacy slide data field is accepted as the ref', () => {
  const data = DATA_PREFIX + 'xx';
  const clean = lectureSanitize({ slides: [{ data }] });
  assert.equal(clean.slides.length, 1);
  assert.equal(clean.slides[0].ref, data);
});

test('notes drop negative or non-numeric pos/time and keep zero', () => {
  const bad = [null, {}, { pos: -1, time: 2 }, { pos: 2, time: -1 }, { pos: '2', time: 1 }, { pos: 1, time: '2' }, { pos: NaN, time: 0 }, { pos: 1, time: Infinity }, { time: 1 }];
  const clean = lectureSanitize({ notes: [...bad, { pos: 0, time: 0 }] });
  assert.deepEqual(clean.notes, [{ pos: 0, time: 0 }]);
});

test('notes cap at 5000 and round pos/time', () => {
  const many = Array.from({ length: 5001 }, (_, i) => ({ pos: i + 0.7, time: i + 0.34 }));
  const clean = lectureSanitize({ notes: many });
  assert.equal(clean.notes.length, 5000);
  assert.deepEqual(clean.notes[0], { pos: 1, time: 0.3 });
  assert.deepEqual(clean.notes[4999], { pos: 5000, time: 4999.3 });
});

test('rate keeps whitelisted speeds and falls back to 1', () => {
  const cases = [[1, 1], [1.25, 1.25], [1.5, 1.5], [2, 2], ['1.5', 1.5], [0, 1], [3, 1], ['fast', 1], [undefined, 1], [null, 1], [NaN, 1]];
  for (const [input, expected] of cases) {
    assert.equal(lectureSanitize({ rate: input }).rate, expected);
  }
});

test('demoire passes through demoireSanitize bounds', () => {
  const cases = [
    [null, { enabled: true, strength: 0.6 }],
    [{ enabled: false, strength: 0.9 }, { enabled: false, strength: 0.9 }],
    [{ strength: 5 }, { enabled: true, strength: 1 }],
    [{ strength: -2 }, { enabled: true, strength: 0 }],
    [{ strength: 'abc' }, { enabled: true, strength: 0.6 }],
    [{ enabled: 'no' }, { enabled: true, strength: 0.6 }]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(lectureSanitize({ demoire: input }).demoire, expected);
  }
});

test('translate and active coerce to booleans', () => {
  const clean = lectureSanitize({ translate: 1, active: 'yes' });
  assert.equal(clean.translate, true);
  assert.equal(clean.active, true);
});
