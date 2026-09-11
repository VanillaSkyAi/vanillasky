import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { parseRecordedAnswer, recordAnswer, answerMediaUrls, clipObjectKey, answerObjectKey } from "../src/server/answer-cache";
import { decodeVideoSse } from "../src/protocol/sse";
import type { VideoEvent } from "../src/protocol/events";
import { conversationFor } from "../src/video-chat/session-state";
import { AnswerRecorder, exportPath, followUpMaterial, speechObject } from "../scripts/answer-cache/record";
import { exportedKeys } from "../scripts/answer-cache/publish";

const API = "http://127.0.0.1:8788";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function brief(answer: number) {
  return { type: "answer", musicMood: "calm", intent: "explanation", opening: `Opening ${answer}`, subject: "Moon",
    development: "", visualDirection: "A gray Moon.",
    ending: { title: "Ending", narration: `Ending line ${answer}.`, subject: "Moon", action: "The Moon turns.", durationSec: 5, continuity: "cut" } };
}

// The local API as the recorder sees it: real handler, doubles for every provider.
function localApi() {
  const calls: string[] = [];
  let answers = 0;
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    streamText: (context) => (async function* () {
      const answer = ++answers;
      calls.push(`plan:${context.userPrompt}`);
      yield JSON.stringify(brief(answer)) + "\n";
      yield JSON.stringify({ type: "shot", narration: `Detail ${answer}.`, subject: "Moon", action: "Turning.", durationSec: 5, continuity: "cut" }) + "\n";
    })(),
    generateText: (context) => { calls.push(`text:${context.task}`); return JSON.stringify({ suggestions: [{ prompt: "How far is it?", keyword: "moon" }, { prompt: "Why so bright?", keyword: "moon" }] }); },
    generateVideo: (query, context) => ({ type: "video" as const, url: `https://v3.fal.media/files/${encodeURIComponent(query)}-${context.scene?.id}.mp4`, audio: "ambient" as const }),
    generateSpeech: ({ text }) => { calls.push(`speech:${text}`); return { audio: new TextEncoder().encode(`mp3:${text}`), mediaType: "audio/mpeg" }; },
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://v3.fal.media/")) { calls.push(`clip:${url}`); return new Response(new TextEncoder().encode(`clip:${url}`)); }
    const action = new URL(url).searchParams.get("action");
    calls.push(`request:${action}`);
    const response = await handler(new Request(url, init));
    const headers = new Headers(response.headers);
    if (action === "response") headers.set("x-vanillasky-resolved-video-mode", "cinematic");
    return new Response(response.body, { status: response.status, headers });
  };
  return { fetcher, calls };
}

function exportDir() {
  const dir = mkdtempSync(join(tmpdir(), "answer-cache-"));
  dirs.push(dir);
  return dir;
}

test("a follow-up conversation equals what the client rebuilds from the completed turn", async () => {
  const { fetcher } = localApi();
  const response = await fetcher(`${API}/api/video-chat?action=response`, { method: "POST", body: JSON.stringify({ prompt: "Why does the Moon rotate?" }) });
  const events: VideoEvent[] = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  const media = new Map(answerMediaUrls(events).map((url) => [url, clipObjectKey("e".repeat(64))]));
  const recorded = recordAnswer(events, { request: { prompt: "Why does the Moon rotate?", orientation: "portrait", conversation: [] }, recordedAt: "2026-09-11T00:00:00.000Z", media });
  const followUp = followUpMaterial(recorded, "How far is it?");
  expect(followUp).toEqual({ prompt: "How far is it?", orientation: "portrait", conversation: [{ prompt: "Why does the Moon rotate?", response: recorded.lines.join(" ") }] });
  // The same client function, fed the client's own turn shape, must agree.
  const complete = events.at(-1)!;
  if (complete.type !== "response.complete") throw new Error("Answer did not complete");
  const clientTurn = { id: "t", prompt: "Why does the Moon rotate?", completed: true, orientation: "portrait" as const, fixedOrientation: true, suggestions: [],
    opening: "Opening 1", video: complete.data.snapshot };
  expect(conversationFor([clientTurn])).toEqual(followUp.conversation);
});

test("warming records answers, clips, speech, suggestions and depth-one follow-ups once, then reuses them", async () => {
  const { fetcher, calls } = localApi();
  const dir = exportDir();
  const recorder = new AnswerRecorder({ api: API, exportDir: dir, commit: "c".repeat(40), depth: 1, maxSuggestions: 1, attempts: 2, log: vi.fn(), fetcher });
  const material = { prompt: "Why does the Moon rotate?", orientation: "landscape" as const, conversation: [] };
  const recorded = await recorder.record(material);
  const keys = exportedKeys(dir);
  expect(keys.filter((key) => key.startsWith("answers/"))).toHaveLength(2);
  expect(keys.filter((key) => key.startsWith("suggestions/"))).toHaveLength(2);
  expect(keys.filter((key) => key.startsWith("clips/"))).toHaveLength(4);
  expect(keys.filter((key) => key.startsWith("speech/"))).toHaveLength(6);
  expect(readdirSync(dir).sort()).toEqual(["answers", "clips", "speech", "suggestions"]);
  const stored = parseRecordedAnswer(JSON.parse(readFileSync(exportPath(dir, await answerObjectKey(material)), "utf8")));
  expect(stored.commit).toBe("c".repeat(40));
  expect(stored.lines).toEqual(recorded.lines);
  expect(JSON.stringify(stored.events)).not.toContain("fal.media");
  const followUpKey = await answerObjectKey(followUpMaterial(recorded, "How far is it?"));
  const followUp = parseRecordedAnswer(JSON.parse(readFileSync(exportPath(dir, followUpKey), "utf8")));
  expect(followUp.request.conversation[0]?.response).toBe(recorded.lines.join(" "));
  expect(calls.filter((call) => call === "request:response")).toHaveLength(2);
  expect(calls.filter((call) => call.startsWith("plan:")).at(-1)).toContain(`RESPONSE: ${recorded.lines.join(" ")}`);
  const speech = JSON.parse(readFileSync(exportPath(dir, keys.find((key) => key.startsWith("speech/"))!), "utf8"));
  expect(speech.mediaType).toBe("audio/mpeg");
  expect(Buffer.from(speech.audio, "base64").toString()).toMatch(/^mp3:/);
  const before = calls.length;
  await recorder.record(material);
  expect(calls.slice(before)).toEqual([]);
});

test("speech responses are stored in the one JSON shape the client accepts", () => {
  const raw = JSON.parse(speechObject("audio/mpeg", new Uint8Array([73, 68, 51])));
  expect(raw).toEqual({ audio: "SUQz", mediaType: "audio/mpeg" });
  const timed = JSON.parse(speechObject("application/json; charset=utf-8", new TextEncoder().encode(JSON.stringify({ audio: "SUQz", mediaType: "audio/mpeg", wordTimings: [{ text: "Hi", start: 0, end: 0.3 }], extra: true }))));
  expect(timed).toEqual({ audio: "SUQz", mediaType: "audio/mpeg", wordTimings: [{ text: "Hi", start: 0, end: 0.3 }] });
  expect(() => speechObject("text/plain", new Uint8Array([1]))).toThrow();
});
