import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineZoomWindow } from '../src/timeline.js';

const mid = win => (win[0] + win[1]) / 2;
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not near ${expected}`);
function assertSaneWindow(win) {
  assert.ok(Number.isFinite(win[0]) && Number.isFinite(win[1]), `window not finite: ${win}`);
  assert.ok(win[0] >= 0 && win[1] <= 1 && win[0] <= win[1], `window outside [0,1]: ${win}`);
}

test('duration 0 with a playhead keeps the zoom window finite and inside [0,1]', () => {
  for (const playhead of [0, 3.7, 42, NaN, Infinity]) {
    const { zoomIdx, win } = timelineZoomWindow({ playhead, duration: 0, win: [0, 1], zoomIdx: 0, dir: 1 });
    assert.equal(zoomIdx, 1);
    assertSaneWindow(win);
    near(mid(win), 0.5);
  }
});

test('repeated zooming on an empty session never corrupts the window', () => {
  let state = { playhead: 0, duration: 0, win: [0, 1], zoomIdx: 0, dir: 1 };
  for (let i = 0; i < 14; i++) {
    const next = timelineZoomWindow(state);
    assertSaneWindow(next.win);
    state = { ...state, win: next.win, zoomIdx: next.zoomIdx };
  }
  assert.equal(state.zoomIdx, 10);
  for (let i = 0; i < 14; i++) {
    const next = timelineZoomWindow({ ...state, dir: -1 });
    assertSaneWindow(next.win);
    state = { ...state, win: next.win, zoomIdx: next.zoomIdx };
  }
  assert.equal(state.zoomIdx, 0);
});

test('duration 10 with playhead 5 zooms around 0.5', () => {
  const { zoomIdx, win } = timelineZoomWindow({ playhead: 5, duration: 10, win: [0, 1], zoomIdx: 0, dir: 1 });
  assert.equal(zoomIdx, 1);
  assertSaneWindow(win);
  near(mid(win), 0.5);
  near(win[1] - win[0], 1 / 1.5);
});

test('null playhead zooms around the current window midpoint', () => {
  const { zoomIdx, win } = timelineZoomWindow({ playhead: null, duration: 10, win: [0.2, 0.6], zoomIdx: 1, dir: 1 });
  assert.equal(zoomIdx, 2);
  assertSaneWindow(win);
  near(mid(win), 0.4);
  near(win[1] - win[0], 0.5);
});

test('non-finite playhead or duration falls back to the window midpoint', () => {
  for (const [playhead, duration] of [[5, NaN], [5, Infinity], [NaN, 10], [Infinity, 10]]) {
    const { win } = timelineZoomWindow({ playhead, duration, win: [0.25, 0.75], zoomIdx: 1, dir: 1 });
    assertSaneWindow(win);
    near(mid(win), 0.5);
  }
});

test('an already-corrupted window falls back to center 0.5 instead of NaN', () => {
  const { win } = timelineZoomWindow({ playhead: null, duration: 0, win: [NaN, NaN], zoomIdx: 0, dir: 1 });
  assertSaneWindow(win);
  near(mid(win), 0.5);
});

test('zooming at a playhead on the edges stays clamped to [0,1]', () => {
  const right = timelineZoomWindow({ playhead: 10, duration: 10, win: [0, 1], zoomIdx: 5, dir: 1 });
  assert.deepEqual(right.win, [0.875, 1]);
  const left = timelineZoomWindow({ playhead: 0, duration: 10, win: [0, 1], zoomIdx: 5, dir: 1 });
  assert.deepEqual(left.win, [0, 0.125]);
});

test('zoom index is bounded at both ends of the zoom ladder', () => {
  const out = timelineZoomWindow({ playhead: null, duration: 10, win: [0, 1], zoomIdx: 0, dir: -1 });
  assert.equal(out.zoomIdx, 0);
  assert.deepEqual(out.win, [0, 1]);
  const maxed = timelineZoomWindow({ playhead: 5, duration: 10, win: [0, 1], zoomIdx: 10, dir: 1 });
  assert.equal(maxed.zoomIdx, 10);
  assertSaneWindow(maxed.win);
  near(maxed.win[1] - maxed.win[0], 1 / 32);
});
