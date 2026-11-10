import test from 'node:test';
import assert from 'node:assert/strict';
import { quizAIAvailability, createQuizRequester } from '../src/quiz.js';

const note = '光合作用需要叶绿体。叶绿体是植物细胞进行光合作用的场所。呼吸作用在线粒体中进行。';
const settings = {
  enabled: true,
  apiKey: 'secret',
  baseUrl: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat'
};
const payload = {
  title: 'AI 练习',
  questions: [
    { type: 'single', question: '场所是？____', options: ['叶绿体', '线粒体', '细胞核', '细胞壁'], answer: 'A', evidence: '叶绿体是植物细胞进行光合作用的场所。' },
    { type: 'blank', question: '呼吸作用在____中进行。', answer: '线粒体', evidence: '呼吸作用在线粒体中进行。' },
    { type: 'short', question: '说明光合作用。', answer: '光合作用需要叶绿体。', evidence: '光合作用需要叶绿体。' }
  ]
};

function recorder() {
  const sent = [];
  const notices = [];
  return {
    sent,
    notices,
    send: (type, data) => sent.push({ type, data }),
    notify: message => notices.push(message)
  };
}

test('AI availability explains browser, disabled, missing key and invalid endpoint', () => {
  assert.equal(quizAIAvailability(settings, { native: false }).reason, 'browser');
  assert.equal(quizAIAvailability({ ...settings, enabled: false }, { native: true }).reason, 'disabled');
  assert.equal(quizAIAvailability({ ...settings, apiKey: '' }, { native: true }).reason, 'key');
  assert.equal(quizAIAvailability({ ...settings, baseUrl: 'javascript:alert(1)' }, { native: true }).reason, 'endpoint');
  const ok = quizAIAvailability(settings, { native: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.endpoint, settings.baseUrl);
  const remote = quizAIAvailability({ ...settings, apiKey: '', remote: true, remoteUrl: 'http://192.168.1.10:8080/v1/chat/completions' }, { native: true });
  assert.equal(remote.ok, true);
});

test('without AI the requester uses offline practice and sends nothing', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: false });
  const request = requester.generate({ noteText: note, settings, count: 5 });
  assert.equal(request.mode, 'offline');
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.source, 'offline');
  assert.equal(result.quiz.questions.length, 5);
  assert.equal(io.sent.length, 0);
  assert.equal(requester.info().busy, false);
});

test('empty notes fail before sending an AI request', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const request = requester.generate({ noteText: '  ', settings, count: 5 });
  assert.equal(request.mode, 'none');
  const result = await request.promise;
  assert.equal(result.ok, false);
  assert.match(result.error, /为空/);
  assert.equal(io.sent.length, 0);
});

test('one-shot AI request is isolated from chat ids and resolves its own chunks', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const request = requester.generate({ noteText: note, settings, count: 5 });
  assert.equal(request.mode, 'ai');
  assert.match(request.id, /^quiz-/);
  assert.equal(io.sent.length, 1);
  const sent = io.sent[0];
  assert.equal(sent.type, 'aiRequest');
  assert.equal(sent.data.id, request.id);
  assert.equal(sent.data.body.stream, false);
  assert.equal(sent.data.body.messages.length, 2);
  assert.equal('tools' in sent.data.body, false);

  assert.equal(requester.receive({ type: 'aiChunk', id: 'ai-chat-1', text: '聊天内容' }), false);
  assert.equal(requester.receive({ type: 'aiDone', id: 'ai-chat-1' }), false);
  assert.equal(requester.receive({ type: 'aiChunk', id: request.id, text: JSON.stringify(payload) }), true);
  assert.equal(requester.receive({ type: 'aiDone', id: request.id }), true);
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ai');
  assert.equal(result.quiz.questions.length, 3);
  assert.equal(requester.info().busy, false);
  assert.equal(requester.receive({ type: 'aiChunk', id: request.id, text: 'late' }), true, 'late chunks are swallowed');
  assert.equal(requester.receive({ type: 'aiChunk', id: 'ai-chat-2', text: 'chat' }), false);
  assert.equal(io.notices.length, 0);
});

test('a large non-stream JSON reply is not cut at the old 20k chunk limit', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const request = requester.generate({ noteText: note, settings, count: 10 });
  const big = {
    title: '大题量',
    questions: Array.from({ length: 10 }, (_, index) => ({
      type: 'blank',
      question: '第 ' + (index + 1) + ' 题 ____' + '详细题干'.repeat(40),
      answer: '答案' + (index + 1),
      evidence: '原文依据'.repeat(600)
    }))
  };
  const text = JSON.stringify(big);
  assert.ok(text.length > 20000);
  assert.equal(requester.receive({ type: 'aiChunk', id: request.id, text }), true);
  assert.equal(requester.receive({ type: 'aiDone', id: request.id }), true);
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ai');
  assert.equal(result.quiz.questions.length, 10);
});

test('malformed AI output falls back to offline practice and notifies', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const request = requester.generate({ noteText: note, settings, count: 5 });
  requester.receive({ type: 'aiChunk', id: request.id, text: 'not json' });
  requester.receive({ type: 'aiDone', id: request.id });
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.source, 'offline');
  assert.equal(result.fallback, true);
  assert.ok(result.quiz.questions.length > 0);
  assert.ok(io.notices.some(message => /已改用离线基础练习/.test(message)));
});

test('an AI error also falls back instead of leaving the dialog empty', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const request = requester.generate({ noteText: note, settings, count: 5 });
  requester.receive({ type: 'aiError', id: request.id, message: '服务返回 500' });
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.ok(io.notices.some(message => /服务返回 500/.test(message)));
});

test('cancel aborts only the one-shot request and swallows its late response', async () => {
  const io = recorder();
  const requester = createQuizRequester({ send: io.send, notify: io.notify, native: true });
  const first = requester.generate({ noteText: note, settings, count: 5 });
  assert.equal(requester.cancel(), true);
  assert.equal(io.sent.at(-1).type, 'aiCancel');
  assert.equal(io.sent.at(-1).data.id, first.id);
  const cancelled = await first.promise;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.cancelled, true);
  assert.equal(requester.receive({ type: 'aiChunk', id: first.id, text: 'late' }), true);
  assert.equal(requester.info().busy, false);

  const second = requester.generate({ noteText: note, settings, count: 5 });
  assert.notEqual(second.id, first.id);
  assert.equal(requester.receive({ type: 'aiChunk', id: second.id, text: JSON.stringify(payload) }), true);
  assert.equal(requester.receive({ type: 'aiDone', id: second.id }), true);
  const result = await second.promise;
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ai');
});

test('timeout falls back to offline practice and clears the active request', async () => {
  const io = recorder();
  let timeoutCallback = null;
  const requester = createQuizRequester({
    send: io.send,
    notify: io.notify,
    native: true,
    setTimer: callback => { timeoutCallback = callback; return 1; },
    clearTimer: () => {}
  });
  const request = requester.generate({ noteText: note, settings, count: 5 });
  assert.equal(typeof timeoutCallback, 'function');
  timeoutCallback();
  const result = await request.promise;
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.ok(io.notices.some(message => /超时/.test(message)));
  assert.equal(requester.info().busy, false);
});
