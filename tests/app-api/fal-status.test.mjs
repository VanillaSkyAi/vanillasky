import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFalPreview } from '../../functions/_video-chat/fal.mjs';

const urls = {
  status_url: 'https://queue.fal.run/model/requests/test/status',
  response_url: 'https://queue.fal.run/model/requests/test',
  cancel_url: 'https://queue.fal.run/model/requests/test/cancel',
};
const media = { video: { url: 'https://fal.media/test.mp4' } };
const encode = value => new TextEncoder().encode(value);
const flush = () => new Promise(resolve => setImmediate(resolve));
const sse = body => new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
function setup() {
  let reservations = 0;
  return {
    reserved: () => reservations,
    options: {
      env: { VIDEO_CHAT_FAL_PREVIEW: 'enabled', FAL_KEY: 'private-key', VIDEO_CHAT_QUOTAS: {
        prepare: () => ({ bind: () => ({ run: async () => { reservations++; return { meta: { changes: 1 } }; } }) }),
      } },
      actor: 'a'.repeat(64), previewId: 'a'.repeat(36),
    },
  };
}

test('completion events release a clip at 3.1 seconds instead of the next 4.5-second poll', async t => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { options, reserved } = setup();
  const calls = [];
  const events = [];
  let stream;
  const pending = generateFalPreview('ocean', { ...options, onTiming: event => events.push(event), fetcher: async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === 'POST') return Response.json(urls);
    if (url === `${urls.status_url}/stream`) {
      return sse(new ReadableStream({ start(controller) { stream = controller; controller.enqueue(encode('data: {"status":"IN_PROGRESS"}\n\n')); } }));
    }
    if (url === urls.status_url) return Response.json({ status: clock >= 3100 ? 'COMPLETED' : 'IN_PROGRESS' });
    if (url === urls.response_url) return Response.json(media);
    throw Error('Unexpected provider request');
  } });
  await flush();
  for (const at of [1500, 3000]) { clock = at; t.mock.timers.tick(1500); await flush(); }
  clock = 3100;
  t.mock.timers.tick(100);
  stream?.enqueue(encode('data: {"status":"COMPLETED","metrics":{"inference_time":3.1}}\n\n'));
  await flush();
  // Let the old polling implementation finish too, so its failure is measured.
  if (!events.length) { clock = 4500; t.mock.timers.tick(1400); await flush(); }
  const result = await pending;
  assert.equal(result.media?.url, media.video.url);
  assert.equal(events[0].firstCompletedMs, 3100);
  assert.equal(events[0].pollSleepMs, 0);
  assert.equal(events[0].pollCount, 2);
  assert.equal(events[0].runnerProcessingMs, 3100);
  assert.equal(events[0].statusStreamMs, 3100);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.length, 5);
  assert.equal(reserved(), 1);
});

function transport({ stream, status = () => Response.json({ status: 'COMPLETED' }), signal }) {
  const calls = [];
  const diagnostics = [];
  const timings = [];
  const { options, reserved } = setup();
  const pending = generateFalPreview('private prompt', {
    ...options, signal, onDiagnostic: event => diagnostics.push(event), onTiming: event => timings.push(event),
    fetcher: async (url, init) => {
      calls.push({ url, init });
      assert.equal(new URL(url).host, 'queue.fal.run');
      assert.equal(init.redirect, 'manual');
      if (init.method === 'POST') return Response.json(urls);
      if (init.method === 'PUT') return Response.json({ status: 'CANCELLATION_REQUESTED' });
      if (url === `${urls.status_url}/stream`) return stream(init);
      if (url === urls.status_url) return status(init);
      if (url === urls.response_url) return Response.json(media);
      throw Error('Unexpected provider request');
    },
  });
  return { pending, calls, diagnostics, timings, reserved };
}

test('chunked multiline SSE accepts comments and split CRLF without using event URLs or private fields', async () => {
  const source = ': keepalive\r\nevent: status\r\ndata: {"status":"IN_PROGRESS"}\r\n\r\n'
    + 'data: {"status":"COMPLETED",\r\ndata: "response_url":"https://private.example/secret", "metrics":{"inference_time":2},"logs":["private"]}\r\n\r\n';
  const job = transport({ stream: () => sse(new ReadableStream({ start(controller) {
    for (const char of source) controller.enqueue(encode(char));
    controller.close();
  } })) });
  assert.ok((await job.pending).media);
  assert.equal(job.calls.length, 3);
  assert.equal(job.calls[1].init.headers.Accept, 'text/event-stream');
  assert.equal(job.timings[0].pollCount, 0);
  assert.equal(job.timings[0].runnerProcessingMs, 2000);
  assert.deepEqual(job.diagnostics, []);
  assert.doesNotMatch(JSON.stringify(job.timings), /private|secret|https|prompt/);
});

test('unsupported, disconnected and malformed streams recover by polling the same single paid job', async () => {
  for (const stream of [
    () => new Response('unsupported', { status: 404 }),
    () => Response.json({ status: 'COMPLETED' }),
    () => sse('data: {"status":"IN_PROGRESS"}\n\n'),
    () => sse('data: not json\n\n'),
    () => sse('data: {"status":"PRIVATE_ERROR"}\n\n'),
    () => sse(`data: ${'x'.repeat(65536)}\n\n`),
    () => { throw Error('private connection failure'); },
  ]) {
    const job = transport({ stream });
    assert.ok((await job.pending).media);
    assert.equal(job.reserved(), 1);
    assert.equal(job.calls.filter(call => call.init.method === 'POST').length, 1);
    assert.equal(job.calls.filter(call => call.url === urls.status_url).length, 1);
    assert.equal(job.calls.filter(call => call.init.method === 'PUT').length, 0);
    assert.deepEqual(job.diagnostics, []);
  }
});

test('silent stream headers or body cannot hide a completed job beyond the polling cadence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const waitingForHeaders of [true, false]) {
    let cancelled = false;
    let streamSignal;
    const job = transport({ stream: init => {
      streamSignal = init.signal;
      if (waitingForHeaders) return new Promise((_, reject) => init.signal.addEventListener('abort', () => { cancelled = true; reject(init.signal.reason); }, { once: true }));
      return sse(new ReadableStream({ cancel() { cancelled = true; } }));
    } });
    await flush();
    assert.equal(job.calls.length, 2);
    t.mock.timers.tick(1500);
    assert.ok((await job.pending).media);
    assert.equal(streamSignal.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(job.calls.filter(call => call.url === urls.status_url).length, 1);
    assert.equal(job.reserved(), 1);
  }
});

test('a streamed completion cancels a stalled watchdog request and does not wait for it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stream;
  let pollSignal;
  const job = transport({
    stream: () => sse(new ReadableStream({ start(controller) { stream = controller; } })),
    status: init => { pollSignal = init.signal; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); },
  });
  await flush();
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(pollSignal.aborted, false);
  stream.enqueue(encode('data: {"status":"COMPLETED"}\n\n'));
  assert.ok((await job.pending).media);
  assert.equal(pollSignal.aborted, true);
  assert.equal(job.calls.length, 4);
});

test('a streamed provider failure stays generic and never fetches the result or cancels completed work', async () => {
  const job = transport({ stream: () => sse('data: {"status":"COMPLETED","error":"private prompt","error_type":"private safety reason"}\n\n') });
  assert.deepEqual(await job.pending, { media: null, reason: 'unavailable' });
  assert.deepEqual(job.diagnostics, [{ reason: 'provider_failed', stage: 'queue' }]);
  assert.equal(job.calls.length, 2);
  assert.equal(job.reserved(), 1);
});

test('user abort and the overall deadline release stream and watchdog then cancel the paid job once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const timeout of [false, true]) {
    const controller = new AbortController();
    let streamCancelled = false;
    let pollSignal;
    const job = transport({
      signal: controller.signal,
      stream: () => sse(new ReadableStream({ cancel() { streamCancelled = true; } })),
      status: init => { pollSignal = init.signal; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); },
    });
    await flush();
    t.mock.timers.tick(1500);
    await flush();
    if (timeout) t.mock.timers.tick(13500);
    else controller.abort(new Error('private cancellation reason'));
    assert.deepEqual(await job.pending, { media: null, reason: 'unavailable' });
    assert.deepEqual(job.diagnostics, [{ reason: timeout ? 'timeout' : 'cancelled', stage: 'queue' }]);
    assert.equal(streamCancelled, true);
    assert.equal(pollSignal.aborted, true);
    const cancellations = job.calls.filter(call => call.init.method === 'PUT');
    assert.equal(cancellations.length, 1);
    assert.equal(cancellations[0].init.signal.aborted, false);
    assert.equal(job.reserved(), 1);
    const callCount = job.calls.length;
    t.mock.timers.tick(20000);
    await flush();
    assert.equal(job.calls.length, callCount);
  }
});

test('the stream byte ceiling is cumulative across individually valid events and releases its reader', async () => {
  let cancelled = false;
  const job = transport({ stream: () => sse(new ReadableStream({ start(controller) {
    const chunk = `data: ${JSON.stringify({ status: 'IN_PROGRESS', logs: ['x'.repeat(32700)] })}\n\n`;
    for (let index = 0; index < 3; index++) controller.enqueue(encode(chunk));
  }, cancel() { cancelled = true; } })) });
  assert.ok((await job.pending).media);
  assert.equal(cancelled, true);
  assert.equal(job.calls.filter(call => call.url === urls.status_url).length, 1);
  assert.equal(job.reserved(), 1);
});
