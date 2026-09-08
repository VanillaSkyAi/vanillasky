// Never serialize errors or provider data: even validation messages contain user input.
const ERROR_RULES = [
  [/^Chat answer brief was emitted more than once$/, 'chat_duplicate_brief'],
  [/^Chat plan requires an answer brief followed by shots$/, 'chat_plan_shape_invalid'],
  [/^Chat shot arrived before its answer brief$/, 'chat_missing_brief'],
  [/^Chat shot requires bounded authored narration$/, 'chat_narration_invalid'],
  [/^Chat shot exceeds the answer duration budget$/, 'chat_duration_exceeded'],
  [/^A media scene without a usable asset requires grounded fallbackText \(1–65 characters\)$/, 'media_missing_fallback'],
  [/^Template variable .* is required$/, 'template_required_missing'],
  [/^Template variable .* is not declared$/, 'template_field_unknown'],
  [/^Template variable /, 'template_value_invalid'],
  [/^Scene template .* was not negotiated$/, 'template_not_negotiated'],
  [/^Template .* is not installed$/, 'template_not_installed'],
  [/^plan part\./, 'plan_schema_invalid'],
  [/^The planner stream ended before plan.complete$/, 'plan_missing_complete'],
  [/^The planner emitted content after plan.complete$/, 'plan_content_after_complete'],
  [/^The planner emitted plan.complete more than once$/, 'plan_duplicate_complete'],
  [/^The LLM adapter returned a non-text delta$/, 'adapter_non_text'],
  [/^The model provider finished with an error$/, 'provider_finish_error'],
  [/^The model provider requested unsupported tool calls$/, 'provider_tool_calls'],
  [/^Provider stream failed$/, 'provider_stream_failed'],
  [/^Provider unavailable$/, 'provider_unavailable'],
];
const FINISH = new Set(['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other', 'unknown']);
const WARNINGS = new Set(['plan_missing_closer', 'plan_incomplete', 'provider_warning', 'media_budget_reached']);
const TIMING_PHASES = new Set(['request-accepted', 'opening-authored', 'shot-authored', 'media-start', 'media-end', 'media-skipped', 'narration-fit', 'narration-rewrite']);
const TIMING_REASONS = new Set(['ready', 'empty', 'provider-error', 'timeout', 'cancelled', 'allowance', 'deadline', 'not-configured', 'fit', 'rewritten', 'oversized']);
const count = (value, limit = 1000) => Number.isFinite(value) && value >= 0 ? Math.min(limit, Math.floor(value)) : 0;
const seconds = value => Math.round(Math.min(3600, value) * 100) / 100;

function shapeDetails(error) {
  const cause = error?.cause;
  const fieldNames = ['opening', 'subject', 'development', 'visualDirection', 'ending'];
  if (error?.message !== 'Chat plan requires an answer brief followed by shots' ||
    cause?.code !== 'chat_plan_shape' ||
    !['object', 'array', 'null', 'string', 'number', 'boolean'].includes(cause.shape) ||
    !['missing', 'answer', 'shot', 'other-string', 'non-string'].includes(cause.discriminator) ||
    !fieldNames.every(field => typeof cause.fields?.[field] === 'boolean')) return {};
  return { shape: cause.shape, discriminator: cause.discriminator,
    fields: Object.fromEntries(fieldNames.map(field => [field, cause.fields[field]])) };
}

export function createPlannerDiagnostics(requestId, log = (event, data) => console.info(event, data)) {
  const errors = new Map();
  const warnings = new Map();
  let emitted = 0;
  let completed = false;
  let timingEvents = 0;
  let provider;
  const emit = (event, data) => {
    try { log(event, { requestId, ...data }); } catch { /* Logging cannot affect playback. */ }
  };
  const record = (map, code, kind, details = {}) => {
    map.set(code, Math.min(1000, (map.get(code) ?? 0) + 1));
    if (map.get(code) === 1 && emitted < 12) { emitted++; emit('video-chat.plan-diagnostic', { kind, code, ...details }); }
  };
  const onComplete = (summary = {}) => {
    if (completed) return;
    completed = true;
    emit('video-chat.plan-summary', {
      finishReason: FINISH.has(summary.finishReason) ? summary.finishReason : 'unknown',
      acceptedSceneCount: count(summary.acceptedSceneCount),
      rejectedSceneCount: count(summary.rejectedSceneCount),
      totalDurationMs: count(summary.totalDurationMs, 150000),
      timeToFirstSceneMs: count(summary.timeToFirstSceneMs, 150000),
      errors: Object.fromEntries(errors), warnings: Object.fromEntries(warnings),
      ...(provider ? { provider } : {}),
    });
  };
  return {
    onDiagnostic(event) {
      if (!event || timingEvents >= 64 || !TIMING_PHASES.has(event.phase) ||
        !['cinematic', 'pexels'].includes(event.mode)) return;
      timingEvents++;
      const matched = typeof event.sceneId === 'string' ? /-shot-(\d{1,3})$/.exec(event.sceneId) : null;
      emit('video-chat.timing', {
        mode: event.mode, phase: event.phase, elapsedMs: count(event.elapsedMs, 150000),
        ...(Number.isFinite(event.durationMs) && event.durationMs >= 0 ? { durationMs: count(event.durationMs, 150000) } : {}),
        ...(event.phase === 'narration-fit' && Number.isFinite(event.estimatedSpeechSec) && event.estimatedSpeechSec >= 0
          ? { estimatedSpeechSec: seconds(event.estimatedSpeechSec) } : {}),
        ...(['narration-fit', 'narration-rewrite'].includes(event.phase) && Number.isFinite(event.clipDurationSec) && event.clipDurationSec >= 0
          ? { clipDurationSec: seconds(event.clipDurationSec) } : {}),
        ...(matched ? { shot: Number(matched[1]) } : {}),
        ...(TIMING_REASONS.has(event.reason) ? { reason: event.reason } : {}),
      });
    },
    onError(error) {
      const message = error instanceof Error ? error.message : '';
      const code = error instanceof SyntaxError ? 'plan_json_invalid'
        : ERROR_RULES.find(([pattern]) => pattern.test(message))?.[1] ?? 'unclassified_error';
      record(errors, code, 'error', shapeDetails(error));
    },
    onWarning(warning) {
      let code = WARNINGS.has(warning?.code) ? warning.code : 'other_warning';
      if (code === 'provider_warning') code = warning.message === 'Some generated content was skipped.' ? 'generated_content_skipped'
        : warning.message === 'Some visuals use a simple background.' ? 'media_simple_background' : 'provider_warning';
      record(warnings, code, 'warning');
    },
    onProvider(event) {
      // The provider adapter supplies only enums/counts; whitelist again at the sink.
      provider = {
        outcome: ['complete', 'error', 'canceled'].includes(event.outcome) ? event.outcome : 'unknown',
        stopReason: ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal'].includes(event.stopReason) ? event.stopReason : 'unknown',
        inputTokens: count(event.inputTokens, 100000), outputTokens: count(event.outputTokens, 4096),
      };
    },
    onComplete,
    finish: () => onComplete(),
  };
}
