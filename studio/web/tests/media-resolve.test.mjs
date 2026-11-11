import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMedia, releaseMedia } from '../src/media-store.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/* mediaUrl 依赖 location；Node 里没有，补一个固定资源根。 */
function stubLocation(t) {
  const original = globalThis.location;
  globalThis.location = { origin: 'https://studio.test', pathname: '/studio/index.html' };
  t.after(() => {
    if (original === undefined) delete globalThis.location;
    else globalThis.location = original;
  });
}

/* fetch 立刻给出 Response，但 arrayBuffer() 由测试控制何时完成。 */
function stubFetch(t) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url) => {
    const body = deferred();
    calls.push({ url: String(url), body });
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => body.promise });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

function stubObjectUrls(t) {
  const created = [];
  const revoked = [];
  let seq = 0;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    const url = 'blob:mock/' + (++seq);
    created.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  t.after(() => {
    if (originalCreate === undefined) delete URL.createObjectURL;
    else URL.createObjectURL = originalCreate;
    if (originalRevoke === undefined) delete URL.revokeObjectURL;
    else URL.revokeObjectURL = originalRevoke;
  });
  return { created, revoked };
}

const bytes = (...values) => new Uint8Array(values).buffer;

test('resolveMedia 成功后缓存 objectURL，重复解析不再 fetch', async (t) => {
  stubLocation(t);
  const calls = stubFetch(t);
  const urls = stubObjectUrls(t);
  const ref = 'lecture-media/cached.webm';
  t.after(() => releaseMedia(ref));

  const job = resolveMedia(ref, 'audio/webm');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://studio.test/lecture-media/cached.webm');
  const busy = resolveMedia(ref, 'audio/webm');
  assert.equal(busy, job, '在途加载要去重，不能再发一次 fetch');

  calls[0].body.resolve(bytes(1, 2, 3));
  const url = await job;
  assert.equal(await busy, url);
  assert.match(url, /^blob:/);
  assert.equal(urls.created.length, 1);
  assert.equal(urls.created[0].blob.type, 'audio/webm');
  assert.deepEqual(urls.revoked, [], '成功加载不该被 revoke');

  assert.equal(await resolveMedia(ref, 'audio/webm'), url, '缓存命中要返回同一个 URL');
  assert.equal(calls.length, 1, '缓存命中不能再 fetch');
});

test('fetch 在途时 releaseMedia：迟到的 objectURL 立即 revoke，不进缓存', async (t) => {
  stubLocation(t);
  const calls = stubFetch(t);
  const urls = stubObjectUrls(t);
  const ref = 'lecture-media/released.webm';
  t.after(() => releaseMedia(ref));

  const job = resolveMedia(ref);
  const outcome = job.then(value => ({ value }), error => ({ error }));
  releaseMedia(ref);
  calls[0].body.resolve(bytes(1, 2, 3));

  const result = await outcome;
  assert.equal(result.value, undefined, '过期加载不能 resolve 出已 revoke 的 URL');
  assert.match(result.error.message, /媒体引用已释放/);
  assert.equal(urls.created.length, 1);
  assert.deepEqual(urls.revoked, [urls.created[0].url], '迟到的 URL 必须立刻 revoke');

  const fresh = resolveMedia(ref);
  assert.equal(calls.length, 2, '释放后必须重新 fetch，不能复用已 revoke 的 URL');
  calls[1].body.resolve(bytes(4, 5));
  const url = await fresh;
  assert.notEqual(url, urls.created[0].url);
  assert.deepEqual(urls.revoked, [urls.created[0].url], '新 URL 不该被 revoke');
  assert.equal(await resolveMedia(ref), url, '新 URL 要正常进缓存');
  assert.equal(calls.length, 2);
});

test('释放后重新 resolve：旧加载作废，新加载不受影响', async (t) => {
  stubLocation(t);
  const calls = stubFetch(t);
  const urls = stubObjectUrls(t);
  const ref = 'lecture-media/reloaded.webm';
  t.after(() => releaseMedia(ref));

  const first = resolveMedia(ref);
  const firstOutcome = first.then(value => ({ value }), error => ({ error }));
  releaseMedia(ref);
  const second = resolveMedia(ref);
  assert.equal(calls.length, 2);

  calls[0].body.resolve(bytes(1));
  const stale = await firstOutcome;
  assert.equal(stale.value, undefined);
  assert.match(stale.error.message, /媒体引用已释放/);
  assert.deepEqual(urls.revoked, [urls.created[0].url]);

  assert.equal(resolveMedia(ref), second, '旧加载的清理不能删掉新加载的 loading 条目');
  assert.equal(calls.length, 2, '旧加载作废不能触发多余的 fetch');

  calls[1].body.resolve(bytes(2));
  const url = await second;
  assert.equal(url, urls.created[1].url);
  assert.deepEqual(urls.revoked, [urls.created[0].url], '新加载的 URL 不该被 revoke');
  assert.equal(await resolveMedia(ref), url);
});
