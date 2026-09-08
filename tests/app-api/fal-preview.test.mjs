import assert from 'node:assert/strict';
import { compileShotPrompt } from '../../functions/_video-chat/shot-direction.mjs';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateFalPreview as generateRaw, reserveFalAnswer, reserveOwnerFalAnswer, availableFalClips, FAL_MODEL } from '../../functions/_video-chat/fal.mjs';
function db({ migrate = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0003_owner_fal_previews.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../../migrations/0002_fal_preview.sql', import.meta.url), 'utf8'));
  if (migrate) sql.exec(readFileSync(new URL('../../migrations/0004_public_fal_answers.sql', import.meta.url), 'utf8'));
  return {
    sql,
    prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args); }, async run() {
      const result = sql.prepare(query).run(...args);
      return { meta: { changes: Number(result.changes) } };
    } }; } }; },
  };
}
const actor = 'a'.repeat(64);
const env = () => ({ VIDEO_CHAT_FAL_PREVIEW: 'enabled', FAL_KEY: 'test-only-key', VIDEO_CHAT_QUOTAS: db() });
async function generateFalPreview(query, options) {
  let previewId = options.previewId;
  if (!Object.hasOwn(options, 'previewId') && options.env?.VIDEO_CHAT_QUOTAS) {
    try { previewId = await reserveFalAnswer(options.env.VIDEO_CHAT_QUOTAS, options.actor); } catch { /* Exercise fail-closed provider. */ }
  }
  return generateRaw(query, { ...options, previewId });
}
const response = (body, status = 200) => Response.json(body, { status });
const urls = {
  cancel_url: 'https://queue.fal.run/fal-ai/wan/requests/abc/cancel',
  status_url: 'https://queue.fal.run/fal-ai/wan/requests/abc/status',
  response_url: 'https://queue.fal.run/fal-ai/wan/requests/abc',
};
test('answer admission is repeatable while attempts remain and still bounded by global daily cap', async () => {
  const database = db();
  const admitted = await Promise.all(Array.from({ length: 30 }, () => reserveFalAnswer(database, actor)));
  assert.equal(admitted.filter(Boolean).length, 10);
  assert.ok(await reserveFalAnswer(database, actor, {}, Date.now() + 86400000));
});
test('daily UTC boundaries and global100 pilot cap cannot be raised by config', async () => {
  const database = db();
  const start = Date.UTC(2026, 8, 5);
  for (let day = 0; day < 10; day++) {
    const admitted = await Promise.all(Array.from({ length: 20 }, (_, i) => reserveFalAnswer(database, `${day}-${i}`, {
      VIDEO_CHAT_FAL_DAILY_LIMIT: '999', VIDEO_CHAT_FAL_TOTAL_LIMIT: '999',
    }, start + day * 86400000)));
    assert.equal(admitted.filter(Boolean).length, 10);
  }
  assert.equal(await reserveFalAnswer(database, 'future', {}, start + 10 * 86400000), null);
  assert.equal(database.sql.prepare('SELECT COUNT(*) AS total FROM video_chat_fal_answers').get().total, 100);
});
test('configuration may only tighten; invalid or zero limits fail closed', async () => {
  for (const value of ['0', '-1', 'NaN', '', '2.5']) {
    assert.equal(await reserveFalAnswer(db(), actor, { VIDEO_CHAT_FAL_DAILY_LIMIT: value }), null);
  }
  const database = db();
  assert.ok(await reserveFalAnswer(database, 'one', { VIDEO_CHAT_FAL_TOTAL_LIMIT: '1' }));
  assert.equal(await reserveFalAnswer(database, 'two', { VIDEO_CHAT_FAL_TOTAL_LIMIT: '1' }), null);
});
test('missing bindings, flag, actor, invalid prompt and prior abort never submit', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw Error('forbidden'); };
  for (const overrides of [{ FAL_KEY: undefined }, { VIDEO_CHAT_FAL_PREVIEW: undefined }, { VIDEO_CHAT_QUOTAS: undefined }]) {
    assert.equal((await generateFalPreview('Ocean', { env: { ...env(), ...overrides }, actor, fetcher })).reason, 'unavailable');
  }
  for (const invalidActor of ['', '192.0.2.1', 'x'.repeat(64)]) {
    await generateFalPreview('Ocean', { env: env(), actor: invalidActor, fetcher });
  }
  for (const query of ['', null, 'a'.repeat(2001)]) await generateFalPreview(query, { env: env(), actor, fetcher });
  await generateFalPreview('Ocean', { env: env(), actor, fetcher, signal: AbortSignal.abort() });
  assert.equal(calls, 0);
});
test('database unavailable or quota denied never submits', async () => {
  const configured = env();
  for (let i = 0; i < 10; i++) await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
  const fetcher = () => { throw Error('must not fetch'); };
  assert.equal((await generateFalPreview('Ocean', { env: configured, actor, fetcher })).reason, 'limit');
  configured.VIDEO_CHAT_QUOTAS.prepare = () => { throw Error('missing migration'); };
  assert.equal((await generateFalPreview('Ocean', { env: configured, actor, previewId: crypto.randomUUID(), fetcher })).reason, 'unavailable');
});
test('successful queue request uses fixed model, options, no retries and safe media URL', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return response(urls);
    if (calls.length === 2) return response({ status: 'COMPLETED' });
    return response({ video: { url: 'https://v3.fal.media/files/sample.mp4' } });
  };
  const result = await generateFalPreview('Ocean waves', { env: env(), actor, orientation: 'portrait', fetcher });
  assert.deepEqual(result, { media: { type: 'video', url: 'https://v3.fal.media/files/sample.mp4' }, reason: null });
  assert.equal(calls[0].url, `https://queue.fal.run/${FAL_MODEL}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.aspect_ratio, '9:16');
  assert.deepEqual(body, {
    prompt: compileShotPrompt('Ocean waves', { orientation: 'portrait' }), duration: 5, resolution: '768P', aspect_ratio: '9:16',
    enable_safety_checker: true, prompt_expansion_mode: 'balanced', sync_mode: false,
  });
  for (const { init } of calls) {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['X-Fal-No-Retry'], '1');
    assert.equal(init.headers['X-Fal-Request-Timeout'], '90');
  }
});
test('submission errors retain allowance and never retry', async () => {
  for (const failure of [() => response({}, 302), () => response({}, 500), () => { throw Error('connection lost'); }]) {
    const configured = env();
    let calls = 0;
    const fetcher = () => { calls++; return failure(); };
    assert.equal((await generateFalPreview('Ocean', { env: configured, actor, fetcher })).reason, 'unavailable');
    assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT SUM(attempts) AS attempts FROM video_chat_fal_answers').get().attempts, 1);
    assert.ok(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor));
    assert.equal(calls, 1);
  }
});
test('untrusted queue URLs never receive credentials; redirects explicitly rejected', async () => {
  for (const malicious of ['https://evil.example/status', 'https://queue.fal.run.evil.example/status', 'http://queue.fal.run/status', 'https://secret@queue.fal.run/status', 'https://queue.fal.run:444/status']) {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, 'manual');
      return response({ ...urls, status_url: malicious });
    };
    assert.equal((await generateFalPreview('Ocean', { env: env(), actor, fetcher })).reason, 'unavailable');
    assert.ok(calls.every(url => new URL(url).host === 'queue.fal.run'));
    assert.equal(calls.length, 2); // submission and safe cancellation only
  }
});
test('invalid output URL and provider safety errors never escape to client', async () => {
  for (const output of ['https://evil.example/video.mp4', 'https://fal.media.evil.example/video', 'http://fal.media/video', 'https://key@fal.media/video']) {
    let calls = 0;
    const fetcher = async () => response(++calls === 1 ? urls : calls === 2 ? { status: 'COMPLETED' } : { video: { url: output } });
    assert.equal((await generateFalPreview('Ocean', { env: env(), actor, fetcher })).reason, 'unavailable');
  }
  let calls = 0;
  const fetcher = async () => response(++calls === 1 ? urls : { status: 'COMPLETED', error: 'unsafe content' });
  assert.deepEqual(await generateFalPreview('Ocean', { env: env(), actor, fetcher }), { media: null, reason: 'unavailable' });
  assert.equal(calls, 2);
});
test('abort while queued cancels once with fresh signal, preserves used allowance', async () => {
  const configured = env();
  const controller = new AbortController();
  let calls = 0;
  const fetcher = async (url, init) => {
    calls++;
    if (calls === 1) return response(urls);
    if (url === urls.cancel_url) {
      assert.equal(init.method, 'PUT');
      assert.equal(init.signal.aborted, false);
      return response({ status: 'CANCELLATION_REQUESTED' });
    }
    controller.abort();
    return response({ status: 'IN_QUEUE' });
  };
  assert.equal((await generateFalPreview('Ocean', { env: configured, actor, fetcher, signal: controller.signal })).reason, 'unavailable');
  assert.equal(calls, 3);
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT SUM(attempts) AS attempts FROM video_chat_fal_answers').get().attempts, 1);
  assert.ok(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor));
});
test('polling progresses without resubmission', async () => {
  let statusCalls = 0;
  let submissions = 0;
  const fetcher = async (url, init) => {
    if (init.method === 'POST') { submissions++; return response(urls); }
    if (url === urls.status_url) return response({ status: ++statusCalls === 1 ? 'IN_PROGRESS' : 'COMPLETED' });
    return response({ video: { url: 'https://fal.media/video.mp4' } });
  };
  assert.equal((await generateFalPreview('Ocean', { env: env(), actor, fetcher })).reason, null);
  assert.equal(submissions, 1);
  assert.equal(statusCalls, 2);
});
test('15 second deadline and 3 second cancellation timeout bound queue work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let polling = false;
  let cancelling = false;
  const fetcher = async (url, init) => {
    if (init.method === 'POST') return response(urls);
    if (init.method === 'PUT') cancelling = true;
    else polling = true;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  const result = generateFalPreview('Ocean', { env: env(), actor, fetcher });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(polling, true);
  t.mock.timers.tick(15000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelling, true);
  t.mock.timers.tick(3000);
  assert.deepEqual(await result, { media: null, reason: 'unavailable' });
});
test('one public answer allows exactly three concurrent clip attempts, all failures remain counted', async () => {
  const configured = env();
  const previewId = await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
  assert.match(previewId, /^[a-f0-9-]{36}$/);
  let submissions = 0;
  const fetcher = async () => { submissions++; throw Error('uncertain submission'); };
  const results = await Promise.all(Array.from({ length: 25 }, () => generateRaw('Ocean', {
    env: configured, actor, previewId, fetcher,
  })));
  assert.equal(submissions, 3);
  assert.equal(results.filter(result => result.reason === 'limit').length, 22);
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_fal_answers WHERE id = ?').get(previewId).attempts, 3);
  assert.ok(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor));
});
test('missing, forged or another actor answer IDs cannot submit or consume another allowance', async () => {
  const configured = env();
  const previewId = await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
  let submissions = 0;
  const fetcher = async () => { submissions++; throw Error('forbidden'); };
  for (const id of [undefined, '', 'forged', crypto.randomUUID()]) {
    assert.equal((await generateRaw('Ocean', { env: configured, actor, previewId: id, fetcher })).reason, 'limit');
  }
  assert.equal((await generateRaw('Ocean', { env: configured, actor: 'b'.repeat(64), previewId, fetcher })).reason, 'limit');
  assert.equal(submissions, 0);
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_fal_answers WHERE id = ?').get(previewId).attempts, 0);
});
test('separate actors receive five lifetime attempts split across answers, never more than three each', async () => {
  const configured = env();
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('uncertain submission'); };
  for (const currentActor of [actor, 'b'.repeat(64)]) {
    for (const allowance of [3, 2]) {
      const previewId = await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, currentActor);
      for (let i = 0; i < 6; i++) {
        const result = await generateRaw('Ocean', { env: configured, actor: currentActor, previewId, fetcher });
        assert.equal(result.reason, i < allowance ? 'unavailable' : 'limit');
      }
    }
    assert.equal(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, currentActor), null);
  }
  assert.equal(calls, 10);
});
test('concurrent answers share an atomic five-attempt lifetime ceiling', async () => {
  const configured = env();
  const ids = await Promise.all(Array.from({ length: 6 }, () => reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor)));
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('uncertain submission'); };
  await Promise.all(ids.flatMap(previewId => Array.from({ length: 10 }, () => generateRaw('Ocean', {
    env: configured, actor, previewId, fetcher,
  }))));
  assert.equal(calls, 5);
  const rows = configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_fal_answers').all();
  assert.equal(rows.reduce((total, row) => total + row.attempts, 0), 5);
  assert.ok(rows.every(row => row.attempts <= 3));
});
test('additive migration preserves historical usage and missing migration fails closed', async () => {
  const database = db({ migrate: false });
  const previewId = crypto.randomUUID();
  database.sql.prepare('INSERT INTO video_chat_fal_previews(id, actor, created, attempts) VALUES (?, ?, ?, 5)').run(previewId, actor, Date.now());
  await assert.rejects(reserveFalAnswer(database, actor));
  let calls = 0;
  const result = await generateRaw('Ocean', {
    env: { ...env(), VIDEO_CHAT_QUOTAS: database }, actor, previewId,
    fetcher: async () => { calls++; throw Error('must not submit'); },
  });
  assert.equal(result.reason, 'unavailable');
  assert.equal(calls, 0);
  database.sql.exec(readFileSync(new URL('../../migrations/0004_public_fal_answers.sql', import.meta.url), 'utf8'));
  assert.equal(await reserveFalAnswer(database, actor), null);
  assert.equal(database.sql.prepare('SELECT attempts FROM video_chat_fal_previews WHERE id = ?').get(previewId).attempts, 5);
});
test('migration retains previous paid attempts and guards older in-flight writers', async () => {
  const configured = env();
  const database = configured.VIDEO_CHAT_QUOTAS;
  const previousId = crypto.randomUUID();
  database.sql.prepare('INSERT INTO video_chat_fal_previews(id, actor, created, attempts) VALUES (?, ?, ?, 2)').run(previousId, actor, Date.now());
  const previewId = await reserveFalAnswer(database, actor);
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('uncertain submission'); };
  await Promise.all(Array.from({ length: 10 }, () => generateRaw('Ocean', { env: configured, actor, previewId, fetcher })));
  assert.equal(calls, 3);
  assert.equal(database.sql.prepare('UPDATE video_chat_fal_previews SET attempts = attempts + 1 WHERE id = ? AND attempts < 5').run(previousId).changes, 0);
  assert.equal(await reserveFalAnswer(database, actor), null);
  assert.equal(database.sql.prepare('SELECT attempts FROM video_chat_fal_previews WHERE id = ?').get(previousId).attempts, 2);
});
test('previous in-flight reservations remain usable but consume the same lifetime total', async () => {
  const configured = env();
  const database = configured.VIDEO_CHAT_QUOTAS;
  const previousId = crypto.randomUUID();
  database.sql.prepare('INSERT INTO video_chat_fal_previews(id, actor, created, attempts) VALUES (?, ?, ?, 2)').run(previousId, actor, Date.now());
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('uncertain submission'); };
  assert.equal((await generateRaw('Ocean', { env: configured, actor, previewId: previousId, fetcher })).reason, 'unavailable');
  assert.equal((await generateRaw('Ocean', { env: configured, actor, previewId: previousId, fetcher })).reason, 'limit');
  const previewId = await reserveFalAnswer(database, actor);
  await Promise.all(Array.from({ length: 10 }, () => generateRaw('Ocean', { env: configured, actor, previewId, fetcher })));
  assert.equal(calls, 3);
});
test('historical answers count toward global caps, including older overlapping inserts', async () => {
  const database = db();
  const now = Date.UTC(2026, 8, 6, 12);
  database.sql.prepare('INSERT INTO video_chat_fal_previews(id, actor, created, attempts) VALUES (?, ?, ?, 5)').run(crypto.randomUUID(), actor, now);
  assert.equal(await reserveFalAnswer(database, actor, {}, now), null);
  for (let i = 0; i < 9; i++) assert.ok(await reserveFalAnswer(database, `actor-${i}`, {}, now));
  assert.equal(await reserveFalAnswer(database, 'another', {}, now), null);
  assert.equal(database.sql.prepare('INSERT INTO video_chat_fal_previews(id, actor, created) VALUES (?, ?, ?)').run(crypto.randomUUID(), 'old-writer', now).changes, 0);
});
test('diagnostics distinguish quota denial from storage failure without leaking identifiers', async () => {
  const diagnostics = [];
  const configured = env();
  const onDiagnostic = event => diagnostics.push(event);
  await generateRaw('Private prompt', { env: configured, actor, previewId: crypto.randomUUID(), onDiagnostic });
  configured.VIDEO_CHAT_QUOTAS.prepare = () => { throw Error('Private database/key detail'); };
  await generateRaw('Private prompt', { env: configured, actor, previewId: crypto.randomUUID(), onDiagnostic });
  assert.deepEqual(diagnostics, [
    { reason: 'quota_limit', stage: 'quota' },
    { reason: 'quota_unavailable', stage: 'quota' },
  ]);
});
test('diagnostics expose only safe stage and HTTP status from provider failures', async () => {
  const diagnostics = [];
  const result = await generateFalPreview('Private prompt', {
    env: env(), actor, onDiagnostic: event => diagnostics.push(event),
    fetcher: async () => new Response('secret-key private prompt https://private.example', { status: 429 }),
  });
  assert.deepEqual(result, { media: null, reason: 'unavailable' });
  assert.deepEqual(diagnostics, [{ reason: 'provider_http', stage: 'submit', httpStatus: 429 }]);
});
test('queue failure and invalid result metadata are generic and bounded to one diagnostic', async () => {
  for (const providerFailure of [true, false]) {
    const diagnostics = [];
    let calls = 0;
    await generateFalPreview('Private prompt', {
      env: env(), actor, onDiagnostic: event => diagnostics.push(event),
      fetcher: async () => response(++calls === 1 ? urls : calls === 2 ? {
        status: 'COMPLETED', ...(providerFailure ? { error: 'secret prompt', error_type: 'private safety reason' } : {}),
      } : { video: { url: 'https://private.example/secret-key' } }),
    });
    assert.deepEqual(diagnostics, [{ reason: providerFailure ? 'provider_failed' : 'invalid_metadata', stage: providerFailure ? 'queue' : 'result' }]);
  }
});
test('network diagnostics omit errors and callback failures never affect the result', async () => {
  const diagnostics = [];
  await generateFalPreview('Private prompt', {
    env: env(), actor, onDiagnostic: event => diagnostics.push(event),
    fetcher: async () => { throw Error('secret-key request-url private-prompt'); },
  });
  assert.deepEqual(diagnostics, [{ reason: 'network_error', stage: 'submit' }]);
  for (const onDiagnostic of [() => { throw Error('logging failure'); }, async () => { throw Error('async logging failure'); }]) {
    const result = await generateFalPreview('Private prompt', {
      env: env(), actor, onDiagnostic, fetcher: async () => response({}, 500),
    });
    assert.deepEqual(result, { media: null, reason: 'unavailable' });
  }
});
test('timeout and user cancellation report separate safe reasons once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const timeout of [true, false]) {
    const diagnostics = [];
    const controller = new AbortController();
    const result = generateFalPreview('Private prompt', {
      env: env(), actor, signal: controller.signal, onDiagnostic: event => diagnostics.push(event),
      fetcher: async (url, init) => {
        if (init.method === 'POST') return response(urls);
        if (init.method === 'PUT') throw Error('private cancellation failure');
        return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    if (timeout) t.mock.timers.tick(15000);
    else controller.abort(new Error('private reason'));
    assert.deepEqual(await result, { media: null, reason: 'unavailable' });
    assert.deepEqual(diagnostics, [{ reason: timeout ? 'timeout' : 'cancelled', stage: 'queue' }]);
  }
});
test('successful generation emits no diagnostic', async () => {
  const diagnostics = [];
  let calls = 0;
  const result = await generateFalPreview('Ocean', {
    env: env(), actor, onDiagnostic: event => diagnostics.push(event),
    fetcher: async () => response(++calls === 1 ? urls : calls === 2 ? { status: 'COMPLETED' } : { video: { url: 'https://fal.media/video.mp4' } }),
  });
  assert.equal(result.reason, null);
  assert.deepEqual(diagnostics, []);
});
test('verified owner answers are repeatable and do not consume public preview counts', async () => {
  const database = db();
  const ownerIds = await Promise.all(Array.from({ length: 110 }, () => reserveOwnerFalAnswer(database, actor)));
  assert.equal(ownerIds.filter(Boolean).length, 110);
  assert.equal(new Set(ownerIds).size, 110);
  assert.equal(database.sql.prepare('SELECT COUNT(*) AS count FROM video_chat_fal_answers').get().count, 0);
  for (let i = 0; i < 10; i++) assert.ok(await reserveFalAnswer(database, `public-${i}`));
  assert.equal(await reserveFalAnswer(database, 'public-eleven'), null);
  assert.ok(await reserveOwnerFalAnswer(database, actor));
  assert.equal(database.sql.prepare('SELECT COUNT(*) AS count FROM video_chat_fal_answers').get().count, 10);
});
test('each owner answer enforces five atomic attempts even under concurrent failures', async () => {
  const configured = env();
  let submissions = 0;
  const fetcher = async () => { submissions++; throw Error('uncertain provider outcome'); };
  for (let answer = 0; answer < 2; answer++) {
    const previewId = await reserveOwnerFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
    const results = await Promise.all(Array.from({ length: 25 }, () => generateRaw('Ocean', {
      env: configured, actor, previewId, owner: true, fetcher,
    })));
    assert.equal(results.filter(result => result.reason === 'unavailable').length, 5);
    assert.equal(results.filter(result => result.reason === 'limit').length, 20);
    assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_owner_fal_previews WHERE id = ?').get(previewId).attempts, 5);
  }
  assert.equal(submissions, 10);
  assert.ok(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor));
  assert.ok(await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor));
});
test('owner and public clip reservations cannot cross ledgers or actors', async () => {
  const configured = env();
  const ownerId = await reserveOwnerFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
  const publicId = await reserveFalAnswer(configured.VIDEO_CHAT_QUOTAS, actor);
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('must not submit'); };
  for (const options of [
    { previewId: publicId, owner: true, actor },
    { previewId: ownerId, owner: false, actor },
    { previewId: ownerId, owner: 'true', actor },
    { previewId: ownerId, actor },
    { previewId: ownerId, owner: true, actor: 'b'.repeat(64) },
  ]) {
    assert.equal((await generateRaw('Ocean', { env: configured, fetcher, ...options })).reason, 'limit');
  }
  assert.equal(calls, 0);
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_owner_fal_previews WHERE id = ?').get(ownerId).attempts, 0);
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT attempts FROM video_chat_fal_answers WHERE id = ?').get(publicId).attempts, 0);
});
test('owner storage failures deny provider access and invalid actor cannot reserve', async () => {
  const database = { prepare() { throw Error('storage unavailable'); } };
  await assert.rejects(reserveOwnerFalAnswer(database, actor));
  assert.equal(await reserveOwnerFalAnswer(database, 'raw-ip'), null);
  let calls = 0;
  const result = await generateRaw('Ocean', {
    env: { ...env(), VIDEO_CHAT_QUOTAS: database }, actor, owner: true, previewId: crypto.randomUUID(),
    fetcher: async () => { calls++; throw Error('must not submit'); },
  });
  assert.equal(result.reason, 'unavailable');
  assert.equal(calls, 0);
});


test('provider payload carries bounded shot direction, visual look and orientation without paid requests', async () => {
  const captured = [];
  const scene = { variables: { shotDirection: 'A stationary close shot of the crest breaking, with the horizon out of frame.' } };
  const generatedLook = 'Muted natural color, soft contrast and realistic water.';
  const result = await generateFalPreview('breaking ocean wave', {
    env: env(), actor, orientation: 'portrait', scene, generatedLook,
    fetcher: async (url, options) => {
      if (options.method === 'POST') { captured.push(JSON.parse(options.body)); return response(urls); }
      if (url === urls.status_url) return response({ status: 'COMPLETED' });
      if (url === urls.response_url) return response({ video: { url: 'https://v3.fal.media/fixture.mp4' } });
      throw new Error('Unexpected fixture transport');
    },
  });
  assert.ok(result.media);
  assert.equal(captured.length, 1);
  assert.match(captured[0].prompt, /stationary close shot/);
  assert.match(captured[0].prompt, /Muted natural color/);
  assert.match(captured[0].prompt, /vertical 9:16/);
  assert.match(captured[0].prompt, /No music, narration, dialogue or voiceover/);
  assert.match(captured[0].prompt, /No overlaid text/);
  assert.doesNotMatch(captured[0].prompt, /camera (must|always|never stops)/i);
  assert.equal(captured[0].aspect_ratio, '9:16');
  assert.throws(() => compileShotPrompt('ocean', { scene: { variables: { shotDirection: 'x'.repeat(1601) } } }), /shot direction/);
});

 test('planning allowance is read-only, reflects historical attempts and global caps', async () => {
  const configured = env();
  assert.deepEqual(await availableFalClips(configured, actor), { limit: 3, reason: null });
  assert.equal(configured.VIDEO_CHAT_QUOTAS.sql.prepare('SELECT COUNT(*) AS n FROM video_chat_fal_answers').get().n, 0);
  configured.VIDEO_CHAT_QUOTAS.sql.prepare('INSERT INTO video_chat_fal_previews VALUES (?, ?, ?, ?)').run('old', actor, Date.now(), 4);
  assert.deepEqual(await availableFalClips(configured, actor), { limit: 1, reason: null });
  configured.VIDEO_CHAT_QUOTAS.sql.prepare('UPDATE video_chat_fal_previews SET attempts=5').run();
  assert.deepEqual(await availableFalClips(configured, actor), { limit: 0, reason: 'user_limit' });
  assert.deepEqual(await availableFalClips(configured, actor, { owner: true }), { limit: 5, reason: null });
  assert.equal((await availableFalClips({ ...env(), VIDEO_CHAT_FAL_DAILY_LIMIT: '0' }, actor)).limit, 0);
  assert.equal((await availableFalClips({ ...env(), FAL_KEY: undefined }, actor)).reason, 'configuration');
});
 test('planning allowance fails closed and bounds stalled reads without changing admission', async () => {
  const configured = { ...env(), VIDEO_CHAT_QUOTAS: { prepare() { return { bind() { return { first() { return new Promise(() => {}); } }; } }; } } };
  const start=Date.now();
  assert.deepEqual(await availableFalClips(configured, actor), { limit: 0, reason: 'quota_unavailable' });
  assert.ok(Date.now()-start < 500);
});

test('AI-first direction preserves authored fantasy, continuity and full bounded shot instructions', () => {
  const direction = 'A paper-cut cloud character searches for its missing shadow. '.repeat(18);
  const prompt = compileShotPrompt('cloud searching for shadow', { scene: { variables: { shotDirection: direction } }, orientation: 'portrait' });
  assert.ok(prompt.includes(direction.trim()));
  assert.doesNotMatch(prompt, /Natural lighting|physically plausible|restrained camera work/);
  assert.match(prompt, /Silent footage only/);
  assert.match(prompt, /continuous motion|action continues/i);
  assert.throws(() => compileShotPrompt('cloud', { scene: { variables: { shotDirection: 'x'.repeat(1601) } } }), /shot direction/);
});
