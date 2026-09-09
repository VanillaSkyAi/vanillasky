import { compileShotPrompt } from './shot-direction.mjs';
// Fixed pilot configuration. Never accept a model, URL or generation options
// from the browser. https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api
export const FAL_MODEL = 'minimax/h3-max-turbo/text-to-video';
const SUBMIT = `https://queue.fal.run/${FAL_MODEL}`;
const DAY = 86400000;
export const PUBLIC_LIFETIME_CLIPS = 10;
const PUBLIC_DAILY_CLIPS = 200;
// Keep historical reservations and their paid attempts in every public total.
const PUBLIC_ROWS = 'video_chat_fal_public_usage';
const CURRENT_DAY_SQL = `(unixepoch('now') / 86400) * 86400000`;
const FAL_RESERVE_SQL = `INSERT INTO video_chat_fal_reservations(id, actor, created)
SELECT ?, ?, ? WHERE
 (SELECT COALESCE(SUM(attempts), 0) FROM ${PUBLIC_ROWS} WHERE actor = ?) < ${PUBLIC_LIFETIME_CLIPS}`;

function cap(value, maximum) {
  if (value === undefined) return maximum;
  if (!/^\d+$/.test(String(value))) return 0;
  return Math.min(maximum, Number(value));
}
// Advisory snapshot for planning only. Atomic reservations below remain the authority.
// A slow/unavailable ledger must not hold up the opening or promise unavailable media.
export async function availableFalClips(env, actor, { owner = false, now = Date.now() } = {}) {
  if (env.VIDEO_CHAT_FAL_PREVIEW !== 'enabled' || !env.FAL_KEY || !env.VIDEO_CHAT_QUOTAS?.prepare)
    return { limit: 0, reason: 'configuration' };
  if (!/^[a-f0-9]{64}$/.test(actor ?? '')) return { limit: 0, reason: 'quota_unavailable' };
  if (owner === true) return { limit: 5, reason: null };
  let timer;
  try {
    const day = Math.floor(now / DAY) * DAY;
    const pending = env.VIDEO_CHAT_QUOTAS.prepare(`SELECT
      (SELECT COALESCE(SUM(attempts), 0) FROM ${PUBLIC_ROWS} WHERE actor = ?) AS attempts,
      (SELECT COALESCE(SUM(attempts), 0) FROM video_chat_fal_daily_attempts WHERE day = ?) AS dailyAttempts`).bind(actor, day).first();
    const row = await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Allowance snapshot timed out')), 150);
    })]);
    if (!row || !['attempts', 'dailyAttempts'].every(key => Number.isSafeInteger(row[key]) && row[key] >= 0))
      return { limit: 0, reason: 'quota_unavailable' };
    const personalRemaining = Math.max(0, PUBLIC_LIFETIME_CLIPS - row.attempts);
    const dailyRemaining = Math.max(0, cap(env.VIDEO_CHAT_FAL_DAILY_CLIP_LIMIT, PUBLIC_DAILY_CLIPS) - row.dailyAttempts);
    const limit = Math.min(personalRemaining, dailyRemaining);
    return { limit, reason: limit ? null : personalRemaining === 0 ? 'user_limit' : 'preview_limit' };
  } catch { return { limit: 0, reason: 'quota_unavailable' }; }
  finally { clearTimeout(timer); }
}

export async function reserveFalAnswer(db, actor, _env = {}, now = Date.now()) {
  void _env;
  const id = crypto.randomUUID();
  const result = await db.prepare(FAL_RESERVE_SQL).bind(id, actor, now, actor).run();
  return result.meta?.changes === 1 ? id : null;
}
// Caller must verify the owner's Access identity before using this entry point.
// Owner answers are separate from the permanent public preview ledger.
export async function reserveOwnerFalAnswer(db, actor) {
  if (!/^[a-f0-9]{64}$/.test(actor ?? '')) return null;
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO video_chat_owner_fal_previews(id, actor, created) VALUES (?, ?, ?)`)
    .bind(id, actor, Date.now()).run();
  return result.meta?.changes === 1 ? id : null;
}
// Triggers independently enforce the hard daily and shared lifetime ceilings
// for every worker version. This condition also honors a tighter configured pool.
function publicAttemptSql(table, answerLimit) {
  return `UPDATE ${table} SET attempts = attempts + 1
WHERE id = ? AND actor = ? AND attempts < ${answerLimit}
AND (SELECT COALESCE(SUM(attempts), 0) FROM ${PUBLIC_ROWS} WHERE actor = ?) < ${PUBLIC_LIFETIME_CLIPS}
AND (SELECT COALESCE(SUM(attempts), 0) FROM video_chat_fal_daily_attempts WHERE day = ${CURRENT_DAY_SQL}) < ?`;
}
const PUBLIC_ATTEMPT_SQL = [
  publicAttemptSql('video_chat_fal_reservations', PUBLIC_LIFETIME_CLIPS),
  publicAttemptSql('video_chat_fal_answers', 3),
  publicAttemptSql('video_chat_fal_previews', 5),
];
const OWNER_ATTEMPT_SQL = `UPDATE video_chat_owner_fal_previews SET attempts = attempts + 1
WHERE id = ? AND actor = ? AND attempts < 5`;
async function reserveClip(env, actor, previewId, owner) {
  const db = env.VIDEO_CHAT_QUOTAS;
  if (owner === true) {
    const result = await db.prepare(OWNER_ATTEMPT_SQL).bind(previewId, actor).run();
    return result.meta?.changes === 1;
  }
  const dailyLimit = cap(env.VIDEO_CHAT_FAL_DAILY_CLIP_LIMIT, PUBLIC_DAILY_CLIPS);
  // IDs are server UUIDs. Include old in-flight public reservations, respecting
  // their original CHECK constraints; the owner ledger is never consulted here.
  for (const query of PUBLIC_ATTEMPT_SQL) {
    const result = await db.prepare(query).bind(previewId, actor, actor, dailyLimit).run();
    // D1 includes AFTER-trigger writes in changes. A denied UPDATE performs
    // no writes; a successful one changes its reservation and the daily pool.
    if (Number.isSafeInteger(result.meta?.changes) && result.meta.changes > 0) return true;
  }
  return false;
}

class DiagnosticError extends Error {
  constructor(reason, httpStatus) {
    super(reason);
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}
function parsedUrl(value) {
  try { return new URL(value); }
  catch { throw new DiagnosticError('invalid_metadata'); }
}
function queueUrl(value) {
  const url = parsedUrl(value);
  if (url.protocol !== 'https:' || url.host !== 'queue.fal.run' || url.username || url.password || url.hash) throw new DiagnosticError('invalid_metadata');
  return url.href;
}
function mediaUrl(value) {
  const url = parsedUrl(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) throw new DiagnosticError('invalid_metadata');
  return url.href;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function json(response) {
  if (!response.ok) throw new DiagnosticError('provider_http', response.status);
  if (!response.body) throw new DiagnosticError('invalid_metadata');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) throw new DiagnosticError('invalid_metadata');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new DiagnosticError('invalid_metadata'); }
  } finally { await reader.cancel().catch(() => {}); }
}

// Wall-clock phases include HTTP body reads. Poll sleep overlaps provider work.
export async function generateFalPreview(query, options) {
  const started = performance.now();
  const bounded = value => Math.min(150000, Math.max(0, Math.round(value)));
  const values = {quotaMs:0, submitMs:0, statusHttpMs:0, resultHttpMs:0, pollSleepMs:0, cancelMs:0, pollCount:0};
  const timing = {
    async measure(key, operation) {
      const start = performance.now();
      try { return await operation(); }
      finally { values[key] = bounded(values[key] + performance.now() - start); }
    },
    poll() { values.pollCount = Math.min(1000, values.pollCount + 1); },
    status(status) {
      if (status?.status === 'IN_PROGRESS' && values.firstInProgressMs === undefined) values.firstInProgressMs = bounded(performance.now()-started);
      if (status?.status === 'COMPLETED' && values.firstCompletedMs === undefined) values.firstCompletedMs = bounded(performance.now()-started);
      if (status?.status === 'COMPLETED') this.seconds('runnerProcessingMs', status.metrics?.inference_time);
    },
    seconds(key, value) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) values[key] = bounded(value * 1000);
    },
  };
  let outcome = 'unavailable';
  try {
    const result = await generatePreview(query, timing, options);
    outcome = result.media ? 'ready' : result.reason === 'limit' ? 'limit' : 'unavailable';
    return result;
  } finally {
    try { Promise.resolve(options.onTiming?.({outcome,totalMs:bounded(performance.now()-started),...values})).catch(()=>{}); }
    catch { /* Timing cannot change provider behavior. */ }
  }
}

async function generatePreview(query, timing, { env, actor, previewId, signal, orientation, scene, generatedLook, fetcher = fetch, onDiagnostic, owner = false }) {
  const unavailable = { media: null, reason: 'unavailable' };
  let stage = 'preflight';
  let diagnosed = false;
  const report = (reason, httpStatus) => {
    if (diagnosed) return;
    diagnosed = true;
    // Construct only fixed, server-owned fields. Never forward Error objects,
    // prompts, URLs, provider messages, credentials or actor identifiers.
    const diagnostic = { reason, stage, ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}) };
    try { Promise.resolve(onDiagnostic?.(diagnostic)).catch(() => {}); }
    catch { /* Observability must not change playback or quota decisions. */ }
  };
  if (signal?.aborted) { report('cancelled'); return unavailable; }
  if (env.VIDEO_CHAT_FAL_PREVIEW !== 'enabled' || !env.FAL_KEY || !env.VIDEO_CHAT_QUOTAS?.prepare) {
    report('configuration'); return unavailable;
  }
  if (!/^[a-f0-9]{64}$/.test(actor ?? '') || typeof query !== 'string' || !query.trim() || query.length > 2000) {
    report('invalid_input'); return unavailable;
  }
  let prompt;
  try { prompt = compileShotPrompt(query, { scene, generatedLook, orientation }); }
  catch { report('invalid_input'); return unavailable; }
  if (typeof previewId !== 'string' || !/^[a-f0-9-]{36}$/.test(previewId)) {
    report('quota_limit'); return { media: null, reason: 'limit' };
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Preview timeout')); }, 15000);
  const headers = { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json', 'X-Fal-No-Retry': '1', 'X-Fal-Request-Timeout': '90' };
  let cancelUrl;
  let completed = false;
  try {
    // Reservations are permanent, including submission errors and cancellation.
    // Never retry a submission whose billing outcome may be uncertain.
    stage = 'quota';
    if (!await timing.measure('quotaMs', () => reserveClip(env, actor, previewId, owner))) { report('quota_limit'); return { media: null, reason: 'limit' }; }
    controller.signal.throwIfAborted();
    stage = 'submit';
    const submitted = await timing.measure('submitMs', async () => json(await fetcher(SUBMIT, {
      method: 'POST', headers, redirect: 'manual', signal: controller.signal,
      body: JSON.stringify({
        prompt, duration: 5,
        resolution: '768P', aspect_ratio: orientation === 'portrait' ? '9:16' : '16:9',
        prompt_expansion_mode: 'balanced', enable_safety_checker: true,
        sync_mode: false,
      }),
    })));
    // Validate before attaching credentials. Returned URLs are not trusted.
    if (!submitted || typeof submitted !== 'object') throw new DiagnosticError('invalid_metadata');
    cancelUrl = queueUrl(submitted.cancel_url);
    const statusUrl = queueUrl(submitted.status_url);
    const responseUrl = queueUrl(submitted.response_url);
    while (true) {
      controller.signal.throwIfAborted();
      stage = 'queue';
      timing.poll();
      const status = await timing.measure('statusHttpMs', async () => json(await fetcher(statusUrl, { headers, redirect: 'manual', signal: controller.signal })));
      timing.status(status);
      if (!status || typeof status !== 'object') throw new DiagnosticError('invalid_metadata');
      if (status.status === 'COMPLETED') {
        completed = true;
        if (status.error || status.error_type) { report('provider_failed'); return unavailable; }
        stage = 'result';
        const result = await timing.measure('resultHttpMs', async () => json(await fetcher(responseUrl, { headers, redirect: 'manual', signal: controller.signal })));
        timing.seconds('gpuInferenceMs', result?.timings?.inference);
        return { media: { type: 'video', url: mediaUrl(result?.video?.url), audio: 'ambient' }, reason: null };
      }
      if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw new DiagnosticError('invalid_metadata');
      await timing.measure('pollSleepMs', () => sleep(1500, controller.signal));
    }
  } catch (cause) {
    report(timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : stage === 'quota' ? 'quota_unavailable' :
      cause instanceof DiagnosticError ? cause.reason : 'network_error',
      cause instanceof DiagnosticError ? cause.httpStatus : undefined);
    return unavailable;
  }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (cancelUrl && !completed) {
      // Cancellation may lose a race with billing. The reserved allowance stays used.
      const cancel = new AbortController();
      const timeout = setTimeout(() => cancel.abort(), 3000);
      try { await timing.measure('cancelMs', () => fetcher(cancelUrl, { method: 'PUT', headers, redirect: 'manual', signal: cancel.signal })); }
      catch { /* Best effort; do not expose provider errors or credentials. */ }
      finally { clearTimeout(timeout); }
    }
  }
}
