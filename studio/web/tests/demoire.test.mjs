import test from 'node:test';
import assert from 'node:assert/strict';
import { demoireSanitize, moireBlockStats, moireBlockFlags, demoireImageData } from '../src/demoire.js';

function makeImage(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = pixel(x, y), i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
const copy = img => Buffer.from(img.data.buffer.slice(0));
const stripe = (x) => (x % 4 < 2) ? [255, 128, 60] : [60, 128, 255];
const textEdge = (x) => (x % 16 < 8) ? [0, 0, 0] : [255, 255, 255];
const flat = () => [128, 128, 128];

test('settings are bounded and default to a gentle setting', () => {
  const d = demoireSanitize(null);
  assert.equal(d.enabled, true);
  assert.equal(d.strength, 0.6);
  assert.equal(demoireSanitize({ strength: 9 }).strength, 1);
  assert.equal(demoireSanitize({ strength: -3 }).strength, 0);
  assert.equal(demoireSanitize({ enabled: false }).enabled, false);
});

test('color stripes have a much higher chroma than luma signature', () => {
  const img = makeImage(48, 24, stripe);
  const s = moireBlockStats(img.data, img.width, img.height, 0, 0, 12);
  assert.ok(s.chroma > 100, 'strong color ripple detected');
  assert.ok(s.chroma > s.luma * 3, 'moire is chroma-dominant');
  const edge = makeImage(48, 24, textEdge);
  const e = moireBlockStats(edge.data, edge.width, edge.height, 0, 0, 12);
  assert.equal(e.chroma, 0, 'black text edges have no chroma ripple');
});

test('the threshold stays capped even when the whole image is striped', () => {
  const img = makeImage(48, 24, stripe);
  const { flags, threshold } = moireBlockFlags(img.data, img.width, img.height);
  assert.ok(threshold <= 14);
  assert.ok(flags.some(Boolean), 'a fully striped image must still be detected');
  const clean = makeImage(48, 24, flat);
  assert.equal(moireBlockFlags(clean.data, clean.width, clean.height).flags.some(Boolean), false);
});

test('processing collapses the color ripple', () => {
  const img = makeImage(48, 24, stripe);
  const before = moireBlockStats(img.data, img.width, img.height, 0, 0, 12).chroma;
  const result = demoireImageData(img, 0.8);
  assert.equal(result.changed, true);
  assert.ok(result.blocks > 0);
  const after = moireBlockStats(img.data, img.width, img.height, 0, 0, 12).chroma;
  assert.ok(after < before * 0.4, 'chroma ripple must drop sharply: ' + before + ' -> ' + after);
});

test('black-and-white text edges and clean images are left byte-identical', () => {
  for (const pixel of [textEdge, flat]) {
    const img = makeImage(48, 24, pixel);
    const before = copy(img);
    const result = demoireImageData(img, 1);
    assert.equal(result.changed, false);
    assert.ok(copy(img).equals(before), 'no block should be touched');
  }
});

test('strength 0 is a strict no-op', () => {
  const img = makeImage(48, 24, stripe);
  const before = copy(img);
  assert.deepEqual(demoireImageData(img, 0), { changed: false, blocks: 0 });
  assert.ok(copy(img).equals(before));
});

 test('horizontal and diagonal colour bands are detected and reduced', () => {
  for (const pixel of [(x,y)=>stripe(y), (x,y)=>stripe(x+y)]) {
    const img=makeImage(48,48,pixel); const before=moireBlockStats(img.data,48,48,0,0,12).chroma;
    assert.equal(demoireImageData(img,.8).changed,true);
    assert.ok(moireBlockStats(img.data,48,48,0,0,12).chroma < before*.5);
  }
});
