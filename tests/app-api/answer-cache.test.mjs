import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { decodeVideoSse } from "../../src/protocol/sse.ts";
import { applyVideoEvent, createVideoState } from "../../src/protocol/state.ts";
import { checksumVideo } from "../../src/protocol/checksum.ts";
import { getMusicTrack } from "../../src/music-catalog.ts";
import { answerMediaUrls, answerObjectKey, clipObjectKey, linesFromEvents, recordAnswer, speechObjectKey, suggestionsObjectKey } from "../../src/server/answer-cache.ts";
import { handleVideoChatRequest } from "../../functions/api/video-chat.mjs";

function db() {
  const sql = new DatabaseSync(":memory:");
  for (const migration of ["0001_video_chat_quotas", "0002_fal_preview", "0004_public_fal_answers", "0005_double_public_fal_allowance", "0006_daily_public_clip_budget", "0003_owner_fal_previews"]) {
    sql.exec(readFileSync(new URL(`../../migrations/${migration}.sql`, import.meta.url), "utf8"));
  }
  return {
    sql,
    prepare(query) {
      return { bind(...args) { return {
        async first() { return sql.prepare(query).get(...args); },
        async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
      }; } };
    },
  };
}

// The subset of the R2 binding the application reads.
function bucket(objects = new Map()) {
  const entry = (key) => {
    const value = objects.get(key);
    if (value === undefined) return null;
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
    return { size: bytes.byteLength, httpEtag: `"${key}"`, httpMetadata: {}, body: new Blob([bytes]).stream(),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)), arrayBuffer: async () => bytes.buffer };
  };
  return { objects, reads: [], get(key) { this.reads.push(key); return entry(key); }, head(key) { return entry(key); } };
}

const PROMPT = "Why does the Moon rotate?";
const shot = (narration, subject) => ({ narration, subject, action: "The Moon turns in the dark sky.", durationSec: 5, continuity: "cut" });
const plannerLines = [
  { type: "answer", intent: "explanation", musicMood: "calm", opening: "The Moon turns in time with Earth", subject: "moon", development: "Rotation and orbit", visualDirection: "Consistent gray Moon illustration", ending: shot("Rotation stays in step.", "moon ending") },
  ...[0, 1].map((i) => ({ type: "shot", ...shot(`Orbit detail ${i}.`, `moon orbit ${i}`) })),
];
const plannerSse = plannerLines.map((line) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: JSON.stringify(line) + "\n" } })}\n\n`).join("");

function liveEnv(extra = {}) {
  return { ANTHROPIC_API_KEY: "test-only-value", VIDEO_CHAT_QUOTA_SALT: "test-salt-that-is-at-least-32-characters", VIDEO_CHAT_QUOTAS: db(),
    VIDEO_CHAT_FAL_PREVIEW: "enabled", FAL_KEY: "test-fal-secret", ...extra };
}

function providers(counter) {
  let clip = 0;
  return async (url, options) => {
    counter.calls++;
    if (url === "https://api.anthropic.com/v1/messages") return new Response(plannerSse);
    if (options?.method === "POST" && String(url).startsWith("https://queue.fal.run/")) {
      clip++;
      return Response.json({ request_id: `clip-${clip}`, status_url: `https://queue.fal.run/status/${clip}`, response_url: `https://queue.fal.run/result/${clip}`, cancel_url: "https://queue.fal.run/cancel" });
    }
    if (String(url).startsWith("https://queue.fal.run/status/")) return new Response('data: {"status":"COMPLETED"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    if (String(url).startsWith("https://queue.fal.run/result/")) return Response.json({ video: { url: `https://v3.fal.media/files/${String(url).split("/").at(-1)}.mp4` } });
    throw Error(`Unexpected provider URL ${url}`);
  };
}

const request = (origin, action, body, headers = {}) => new Request(`${origin}/api/video-chat?action=${action}`, {
  method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.1", ...headers }, body: JSON.stringify(body),
});

async function events(response) {
  const collected = [];
  for await (const event of decodeVideoSse(response.body)) collected.push(event);
  return collected;
}

// Record one real local answer the way the warm script does.
async function recording(t) {
  t.mock.method(console, "info", () => undefined);
  const counter = { calls: 0 };
  const env = liveEnv({ VIDEO_CHAT_LOCAL: "enabled" });
  const response = await handleVideoChatRequest({ request: request("http://127.0.0.1:8788", "response", { prompt: PROMPT, mode: "cinematic", initialTrackId: "florist" }), env, fetcher: providers(counter) });
  assert.equal(response.status, 200);
  const live = await events(response);
  const media = new Map(answerMediaUrls(live).map((url, index) => [url, clipObjectKey(String(index).padStart(64, "a"))]));
  assert.equal(media.size, 3);
  const recorded = recordAnswer(live, { request: { prompt: PROMPT, orientation: "landscape", conversation: [] }, recordedAt: "2026-09-11T00:00:00.000Z", commit: "abc", media });
  return { recorded, live };
}

test("a recorded answer replays for the public without admission, providers or spending", async (t) => {
  const { recorded, live } = await recording(t);
  const store = bucket(new Map([[await answerObjectKey(recorded.request), recorded]]));
  const counter = { calls: 0 };
  const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: store });
  const response = await handleVideoChatRequest({ request: request("https://example.com", "response", { prompt: `  ${PROMPT} `, mode: "cinematic", orientation: "landscape", conversation: [], musicMood: "auto", initialTrackId: "florist" }), env, fetcher: providers(counter) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vanillasky-resolved-video-mode"), "cinematic");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const replayed = await events(response);
  assert.equal(counter.calls, 0);
  assert.equal((await env.VIDEO_CHAT_QUOTAS.prepare("SELECT COUNT(*) AS count FROM video_chat_requests").bind().first()).count, 0);
  assert.equal(replayed.length, live.length);
  assert.deepEqual(replayed.map((event) => event.type), live.map((event) => event.type));
  const urls = replayed.filter((event) => event.type === "scene.add").map((event) => event.data.scene.variables.mediaUrl);
  assert.deepEqual(urls, [...recorded.events.filter((event) => event.type === "scene.add")].map((event) => `https://example.com${event.data.scene.variables.mediaUrl}`));
  assert.doesNotMatch(JSON.stringify(replayed), /fal\.media/);
  const prepared = replayed.filter((event) => event.type === "data.video-chat-preparation" && event.data.media);
  assert.equal(prepared.length, 3);
  for (const event of prepared) assert.match(event.data.media.url, /^https:\/\/example\.com\/api\/media\/clips\/a{63}[0-2]\.mp4$/);
  let state = createVideoState();
  for (const event of replayed) state = applyVideoEvent(state, event);
  const complete = replayed.at(-1);
  assert.equal(complete.type, "response.complete");
  assert.equal(complete.data.checksum, checksumVideo(state.config));
  assert.equal(complete.data.snapshot.audio.trackId, "florist");
  assert.equal(replayed.find((event) => event.type === "audio.set").data.audio.trackId, "florist");
});

test("replay follows each viewer's soundtrack preference like a live answer", async (t) => {
  const { recorded } = await recording(t);
  const store = bucket(new Map([[await answerObjectKey(recorded.request), recorded]]));
  const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: store });
  const ask = (music) => handleVideoChatRequest({ request: request("https://example.com", "response", { prompt: PROMPT, ...music }), env, fetcher: () => { throw Error("live"); } }).then(events);
  const upbeat = await ask({ musicMood: "upbeat", initialTrackId: "florist", previousTrackId: "cat-caffe" });
  assert.equal(getMusicTrack(upbeat.find((event) => event.type === "audio.set").data.audio.trackId).mood, "upbeat");
  assert.equal(upbeat.at(-1).data.snapshot.audio.trackId, "oceanside");
  const silent = await ask({ musicMood: "off" });
  assert.ok(!silent.some((event) => event.type === "audio.set"));
  assert.equal(silent.at(-1).data.snapshot.audio, undefined);
  assert.equal(silent.at(-1).data.checksum, checksumVideo(silent.at(-1).data.snapshot));
  assert.deepEqual(silent.map((event) => event.sequence), silent.map((_, index) => index));
});

test("requests a recording cannot answer stay live, including bypass from a developer machine", async (t) => {
  const { recorded } = await recording(t);
  const key = await answerObjectKey(recorded.request);
  const cases = [
    ["opening", { prompt: PROMPT, opening: "Spoken already" }],
    ["style", { prompt: PROMPT, style: { motion: "calm" } }],
    ["pexels", { prompt: PROMPT, mode: "pexels" }],
    ["orientation", { prompt: PROMPT, orientation: "portrait" }],
    ["conversation", { prompt: PROMPT, conversation: [{ prompt: "Earlier", response: "Answer" }] }],
    ["other prompt", { prompt: "Why does the Sun shine?" }],
  ];
  for (const [label, body] of cases) {
    const counter = { calls: 0 };
    const store = bucket(new Map([[key, recorded]]));
    const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: store, PEXELS_API_KEY: "test-stock" });
    const response = await handleVideoChatRequest({ request: request("https://example.com", "response", body), env, fetcher: providers(counter) });
    await response.text();
    assert.ok(counter.calls > 0, `${label} must reach the provider`);
    assert.equal(response.status, 200, label);
  }
  const counter = { calls: 0 };
  const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: bucket(new Map([[key, recorded]])), VIDEO_CHAT_LOCAL: "enabled" });
  const bypass = await handleVideoChatRequest({ request: request("http://127.0.0.1:8788", "response", { prompt: PROMPT }, { "x-vanillasky-answer-cache": "bypass" }), env, fetcher: providers(counter) });
  await bypass.text();
  assert.ok(counter.calls > 0);
  const remote = { calls: 0 };
  const remoteEnv = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: bucket(new Map([[key, recorded]])) });
  const kept = await handleVideoChatRequest({ request: request("https://example.com", "response", { prompt: PROMPT }, { "x-vanillasky-answer-cache": "bypass" }), env: remoteEnv, fetcher: providers(remote) });
  await kept.text();
  assert.equal(remote.calls, 0);
});

test("unusable recordings fall through to a live answer", async (t) => {
  const { recorded } = await recording(t);
  const key = await answerObjectKey(recorded.request);
  const withProviderMedia = { ...recorded, events: recorded.events.map((event) => event.type === "scene.add"
    ? { ...event, data: { ...event.data, scene: { ...event.data.scene, variables: { ...event.data.scene.variables, mediaUrl: "https://v3.fal.media/files/x.mp4" } } } } : event) };
  const incomplete = { ...recorded, events: recorded.events.map((event) => event.type === "response.complete" ? { ...event, data: { ...event.data, finishReason: "length" } } : event) };
  for (const stored of [
    "not json at all",
    { ...recorded, version: 2 },
    withProviderMedia,
    incomplete,
    { ...recorded, events: [] },
    new TextEncoder().encode(JSON.stringify(recorded) + " ".repeat(512_001)),
  ]) {
    const counter = { calls: 0 };
    const store = bucket(new Map([[key, typeof stored === "string" ? new TextEncoder().encode(stored) : stored]]));
    const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: store });
    const response = await handleVideoChatRequest({ request: request("https://example.com", "response", { prompt: PROMPT }), env, fetcher: providers(counter) });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(counter.calls > 0);
    assert.match(text, /fal\.media/);
  }
});

test("recorded suggestions and speech replay only for their exact inputs, speech only with generated voice", async (t) => {
  const { recorded } = await recording(t);
  assert.deepEqual(recorded.lines, ["The Moon turns in time with Earth", "Orbit detail 0.", "Orbit detail 1.", "Rotation stays in step."]);
  const suggestions = { suggestions: [{ prompt: "How far is the Moon?", media: null }] };
  const speech = { audio: "SUQz", mediaType: "audio/mpeg", wordTimings: [{ text: "Orbit", start: 0, end: 0.2 }, { text: "detail", start: 0.2, end: 0.4 }, { text: "0.", start: 0.4, end: 0.6 }] };
  const objects = new Map([
    [await suggestionsObjectKey({ prompt: PROMPT, lines: recorded.lines }), suggestions],
    [await speechObjectKey({ text: "Orbit detail 0." }), speech],
  ]);
  const fetcher = () => { throw Error("live"); };
  const env = liveEnv({ VIDEO_CHAT_ANSWER_CACHE: bucket(objects), XAI_API_KEY: "test-xai" });
  const hit = await handleVideoChatRequest({ request: request("https://example.com", "suggestions", { prompt: ` ${PROMPT}`, lines: recorded.lines.map((line) => ` ${line} `) }), env, fetcher });
  assert.equal(hit.status, 200);
  assert.deepEqual(await hit.json(), suggestions);
  const spoken = await handleVideoChatRequest({ request: request("https://example.com", "speech", { text: " Orbit detail 0. " }), env, fetcher });
  assert.equal(spoken.status, 200);
  assert.equal(spoken.headers.get("cache-control"), "no-store");
  assert.deepEqual(await spoken.json(), speech);
  assert.equal((await env.VIDEO_CHAT_QUOTAS.prepare("SELECT COUNT(*) AS count FROM video_chat_requests").bind().first()).count, 0);
  const silent = await handleVideoChatRequest({ request: request("https://example.com", "speech", { text: "Orbit detail 0." }), env: liveEnv({ VIDEO_CHAT_ANSWER_CACHE: bucket(objects) }), fetcher });
  assert.equal(silent.status, 204);
  let liveCalls = 0;
  const missLines = await handleVideoChatRequest({ request: request("https://example.com", "suggestions", { prompt: PROMPT, lines: recorded.lines.slice(1) }), env, fetcher: () => { liveCalls++; throw Error("live"); } });
  assert.deepEqual(await missLines.json(), { suggestions: [] });
  assert.equal(liveCalls, 1);
});

test("a recording carries the client's suggestion lines and rejects incomplete answers", async (t) => {
  const { live } = await recording(t);
  assert.deepEqual(linesFromEvents(live), ["The Moon turns in time with Earth", "Orbit detail 0.", "Orbit detail 1.", "Rotation stays in step."]);
  const media = new Map(answerMediaUrls(live).map((url) => [url, clipObjectKey("b".repeat(64))]));
  const request = { prompt: PROMPT, orientation: "landscape", conversation: [] };
  assert.throws(() => recordAnswer(live, { request, recordedAt: "now", media: new Map() }), /not copied/);
  assert.throws(() => recordAnswer(live.slice(0, -1), { request, recordedAt: "now", media }), /complete generated answer/);
  const warned = [...live.slice(0, 1), { ...live[0], type: "response.warning", data: { warning: { code: "media", category: "media", message: "x", recoverable: true } } }, ...live.slice(1)];
  assert.throws(() => recordAnswer(warned, { request, recordedAt: "now", media }), /complete generated answer/);
});
