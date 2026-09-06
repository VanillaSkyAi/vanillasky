import { describe, expect, it } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";

const ending = { narration: "The robot finally shares its garden with the town.", subject: "robot flower garden", action: "Wide shot: the robot opens the garden gate for its neighbours.", durationSec: 5, continuity: "continue" };
const brief = { type: "answer", intent: "story", opening: "A lonely robot plants something unexpected.", subject: "robot garden", development: "A robot grows a garden and invites its neighbours.", visualDirection: "A small copper robot with a blue scarf, warm hand-built miniature world.", ending };
const shot = { type: "shot", narration: "A robot plants a seed beside its empty house.", subject: "robot planting seed", action: "Close shot: copper fingers lower a seed into damp soil.", durationSec: 5, continuity: "cut" };
async function run(options: { allowance?: number; miss?: boolean; parts?: unknown[] } = {}) {
 const calls: string[] = [], errors: string[] = [];
 let system = "", user = "";
 const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, maxGeneratedVideos: options.allowance ?? 5,
  generateText: () => "", generateVideo: (query) => { calls.push(`ai:${query}`); return options.miss ? null : { type: "video", url: "https://media.example/ai.mp4" }; },
  searchMedia: (query) => { calls.push(`stock:${query}`); return null; }, onError: e => errors.push(e.message),
  streamText: async function* (context) { system = context.systemPrompt; user = context.userPrompt; for (const part of options.parts ?? [brief, shot]) yield JSON.stringify(part) + "\n"; },
 });
 const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Tell me a short robot story", orientation: "portrait" }) }));
 const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
 return { events, calls, errors, system, user, scenes: events.flatMap(e => e.type === "scene.add" ? [e.data.scene] : []) };
}
describe("AI-first chat answer plan", () => {
 it("streams a uniform footage body and its authored ending without model lifecycle commands", async () => {
  const result = await run();
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
  expect(result.scenes.every(s => s.templateId === "cinemaMedia")).toBe(true);
  expect(result.calls).toEqual([`ai:${shot.subject}`, `ai:${ending.subject}`]);
  expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
  expect(result.errors).toEqual([]);
  expect(result.system).not.toContain("scene.add");
  expect(result.user).not.toContain("plan.complete");
 });
 it.each([0, 5])("preserves every narrated beat when both media providers miss, allowance %i", async allowance => {
  const result = await run({ allowance, miss: true });
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
  expect(result.scenes.every(s => s.templateId === "chapterTitle" && typeof s.variables.title === "string")).toBe(true);
  expect(result.calls.filter(c => c.startsWith("ai:"))).toHaveLength(allowance ? 2 : 0);
  expect(result.calls.filter(c => c.startsWith("stock:"))).toHaveLength(0);
 });
 it("keeps narration with malformed visual direction instead of losing the answer", async () => {
  const result = await run({ parts: [brief, { ...shot, subject: undefined, action: undefined }] });
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
 });
});

describe("shot plan recovery and compatibility", () => {
 it("reserves the authored ending when the model repeats it as a body shot", async () => {
  const result = await run({ parts: [brief, shot, { type: "shot", ...ending }] });
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
  expect(result.events.filter(e => e.type === "response.warning").map(e => e.data.warning.code)).not.toContain("plan_missing_closer");
 });
 it("retains valid body narration and reports an incomplete malformed ending", async () => {
  const result = await run({ parts: [{ ...brief, ending: { subject: "garden" } }, shot] });
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration]);
  expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "other" } });
  expect(result.events.some(e => e.type === "response.warning" && e.data.warning.code === "plan_incomplete")).toBe(true);
 });
 it("rejects model-authored lifecycle choices without stopping later valid content", async () => {
  const result = await run({ parts: [brief, { type: "plan.complete" }, shot] });
  expect(result.scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
  expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "other" } });
 });
 it("preserves a supplied custom registry's structured composition contract", async () => {
  const { createServerTemplateRegistry } = await import("../src/visual-system/catalog/server-kit");
  const { createMockVideoPlanner } = await import("../src/test/mock-video-planner");
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, templates: createServerTemplateRegistry({ templates: [] }), streamText: createMockVideoPlanner(), generateText: () => "" });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Show a useful result" }) }));
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
  expect(events.at(-1)?.type).toBe("response.complete");
  expect(events.filter(e => e.type === "scene.add").length).toBeGreaterThan(0);
 });
 it("releases opening wait when a provider throws before returning its stream", async () => {
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", streamText: () => { throw new Error("private detail"); } });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "A story" }) }));
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
  expect(events.at(-1)?.type).toBe("response.error");
  expect(JSON.stringify(events)).not.toContain("private detail");
 });
 it("preserves its reserved ending after an interrupted developing stream", async () => {
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", streamText: async function* () { yield JSON.stringify(brief) + "\n"; yield JSON.stringify(shot) + "\n"; throw new Error("private upstream failure"); } });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "A robot story" }) }));
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
  expect(events.flatMap(e => e.type === "scene.add" ? [e.data.scene.narration] : [])).toEqual([shot.narration, ending.narration]);
  expect(events.some(e => e.type === "response.warning" && e.data.warning.code === "plan_incomplete")).toBe(true);
 });
 it("emits the first resolved shot while later planning is still blocked", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(r => { release = r; });
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", generateVideo: () => ({ type: "video", url: "https://media.example/first.mp4" }), streamText: async function* () { yield JSON.stringify(brief) + "\n"; yield JSON.stringify(shot) + "\n"; await waiting; } });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "A robot story" }) }));
  const events = decodeVideoSse(response.body!)[Symbol.asyncIterator]();
  let first;
  for (;;) { const next = await events.next(); if (next.done) break; if (next.value.type === "scene.add") { first = next.value; break; } }
  expect(first).toMatchObject({ type: "scene.add", data: { scene: { narration: shot.narration } } });
  release(); while (!(await events.next()).done) { /* consume */ }
 });
});

it("keeps narrative order when later clips finish first", async () => {
 let releaseFirst!: () => void;
 const firstReady = new Promise<void>(r => { releaseFirst = r; });
 let secondStarted!: () => void;
 const secondReady = new Promise<void>(r => { secondStarted = r; });
 const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "",
  streamText: async function* () { yield JSON.stringify(brief) + "\n"; yield JSON.stringify(shot) + "\n"; },
  generateVideo: async query => { if (query === shot.subject) await firstReady; else secondStarted(); return { type: "video", url: `https://media.example/${query === shot.subject ? "first" : "ending"}.mp4` }; },
 });
 const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "A robot story" }) }));
 const events: unknown[] = [];
 const consuming = (async () => { for await (const e of decodeVideoSse(response.body!)) if (e.type === "scene.add") events.push(e.data.scene.narration); })();
 await secondReady;
 expect(events).toEqual([]);
 releaseFirst(); await consuming;
 expect(events).toEqual([shot.narration, ending.narration]);
});
it("preserves an overlong authored line without truncating its final qualifier", async () => {
 const narration = "This is a deliberately longer narration than a five-second clip can naturally support, and its essential final qualifier must remain intact.";
 const result = await run({ parts: [brief, { ...shot, narration }] });
 expect(result.scenes[0].narration).toBe(narration);
 expect(result.scenes[0].timing.fixedDuration).toBe(5);
});
it("allows a complete single-shot answer without requiring extra development", async () => {
 const result = await run({ parts: [{ ...brief, development: "" }] });
 expect(result.scenes).toHaveLength(1);
 expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
});
it("treats still images as unavailable body footage without losing speech", async () => {
 const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", maxGeneratedVideos: 0,
  searchMedia: () => ({ type: "image", url: "https://media.example/still.jpg" }),
  streamText: async function* () { yield JSON.stringify(brief) + "\n"; yield JSON.stringify(shot) + "\n"; },
 });
 const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "A robot story" }) }));
 const scenes = []; for await (const e of decodeVideoSse(response.body!)) if (e.type === "scene.add") scenes.push(e.data.scene);
 expect(scenes.map(s => s.narration)).toEqual([shot.narration, ending.narration]);
 expect(scenes.every(s => s.templateId === "chapterTitle" && typeof s.variables.title === "string")).toBe(true);
});
