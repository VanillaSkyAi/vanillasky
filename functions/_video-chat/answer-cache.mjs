import { encodeVideoSseEvent, videoSseHeaders } from "../../src/protocol/sse.ts";
import {
  MAX_CACHED_SPEECH_BYTES,
  MAX_RECORDED_ANSWER_BYTES,
  answerCacheMaterial,
  answerObjectKey,
  parseRecordedAnswer,
  replayAnswerEvents,
  replayMusic,
  speechObjectKey,
  suggestionsObjectKey,
} from "../../src/server/answer-cache.ts";

// Recordings are optional operator content. Without the bucket every request
// is live; with it, an exact match replays before any admission or spending.
export function configuredAnswerCache(env) {
  return typeof env?.VIDEO_CHAT_ANSWER_CACHE?.get === "function";
}

// Re-recording on a developer machine must observe the live answer, never a
// stale local recording. Remote requests cannot opt out of the cache.
export function bypassRequested(request, local) {
  return local && request.headers.get("x-vanillasky-answer-cache") === "bypass";
}

async function storedJson(env, key, maximum) {
  const object = await env.VIDEO_CHAT_ANSWER_CACHE.get(key);
  if (!object || object.size > maximum) return null;
  return object.json();
}

function report(diagnosticId, action, outcome) {
  // Server-owned classifications only; never prompts, keys or viewer identity.
  try { console.info("video-chat.answer-cache", { requestId: diagnosticId, action, outcome }); }
  catch { /* Diagnostics must not interrupt an answer. */ }
}

export async function cachedAnswerResponse({ env, body, origin, headers, diagnosticId }) {
  const material = answerCacheMaterial(body);
  if (!material) return null;
  let events;
  try {
    const stored = await storedJson(env, await answerObjectKey(material), MAX_RECORDED_ANSWER_BYTES);
    if (!stored) return null;
    events = replayAnswerEvents(parseRecordedAnswer(stored), { origin, music: replayMusic(body) });
  } catch {
    report(diagnosticId, "response", "invalid_recording");
    return null;
  }
  report(diagnosticId, "response", "hit");
  const encoder = new TextEncoder();
  const chunks = [...events.map((event) => encodeVideoSseEvent(event)), "data: [DONE]\n\n"];
  let index = 0;
  const responseHeaders = videoSseHeaders();
  for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  responseHeaders.set("x-vanillasky-resolved-video-mode", "cinematic");
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
  }), { headers: responseHeaders });
}

async function cachedJsonResponse(env, key, maximum, headers) {
  if (!key) return null;
  const object = await env.VIDEO_CHAT_ANSWER_CACHE.get(key);
  if (!object || object.size > maximum) return null;
  return new Response(object.body, { headers: { ...headers, "content-type": "application/json" } });
}

export function cachedSuggestionsResponse({ env, body, headers }) {
  return suggestionsObjectKey(body).then((key) => cachedJsonResponse(env, key, MAX_RECORDED_ANSWER_BYTES, headers));
}

export function cachedSpeechResponse({ env, body, headers }) {
  return speechObjectKey(body).then((key) => cachedJsonResponse(env, key, MAX_CACHED_SPEECH_BYTES, headers));
}
