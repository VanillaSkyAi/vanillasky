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
 it.each(["fictional-brief-label", "imaginary-outline-label"])("recovers a fully valid first brief labeled %s without losing authored beats", async type => {
  const shots = [shot, { ...shot, narration: "A small green shoot reaches toward the sun." }, { ...shot, narration: "Flowers fill the garden as neighbours gather." }];
  const result = await run({ parts: [{ ...brief, type }, ...shots] });
  expect(result.scenes.map(scene => scene.narration)).toEqual([...shots.map(scene => scene.narration), ending.narration]);
  expect(result.scenes.every(scene => scene.templateId === "cinemaMedia")).toBe(true);
  expect(result.calls).toHaveLength(4);
  expect(result.errors).toEqual([]);
  expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
 });
 it.each([
  { opening: undefined }, { subject: 42 }, { development: [] }, { visualDirection: "x".repeat(601) },
  { opening: "x".repeat(301) }, { subject: "x".repeat(81) }, { development: "x".repeat(2001) },
  { visualDirection: {} }, { ending: { ...ending, subject: 42 } }, { ending: { ...ending, action: "x".repeat(601) } },
  { opening: " " }, { ending: null }, { ending: { ...ending, narration: "x".repeat(2001) } },
  { ending: { ...ending, action: false } }, { ending: { ...ending, durationSec: "5" } },
  { ending: { ...ending, continuity: "unknown" } }, { ending: { ...ending, title: "x".repeat(66) } },
  { type: "shot" }, { type: undefined }, { type: 7 },
 ])("does not recover a mislabeled first brief with invalid content %j", async invalid => {
  const result = await run({ parts: [{ ...brief, type: "fictional-brief-label", ...invalid }, shot] });
  expect(result.scenes).toEqual([]);
  expect(result.calls).toEqual([]);
  expect(result.errors).toContain("Chat shot arrived before its answer brief");
 });
 it("does not recover a later mislabeled brief after a rejected record", async () => {
  const result = await run({ parts: [[], { ...brief, type: "fictional-brief-label" }, shot] });
  expect(result.scenes).toEqual([]);
  expect(result.calls).toEqual([]);
 });
 it("does not replace a canonical brief with a later mislabeled brief", async () => {
  const result = await run({ parts: [brief, { ...brief, type: "fictional-brief-label", ending: { ...ending, narration: "Wrong ending." } }, shot] });
  expect(result.scenes.map(scene => scene.narration)).toEqual([shot.narration, ending.narration]);
  expect(result.errors).toContain("Chat plan requires an answer brief followed by shots");
 });
 it("recovers a complete single-ending brief with empty development", async () => {
  const result = await run({ allowance: 1, parts: [{ ...brief, type: "fictional-brief-label", development: "" }] });
  expect(result.scenes.map(scene => scene.narration)).toEqual([ending.narration]);
  expect(result.calls).toHaveLength(1);
  expect(result.errors).toEqual([]);
 });
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

it('uses a bounded authored subject when the chapter title is absent', async () => {
 const subject = 'miniature copper gardener arranging spectacular chrysanthemums beside windows';
 const result = await run({allowance:0,parts:[brief,{...shot,subject}]});
 expect(result.scenes[0]).toMatchObject({templateId:'chapterTitle',variables:{title:'miniature copper gardener arranging spectacular chrysanthemums'},narration:shot.narration});
 expect(result.calls).toEqual([]);
});
it('retains the authored answer subject when a spoken beat has no visual direction', async () => {
 const result = await run({allowance:0,parts:[brief,{...shot,subject:undefined,action:undefined}]});
 expect(result.scenes[0]).toMatchObject({variables:{title:brief.subject},narration:shot.narration});
});
it('reports malformed content rather than inventing a generic chapter', async () => {
 const result = await run({allowance:0,parts:[{...brief,subject:undefined},{...shot,subject:undefined,title:42}]});
 expect(result.scenes.map(scene=>scene.narration)).toEqual([ending.narration]);
 expect(result.events.at(-1)).toMatchObject({type:'response.complete',data:{finishReason:'other'}});
 expect(JSON.stringify(result.scenes)).not.toContain('The next step');
});
