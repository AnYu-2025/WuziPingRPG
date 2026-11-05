import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, normalizeView, screenToWorld, zoomView, normalizeStrokes } from '../src/draw.js';

test('zoom is bounded between 0.5x and 8x', () => {
  assert.equal(clampScale(0.1), 0.5);
  assert.equal(clampScale(99), 8);
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(2.5), 2.5);
});

test('invalid or missing view state falls back to 1x with no offset', () => {
  assert.deepEqual(normalizeView(null), { scale: 1, offsetX: 0, offsetY: 0 });
  assert.deepEqual(normalizeView({ scale: 4, offsetX: NaN, offsetY: '12' }),
    { scale: 4, offsetX: 0, offsetY: 12 });
});

test('screen coordinates convert back to logical stroke coordinates', () => {
  const view = { scale: 2, offsetX: 30, offsetY: -12 };
  assert.deepEqual(screenToWorld(view, 130, 88), { x: 50, y: 50 });
  const view2 = { scale: 0.5, offsetX: 10, offsetY: 10 };
  assert.deepEqual(screenToWorld(view2, 35, 35), { x: 50, y: 50 });
});

test('zooming keeps the point under the anchor fixed', () => {
  const view = { scale: 1, offsetX: 0, offsetY: 0 };
  for (const factor of [1.25, 0.8, 3, 0.2]) {
    const anchor = { x: 180, y: 240 };
    const before = screenToWorld(view, anchor.x, anchor.y);
    const next = zoomView(view, factor, anchor.x, anchor.y);
    const after = screenToWorld(next, anchor.x, anchor.y);
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
  }
  assert.equal(zoomView(view, 20, 0, 0).scale, 8);
  assert.equal(zoomView(view, 0.01, 0, 0).scale, 0.5);
});

test('pinch-style transformation preserves the world point under the gesture centre', () => {
  const start = { scale: 2, offsetX: -40, offsetY: 25 };
  const centre = { x: 200, y: 150 };
  const world = screenToWorld(start, centre.x, centre.y);
  const scale = clampScale(start.scale * 1.6);
  const moved = { scale, offsetX: 210 - world.x * scale, offsetY: 145 - world.y * scale };
  assert.ok(Math.abs(screenToWorld(moved, 210, 145).x - world.x) < 1e-9);
  assert.ok(Math.abs(screenToWorld(moved, 210, 145).y - world.y) < 1e-9);
});

test('existing stroke data survives normalization unchanged at 1x', () => {
  const raw = [
    { tool: 'pen', color: '#dc2626', size: 3, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
    { tool: 'eraser', points: [{ x: 1, y: 2 }, { x: NaN, y: 3 }, null] },
    { tool: 'pen', points: [] },
    'broken'
  ];
  const strokes = normalizeStrokes(raw);
  assert.equal(strokes.length, 2);
  assert.deepEqual(strokes[0].points, [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  assert.equal(strokes[1].tool, 'eraser');
  assert.deepEqual(strokes[1].points, [{ x: 1, y: 2 }]);
});
