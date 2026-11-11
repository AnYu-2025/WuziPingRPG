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

test('audioStarted 失败后不再写分片，end() 立刻抛原生错误', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = setup(t);
  const sink = beginAudio('record', 'audio/webm');
  const message = await until(() => sentOf(sent, 'audioBegin'), 'audioBegin');

  assert.equal(mediaMessage({ type: 'audioStarted', id: message.payload.id, ok: false, message: '磁盘已满' }), true);
  await flush();   // 等创建失败记进 failure

  await sink.chunk(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(sentOf(sent, 'audioChunk'), undefined, '文件没建起来不能再发 audioChunk');

  const outcome = sink.end().then(value => ({ value }), error => ({ error }));
  await flush();
  assert.equal(sentOf(sent, 'audioEnd'), undefined, '创建失败后不该再关流');

  const result = await outcome;   // 不 tick 30s 也要有结果
  assert.equal(result.value, undefined, '创建失败不能 resolve 出 ref');
  assert.match(result.error.message, /磁盘已满/);
});

test('abort() 在创建回执前放弃时清掉创建定时器', async (t) => {
  const sent = setup(t);
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const sink = beginAudio('record', 'audio/webm');
  const message = await until(() => sentOf(sent, 'audioBegin'), 'audioBegin');

  const before = cleared.mock.callCount();
  sink.abort();
  assert.equal(cleared.mock.callCount(), before + 1, '创建定时器不能留在事件循环里');
  assert.equal(sentOf(sent, 'audioAbort').payload.id, message.payload.id);
});

test('abort() 放弃后不再写分片，未完成的 end() 立刻失败', async (t) => {
  const sent = setup(t);
  const early = beginAudio('early', 'audio/webm');
  await until(() => sentOf(sent, 'audioBegin'), 'audioBegin');
  early.abort();
  await early.chunk(new Blob([new Uint8Array([1])]));
  assert.equal(sentOf(sent, 'audioChunk'), undefined, '放弃之后不能再发 audioChunk');
  const earlyEnd = early.end().then(value => ({ value }), error => ({ error }));
  await flush();
  const earlyResult = await earlyEnd;
  assert.equal(earlyResult.value, undefined);
  assert.match(earlyResult.error.message, /录音已放弃/);
  assert.equal(sentOf(sent, 'audioEnd'), undefined, '已经放弃的录音不该再关流');

  const sink = beginAudio('later', 'audio/webm');
  const started = await until(() => sent.find(item => item.type === 'audioBegin' && item.payload.name === 'later.webm'), 'later audioBegin');
  assert.equal(mediaMessage({ type: 'audioStarted', id: started.payload.id, ok: true, ref: 'lecture-media/later.webm' }), true);
  const outcome = sink.end().then(value => ({ value }), error => ({ error }));
  await until(() => sent.find(item => item.type === 'audioEnd' && item.payload.sinkId === started.payload.id), 'later audioEnd');
  sink.abort();
  const result = await outcome;
  assert.equal(result.value, undefined, '放弃不能把未完成的 end() 留在 30 秒超时上');
  assert.match(result.error.message, /录音已放弃/);
});

test('abort() 在关流回执前放弃时清掉 audioEnd 定时器', async (t) => {
  const sent = setup(t);
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const sink = beginAudio('record', 'audio/webm');
  const id = await begin(sent);
  const { done } = await end(sink, sent);
  done.catch(() => {});   // abort 之后不会再有回执

  const before = cleared.mock.callCount();
  sink.abort();
  assert.equal(cleared.mock.callCount(), before + 1, 'audioEnd 的超时定时器要被清掉');
  assert.equal(sentOf(sent, 'audioAbort').payload.id, id);
});
