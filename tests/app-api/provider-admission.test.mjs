import test from 'node:test';
import assert from 'node:assert/strict';
import { guardPaidProvider } from '../../functions/_video-chat/provider-admission.mjs';

const permissions = { streamText: ['response'], generateText: ['response', 'narration', 'suggestions'], generateSpeech: ['speech'], generateVideo: ['response'], searchMedia: ['response', 'suggestions', 'opening-media'] };
function admission(action, overrides = {}) {
  return { action, reservation: 'server-reserved-request', signal: new AbortController().signal, isReleased: () => false, ...overrides };
}
async function invoke(kind, callback, context = {}) {
  if (kind === 'streamText') { const chunks = []; for await (const chunk of callback(context)) chunks.push(chunk); return chunks; }
  return ['generateVideo', 'searchMedia'].includes(kind) ? callback('literal subject', context) : callback(context);
}
for (const [kind, allowed] of Object.entries(permissions)) {
  test(`${kind} only reaches its provider for explicitly admitted actions`, async () => {
    for (const action of ['response', 'narration', 'suggestions', 'speech', 'welcome', 'capabilities', 'opening-media', 'future-paid-action']) {
      let calls = 0;
      const provider = kind === 'streamText' ? async function* () { calls++; yield 'text'; } : async () => { calls++; return 'value'; };
      const callback = guardPaidProvider(kind, admission(action), provider);
      if (allowed.includes(action)) await invoke(kind, callback);
      else await assert.rejects(invoke(kind, callback), /not admitted/);
      assert.equal(calls, allowed.includes(action) ? 1 : 0);
    }
  });
  test(`${kind} rejects missing, released or canceled admission before provider access`, async () => {
    const canceled = AbortSignal.abort();
    for (const state of [{ reservation: undefined }, { reservation: '' }, { isReleased: () => true }, { signal: canceled }]) {
      let calls = 0;
      const provider = kind === 'streamText' ? async function* () { calls++; yield 'text'; } : async () => { calls++; };
      await assert.rejects(invoke(kind, guardPaidProvider(kind, admission(allowed[0], state), provider)), /not admitted/);
      assert.equal(calls, 0);
    }
  });
}
test('lazy stream cannot start or resume after host release', async () => {
  let released = false, calls = 0;
  const state = admission('response', { isReleased: () => released });
  const provider = async function* () { calls++; yield 'first'; calls++; yield 'second'; };
  const callback = guardPaidProvider('streamText', state, provider);
  const unopened = callback({}); released = true;
  await assert.rejects(unopened.next(), /not admitted/); assert.equal(calls, 0);
  released = false; const active = callback({}); assert.equal((await active.next()).value, 'first');
  released = true; await assert.rejects(active.next(), /not admitted/); assert.equal(calls, 1);
});
test('host and runtime cancellation both reach the provider signal', async () => {
  for (const cancelHost of [true, false]) {
    const host = new AbortController(), sdk = new AbortController();
    let received;
    const callback = guardPaidProvider('generateText', admission('response', { signal: host.signal }), async context => { received = context.signal; return 'ok'; });
    assert.equal(await callback({ signal: sdk.signal, userPrompt: 'bounded text' }), 'ok');
    (cancelHost ? host : sdk).abort(); assert.equal(received.aborted, true);
  }
});
test('an already canceled runtime task never invokes the paid callback', async () => {
  let calls = 0;
  const callback = guardPaidProvider('generateSpeech', admission('speech'), async () => { calls++; });
  await assert.rejects(callback({ signal: AbortSignal.abort() }), /not admitted/); assert.equal(calls, 0);
});
test('future runtime operations and wrong methods cannot reach admission or providers', async () => {
  const { handleVideoChatRequest } = await import('../../functions/api/video-chat.mjs');
  let queries = 0, calls = 0;
  const env = { ANTHROPIC_API_KEY: 'test-only', VIDEO_CHAT_QUOTA_SALT: 's'.repeat(32),
    VIDEO_CHAT_QUOTAS: { prepare() { queries++; throw Error('No query expected'); } } };
  for (const [method, action] of [['POST', 'future-generation'], ['POST', 'transcribe'], ['POST', 'capabilities'], ['GET', 'response']]) {
    const request = new Request(`https://example.com/api/video-chat?action=${action}`, { method,
      headers: { origin: 'https://example.com', 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}) });
    const response = await handleVideoChatRequest({ request, env, fetcher() { calls++; throw Error('No provider expected'); } });
    assert.equal(response.status, 405);
  }
  assert.equal(queries, 0); assert.equal(calls, 0);
});

for (const kind of ['generateVideo', 'searchMedia']) {
  test(`${kind} preserves the query and combines runtime and host cancellation`, async () => {
    for (const cancelHost of [true, false]) {
      const host = new AbortController(), sdk = new AbortController();
      let calls = 0, received;
      const callback = guardPaidProvider(kind, admission('response', { signal: host.signal }), async (query, context) => {
        calls++; assert.equal(query, 'literal subject'); received = context.signal; return { type: 'video' };
      });
      assert.deepEqual(await invoke(kind, callback, { signal: sdk.signal }), { type: 'video' });
      (cancelHost ? host : sdk).abort(); assert.equal(received.aborted, true);
      await assert.rejects(invoke(kind, callback, { signal: sdk.signal }), /not admitted/); assert.equal(calls, 1);
    }
  });
  test(`${kind} refuses an already canceled runtime task without provider calls`, async () => {
    let calls = 0;
    const callback = guardPaidProvider(kind, admission('response'), async () => { calls++; });
    await assert.rejects(invoke(kind, callback, { signal: AbortSignal.abort() }), /not admitted/);
    assert.equal(calls, 0);
  });
}
