import test from 'node:test';
import assert from 'node:assert/strict';
import { beginAudio, initMediaStore, mediaMessage } from '../src/media-store.js';

const FILE = 'lecture-media/record.webm';

const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(t) {
  const sent = [];
  initMediaStore({ native: () => true, send: (type, payload) => sent.push({ type, payload }) });
  t.after(() => {
    initMediaStore(null);
    t.mock.timers.reset();
  });
  return sent;
}

function sentOf(sent, type) {
  return sent.find(item => item.type === type);
}

async function until(find, label) {
  for (let i = 0; i < 50; i++) {
    const value = find();
    if (value) return value;
    await flush();
  }
  throw new Error('等待 ' + label + ' 超时');
}

async function begin(sent) {
  const message = await until(() => sentOf(sent, 'audioBegin'), 'audioBegin');
  assert.match(message.payload.id, /^au\d+-\d+$/);
  assert.equal(message.payload.name, 'record.webm');
  assert.equal(message.payload.mime, 'audio/webm');
  assert.equal(mediaMessage({ type: 'audioStarted', id: message.payload.id, ok: true, ref: FILE }), true);
  return message.payload.id;
}

async function end(sink, sent) {
  const done = sink.end();
  const message = await until(() => sentOf(sent, 'audioEnd'), 'audioEnd');
  return { done, message };
}

test('begin/chunk/end 使用配套 ID，audioSaved 按 endId 回执并返回 ref/bytes', async (t) => {
  const sent = setup(t);
  const sink = beginAudio('record', 'audio/webm');
  assert.equal(sink.ref, FILE);

  const id = await begin(sent);

  await sink.chunk(new Blob([new Uint8Array([1, 2, 3])]));
  const chunk = sentOf(sent, 'audioChunk');
  assert.equal(chunk.payload.id, id, 'chunk 必须沿用 audioBegin 的 id');
  assert.equal(chunk.payload.data, Buffer.from([1, 2, 3]).toString('base64'));

  const { done, message } = await end(sink, sent);
  assert.equal(message.payload.id, id + '-end', '回执用 endId');
  assert.equal(message.payload.sinkId, id, '关流用 audioBegin 的 id');

  /* 错误的 id 不能提前 resolve，只有 endId 的回执算数。 */
  mediaMessage({ type: 'audioSaved', id, ok: true, ref: 'lecture-media/wrong.webm', bytes: 99 });
  mediaMessage({ type: 'audioSaved', id: message.payload.id, ok: true, ref: FILE, bytes: 3 });

  assert.deepEqual(await done, { ref: FILE, bytes: 3 });
});

test('audioSaved 失败回执 reject，不会被当成成功 resolve', async (t) => {
  const sent = setup(t);
  const sink = beginAudio('record', 'audio/webm');
  const id = await begin(sent);
  const { done, message } = await end(sink, sent);

  const outcome = done.then(value => ({ value }), error => ({ error }));
  mediaMessage({ type: 'audioSaved', id: message.payload.id, ok: false, message: '录音没有产生数据' });

  const result = await outcome;
  assert.equal(result.value, undefined, '失败不能 resolve 出 ref');
  assert.match(result.error.message, /录音没有产生数据/);
  assert.equal(message.payload.sinkId, id);
});

test('缺少 audioSaved 回执时按超时 reject，不会被错误 resolve', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = setup(t);
  const sink = beginAudio('record', 'audio/webm');
  const id = await begin(sent);
  const { done, message } = await end(sink, sent);

  assert.equal(message.payload.id, id + '-end');
  assert.equal(message.payload.sinkId, id);

  const outcome = done.then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(30000);

  const result = await outcome;
  assert.equal(result.value, undefined, '超时不能 resolve 出 ref');
  assert.match(result.error.message, /录音落盘超时/);
});
