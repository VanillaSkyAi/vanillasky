import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlannerDiagnostics } from '../../functions/_video-chat/diagnostics.mjs';
import { providerStream } from '../../functions/_video-chat/provider.mjs';

test('planner diagnostics classify private errors without emitting their values', () => {
  const logs = [];
  const d = createPlannerDiagnostics('test-correlation', (event, data) => logs.push({ event, ...data }));
  d.onError(new SyntaxError('secret prompt https://private.invalid/key'));
  d.onError(new Error('Template variable secret-token is required'));
  d.onError(new Error('plan part.scenes.secret-token invalid https://private.invalid'));
  d.onError(new Error('The planner stream ended before plan.complete'));
  d.onError(new Error('unclassified secret-token'));
  d.onWarning({ code: 'provider_warning', message: 'Some generated content was skipped.', private: 'secret-token' });
  d.onComplete({ acceptedSceneCount: 1, rejectedSceneCount: 2, finishReason: 'other', totalDurationMs: 100, providerMetadata: { secret: 'secret-token' } });
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /secret|private\.invalid|Template variable|plan part/);
  assert.match(serialized, /plan_json_invalid/);
  assert.match(serialized, /template_required_missing/);
  assert.match(serialized, /plan_schema_invalid/);
  assert.equal(logs.at(-1).acceptedSceneCount, 1);
  assert.equal(logs.at(-1).rejectedSceneCount, 2);
});

test('diagnostics bound event volume and counts; logging failure never breaks responses', () => {
  const logs = [];
  const d = createPlannerDiagnostics('test', (event, data) => logs.push({ event, ...data }));
  for (let n = 0; n < 100; n++) d.onError(new Error('unknown'));
  d.onComplete({ acceptedSceneCount: Infinity, rejectedSceneCount: -1, finishReason: 'secret', totalDurationMs: 1e20 });
  d.finish(); d.finish();
  assert.equal(logs.length, 2);
  assert.equal(logs[1].finishReason, 'unknown');
  assert.equal(logs[1].totalDurationMs, 150000);
  const throwing = createPlannerDiagnostics('test', () => { throw Error('logger failed'); });
  assert.doesNotThrow(() => { throwing.onError(new Error('unknown')); throwing.finish(); });
});

test('provider stream reports only bounded completion metadata and leaves text unchanged', async () => {
  const reports = [];
  const records = [
    { type: 'message_start', message: { usage: { input_tokens: 9 }, content: 'secret' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'private model text' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4096 }, private: 'secret' },
  ];
  const fetcher = async () => new Response(records.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  const context = { systemPrompt: 'private', userPrompt: 'private', signal: new AbortController().signal };
  let output = '';
  for await (const text of providerStream(context, {}, fetcher, event => reports.push(event))) output += text;
  assert.equal(output, 'private model text');
  assert.deepEqual(reports, [{ outcome: 'complete', stopReason: 'max_tokens', inputTokens: 9, outputTokens: 4096 }]);
});

test('provider failure and unknown completion values remain private', async () => {
  const reports = [];
  const context = { systemPrompt: 'Test', userPrompt: 'Test', signal: new AbortController().signal };
  const fetcher = async () => new Response([
    { type: 'message_delta', delta: { stop_reason: 'private-secret' }, usage: { output_tokens: 1e20 } },
    { type: 'error', error: { message: 'private-secret' } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  await assert.rejects(async () => { for await (const text of providerStream(context, {}, fetcher, event => reports.push(event))) { assert.equal(typeof text, "string"); } }, /Provider stream failed/);
  assert.deepEqual(reports, [{ outcome: 'error', stopReason: 'unknown', inputTokens: 0, outputTokens: 4096 }]);
});

test('terminal-order errors and rejected parts retain distinct static classifications', () => {
  const logs = [];
  const d = createPlannerDiagnostics('test', (_event, data) => logs.push(data));
  d.onError(new Error('The planner emitted content after plan.complete'));
  d.onError(new Error('The planner emitted plan.complete more than once'));
  d.onError(new Error('A media scene without a usable asset requires grounded fallbackText (1–65 characters)'));
  d.onComplete({ acceptedSceneCount: 0, rejectedSceneCount: 3, finishReason: 'error' });
  assert.deepEqual(logs.slice(0, 3).map(event => event.code), ['plan_content_after_complete', 'plan_duplicate_complete', 'media_missing_fallback']);
  assert.equal(logs.at(-1).acceptedSceneCount, 0);
  assert.equal(logs.at(-1).rejectedSceneCount, 3);
});

test('runtime timing diagnostics retain only bounded enums, counts and anonymous shot numbers', () => {
  const logs=[];
  const diagnostics=createPlannerDiagnostics('host-request', (event,data)=>logs.push({event,...data}));
  diagnostics.onDiagnostic({requestId:'private-user-prompt',mode:'pexels',phase:'media-end',elapsedMs:125.9,durationMs:94.3,sceneId:'private-topic-shot-2',reason:'ready',prompt:'secret',url:'https://private.invalid',body:{key:'secret'}});
  assert.deepEqual(logs,[{event:'video-chat.timing',requestId:'host-request',mode:'pexels',phase:'media-end',elapsedMs:125,durationMs:94,shot:2,reason:'ready'}]);
  diagnostics.onDiagnostic({mode:'private',phase:'private',elapsedMs:Infinity,sceneId:'private',reason:'secret'});
  assert.equal(logs.length,1);
  diagnostics.onDiagnostic({mode:'cinematic',phase:'media-skipped',elapsedMs:1e20,durationMs:-3,sceneId:'secret-shot-99999',reason:'secret'});
  assert.deepEqual(logs[1],{event:'video-chat.timing',requestId:'host-request',mode:'cinematic',phase:'media-skipped',elapsedMs:150000});
  for(let i=0;i<200;i++)diagnostics.onDiagnostic({mode:'cinematic',phase:'shot-authored',elapsedMs:i});
  assert.equal(logs.length,64);
  assert.doesNotMatch(JSON.stringify(logs),/private|secret/);
  assert.doesNotThrow(()=>createPlannerDiagnostics('host',()=>{throw Error();}).onDiagnostic({mode:'cinematic',phase:'request-accepted',elapsedMs:0}));
});

test('narration-fit diagnostics retain bounded speech budgets without private content', () => {
  const logs = [];
  const diagnostics = createPlannerDiagnostics('host-request', (event, data) => logs.push({ event, ...data }));
  for (const reason of ['fit', 'rewritten', 'oversized']) {
    diagnostics.onDiagnostic({ mode: 'cinematic', phase: 'narration-fit', elapsedMs: 23.8,
      sceneId: 'private-topic-shot-2', estimatedSpeechSec: 3.4567, clipDurationSec: 5, reason,
      narration: 'private narration', providerMetadata: { secret: 'private key' } });
  }
  assert.deepEqual(logs, ['fit', 'rewritten', 'oversized'].map(reason => ({
    event: 'video-chat.timing', requestId: 'host-request', mode: 'cinematic',
    phase: 'narration-fit', elapsedMs: 23, shot: 2,
    estimatedSpeechSec: 3.46, clipDurationSec: 5, reason,
  })));
  diagnostics.onDiagnostic({ mode: 'cinematic', phase: 'narration-fit', elapsedMs: 1,
    estimatedSpeechSec: 1e20, clipDurationSec: -1, reason: 'private reason' });
  assert.deepEqual(logs.at(-1), { event: 'video-chat.timing', requestId: 'host-request',
    mode: 'cinematic', phase: 'narration-fit', elapsedMs: 1, estimatedSpeechSec: 3600 });
  diagnostics.onDiagnostic({ mode: 'cinematic', phase: 'narration-fit', elapsedMs: 2,
    estimatedSpeechSec: Infinity, clipDurationSec: 'private value' });
  assert.deepEqual(logs.at(-1), { event: 'video-chat.timing', requestId: 'host-request',
    mode: 'cinematic', phase: 'narration-fit', elapsedMs: 2 });
  assert.doesNotMatch(JSON.stringify(logs), /private|secret|narration"|providerMetadata/);
});

test('narration rewrite outcomes preserve bounded timing without narration or provider data', () => {
  const logs = [];
  const diagnostics = createPlannerDiagnostics('host-request', (event, data) => logs.push({ event, ...data }));
  const reasons = ['rewritten', 'empty', 'oversized', 'provider-error', 'timeout', 'cancelled'];
  for (const reason of reasons) {
    diagnostics.onDiagnostic({ requestId: 'private request', mode: 'cinematic', phase: 'narration-rewrite',
      elapsedMs: 31.9, durationMs: 12.7, clipDurationSec: 5.125, sceneId: 'private-topic-shot-3', reason,
      narration: 'private narration', error: new Error('private error'), providerMetadata: { secret: 'private key' } });
  }
  assert.deepEqual(logs, reasons.map(reason => ({ event: 'video-chat.timing', requestId: 'host-request',
    mode: 'cinematic', phase: 'narration-rewrite', elapsedMs: 31, durationMs: 12, clipDurationSec: 5.13, shot: 3, reason })));
  diagnostics.onDiagnostic({ mode: 'pexels', phase: 'narration-rewrite', elapsedMs: 1e20,
    durationMs: 1e20, clipDurationSec: 1e20, reason: 'private reason', sceneId: 'private scene' });
  assert.deepEqual(logs.at(-1), { event: 'video-chat.timing', requestId: 'host-request', mode: 'pexels',
    phase: 'narration-rewrite', elapsedMs: 150000, durationMs: 150000, clipDurationSec: 3600 });
  for (const value of [-1, Infinity, 'private value']) {
    diagnostics.onDiagnostic({ mode: 'cinematic', phase: 'narration-rewrite', elapsedMs: 1,
      durationMs: value, clipDurationSec: value });
    assert.deepEqual(logs.at(-1), { event: 'video-chat.timing', requestId: 'host-request', mode: 'cinematic',
      phase: 'narration-rewrite', elapsedMs: 1 });
  }
  assert.doesNotMatch(JSON.stringify(logs), /private|secret|narration"|providerMetadata/);
});

test('chat shape diagnostics whitelist structural categories without retaining rejected content', () => {
 const logs=[];const d=createPlannerDiagnostics('test',(_event,data)=>logs.push(data));
 const cause={code:'chat_plan_shape',shape:'object',discriminator:'missing',fields:{opening:true,subject:false,development:true,visualDirection:false,ending:true,secret:'private-token'},providerText:'private-token'};
 d.onError(new Error('Chat plan requires an answer brief followed by shots',{cause}));
 assert.deepEqual(logs,[{requestId:'test',kind:'error',code:'chat_plan_shape_invalid',shape:'object',discriminator:'missing',fields:{opening:true,subject:false,development:true,visualDirection:false,ending:true}}]);
 assert.doesNotMatch(JSON.stringify(logs),/private|secret|providerText/);
 d.finish();assert.deepEqual(logs.at(-1).errors,{chat_plan_shape_invalid:1});
});
test('unknown shape metadata never escapes generic diagnostics and logger errors remain isolated', () => {
 for(const cause of [{code:'chat_plan_shape',shape:'private-token',discriminator:'missing',fields:{}},{code:'private-token',shape:'object'},{code:'chat_plan_shape',shape:'object',discriminator:'private-token',fields:{}},'private-token']) {
  const logs=[];const d=createPlannerDiagnostics('test',(_event,data)=>logs.push(data));
  d.onError(new Error('Chat plan requires an answer brief followed by shots',{cause}));
  assert.deepEqual(logs,[{requestId:'test',kind:'error',code:'chat_plan_shape_invalid'}]);
 }
 const logs=[];createPlannerDiagnostics('test',(_event,data)=>logs.push(data)).onError(new Error('private-token',{cause:{code:'chat_plan_shape',shape:'object'}}));
 assert.deepEqual(logs,[{requestId:'test',kind:'error',code:'unclassified_error'}]);
 assert.doesNotThrow(()=>createPlannerDiagnostics('test',()=>{throw Error('logger');}).onError(new Error('Chat plan requires an answer brief followed by shots')));
});
