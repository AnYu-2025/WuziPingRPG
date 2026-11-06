import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStream, AudioEngine, fmt } from '../src/audio-engine.js';

const originalNavigator = globalThis.navigator;
const originalRecorder = globalThis.MediaRecorder;
const originalContext = globalThis.AudioContext;

function setNavigator(impl, legacy) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: impl }, ...(legacy ? { getUserMedia: legacy } : {}) },
    configurable: true, writable: true
  });
}
function restore() {
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
  if (originalRecorder === undefined) delete globalThis.MediaRecorder; else globalThis.MediaRecorder = originalRecorder;
  if (originalContext === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = originalContext;
}
function domError(name, message) {
  return Object.assign(new Error(message), { name });
}
const isAdvanced = c => c && c.audio && typeof c.audio === 'object';

test('NotReadableError on advanced constraints falls back to plain audio:true', async () => {
  const calls = [];
  const stream = { getTracks: () => [] };
  setNavigator(async c => {
    calls.push(c);
    if (isAdvanced(c)) throw domError('NotReadableError', 'track start failed');
    return stream;
  });
  try {
    assert.equal(await requestStream(), stream);
    assert.equal(calls.length, 2, 'a second, simpler attempt must happen');
    assert.deepEqual(calls[1], { audio: true });
  } finally { restore(); }
});

test('permission denial is final and never retries', async () => {
  let calls = 0;
  setNavigator(async () => { calls++; throw domError('NotAllowedError', 'denied'); });
  try {
    await assert.rejects(requestStream(), e => e.name === 'NotAllowedError' && e.fallbackAttempted === false);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('two failed attempts are reported as a fully attempted fallback', async () => {
  let calls = 0;
  setNavigator(async () => { calls++; throw domError('NotReadableError', 'busy'); });
  try {
    await assert.rejects(requestStream(), e => e.name === 'NotReadableError' && e.fallbackAttempted === true);
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('a failed start releases the microphone track so retry can succeed', async () => {
  let stopped = 0;
  const track = { stop() { stopped++; } };
  const stream = { getTracks: () => [track] };
  setNavigator(async () => stream);
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { throw new Error('MediaRecorder unavailable'); }
  };
  globalThis.AudioContext = class { constructor() { throw new Error('no AudioContext'); } };
  try {
    const engine = new AudioEngine();
    await assert.rejects(() => engine.start());
    assert.equal(stopped, 1, 'microphone track must be stopped on failure');
    assert.equal(engine.state, 'idle');
    assert.equal(engine.stream, null);
    assert.equal(engine.recorder, null);
  } finally { restore(); }
});

test('fmt keeps mm:ss and hh:mm:ss', () => {
  assert.equal(fmt(0), '00:00');
  assert.equal(fmt(65), '01:05');
  assert.equal(fmt(3661), '01:01:01');
});
