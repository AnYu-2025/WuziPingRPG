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
    await assert.rejects(requestStream(), e => e.name === 'NotAllowedError');
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('persistent NotReadableError exhausts every retry round', async () => {
  let calls = 0;
  setNavigator(async () => { calls++; throw domError('NotReadableError', 'busy'); });
  try {
    await assert.rejects(requestStream(), e => e.name === 'NotReadableError');
    /* 三轮退避 × 两档约束（带降噪 / audio:true）：WebView 释放音频服务的瞬时失败靠它兜住 */
    assert.equal(calls, 6);
  } finally { restore(); }
});

test('a transient NotReadableError recovers on a later round', async () => {
  let calls = 0;
  const stream = { getTracks: () => [] };
  setNavigator(async c => {
    calls++;
    if (calls <= 2) throw domError('NotReadableError', 'busy');
    return stream;
  });
  try {
    assert.equal(await requestStream(), stream);
    assert.equal(calls, 3);
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

test('recorder chunks stream into the native sink in order', async () => {
  const savedWindow = globalThis.window;
  globalThis.window = globalThis;
  const stream = { getTracks: () => [], getAudioTracks: () => [] };
  setNavigator(async () => stream);
  let recorder = null;
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) setTimeout(() => this.onstop(), 0); }
  };
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, getByteTimeDomainData() {} }; }
    close() { this.state = 'closed'; }
  };
  try {
    const engine = new AudioEngine();
    await engine.start();
    /* 第一片可能比 sink 先到（start() 之后才接线）：接上时按顺序补写。 */
    recorder.ondataavailable({ data: new Blob([new Uint8Array(10)]) });
    const seen = [];
    engine.attachSink({ chunk: blob => seen.push(blob.size) });
    recorder.ondataavailable({ data: new Blob([new Uint8Array(20)]) });
    const result = await engine.stop();
    assert.deepEqual(seen, [10, 20], 'every slice reaches the sink in order');
    assert.equal(result.streamed, true);
    assert.equal(result.bytes, 30);
    assert.ok(result.blob && result.blob.size === 30, 'blob stays available as a fallback');
    assert.equal(engine.progress().bytes, 30);
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    restore();
  }
});

test('fmt keeps mm:ss and hh:mm:ss', () => {
  assert.equal(fmt(0), '00:00');
  assert.equal(fmt(65), '01:05');
  assert.equal(fmt(3661), '01:01:01');
});
