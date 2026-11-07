import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiSanitize, trimMessages, parseToolCalls, shareCardData, endpointOf, requestBody,
  i18n, AI_TOOLS, DEVICE_TOOLS, AI_THEMES
} from '../src/ai.js';

test('networking is disabled by default and keys stay local', () => {
  const s = aiSanitize(null);
  assert.equal(s.enabled, false);
  assert.equal(s.apiKey, '');
  assert.equal(s.remote, false);
  assert.equal(s.autoApprove, false);
  assert.equal(s.lang, 'zh');
});

test('settings are bounded and unknown themes fall back', () => {
  const s = aiSanitize({ enabled: true, apiKey: 'k'.repeat(500), temperature: 99, theme: 'nope', view: 'web' });
  assert.equal(s.apiKey.length, 300);
  assert.equal(s.temperature, 2);
  assert.equal(s.theme, 'jade');
  assert.equal(s.view, 'web');
  assert.equal(AI_THEMES.length, 6);
});

test('history is capped at 200 messages and 200k characters', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ role: 'user', content: 'x'.repeat(3000), ts: i }));
  const kept = trimMessages(many);
  assert.ok(kept.length <= 200);
  assert.ok(kept.reduce((sum, m) => sum + m.content.length, 0) <= 200000);
  assert.equal(kept[0].role, 'user');
});

test('the character budget keeps the newest messages, not the oldest', () => {
  // 250 messages of 3000 chars exceed the 200k budget inside the 200-message window.
  // The latest user question must survive so the model answers the current turn.
  const many = Array.from({ length: 250 }, (_, i) => ({ role: 'user', content: 'm' + i + ':' + 'x'.repeat(3000), ts: i, id: i }));
  const kept = trimMessages(many);
  assert.equal(kept.at(-1).id, 249, 'newest message must be retained');
  assert.equal(kept.at(-1).content, many[249].content);
  // Chronological order is preserved and the oldest retained message is newer than dropped ones.
  assert.ok(kept.every((m, i) => i === 0 || m.id > kept[i - 1].id));
  assert.ok(kept[0].id > 49, 'oldest part of the window is dropped first');
  assert.ok(kept.reduce((sum, m) => sum + m.content.length, 0) <= 200000);
});

test('tool cards parse fenced JSON and ignore malformed blocks', () => {
  const text = '先看清单\n```tool\n{"tool":"scanFiles","args":{}}\n```\n然后\n```tool\nnot-json\n```\n```tool\n{"tool":"deleteFiles","args":{"documentIds":["a"],"confirmed":true}}\n```';
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, 'scanFiles');
  assert.deepEqual(calls[1].args.documentIds, ['a']);
  assert.deepEqual(parseToolCalls('plain reply'), []);
});

test('every device capability has a registered card', () => {
  for (const name of DEVICE_TOOLS) assert.ok(AI_TOOLS.some(t => t.name === name), 'missing ' + name);
  const del = AI_TOOLS.find(t => t.name === 'deleteFiles');
  assert.equal(del.write, true);
  assert.equal(del.danger, true);
  assert.ok(AI_TOOLS.find(t => t.name === 'scanFiles').write === false, 'scan must be read-only');
});

test('share card keeps only bounded recent lines', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'line ' + i }));
  const card = shareCardData(messages, '天工 · AI 助手');
  assert.equal(card.title, '天工 · AI 助手');
  assert.equal(card.lines.length, 6);
  assert.ok(card.lines.every(line => line.text.length <= 120));
});

test('remote endpoint is used only when explicitly enabled', () => {
  const base = aiSanitize({ enabled: true, remote: true, remoteUrl: 'http://192.168.1.10:8080/v1/chat/completions' });
  assert.equal(endpointOf(base), 'http://192.168.1.10:8080/v1/chat/completions');
  assert.equal(endpointOf({ ...base, enabled: false }), 'https://api.deepseek.com/chat/completions');
  assert.equal(endpointOf({ ...base, remote: false }), 'https://api.deepseek.com/chat/completions');
});

test('request body carries the system prompt and bounded history', () => {
  const body = requestBody({ enabled: true, model: 'deepseek-chat', temperature: 0.4 }, [
    { role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }
  ]);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.temperature, 0.4);
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.length, 3);
});

test('interface language switches between Chinese and English', () => {
  assert.equal(i18n('send', 'zh'), '发送');
  assert.equal(i18n('send', 'en'), 'Send');
  assert.equal(i18n('unknown-key', 'zh'), 'unknown-key');
});
