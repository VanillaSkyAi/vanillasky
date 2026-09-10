import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
import { compileVisualDirection } from "../src/server/chat-visual-direction";

const brief = { type: "answer", intent: "story", musicMood: "calm",
  opening: "A robot plants something unexpected.", subject: "robot garden", development: "Plant, grow, then share.",
  visualDirection: "Copper robot, blue scarf, warm miniature garden." };
const shot = { type: "shot", title: "Planting", narration: "The robot plants a tiny seed.", subject: "robot planting",
  action: "Copper hands lower a seed into soil.", durationSec: 5, continuity: "cut" };
const nextShot = { ...shot, title: "Growing", narration: "Green shoots reach toward the sun.", subject: "garden shoots" };
const ending = { ...shot, type: "ending", title: "Sharing", narration: "The robot shares its garden with everyone.", subject: "shared garden" };
const records = [brief, shot, ending, nextShot];
const encode = (values: unknown[]) => values.map(value => JSON.stringify(value)).join("\n");
const media = { type: "video" as const, url: "https://media.example/garden.mp4", durationSec: 5 };
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
type Options = Parameters<typeof createVideoChatHandler>[0];
async function collect(response: Response) { const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event); return events; }
function setup(source: string | Options["streamText"], options: Partial<Options> = {}) {
  const errors: string[] = [];
  const generateVideo = vi.fn<NonNullable<Options["generateVideo"]>>(() => media);
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", generateVideo,
    onError: error => errors.push(error.message),
    streamText: typeof source === "string" ? async function* () { yield source; } : source,
    ...options,
  });
  const start = async (signal?: AbortSignal) => collect(await handler(new Request("https://app.example/?action=response", {
    method: "POST", body: JSON.stringify({ prompt: "Tell a robot garden story" }), signal,
  })));
  return { start, generateVideo, errors, handler };
}
const narrations = (events: Awaited<ReturnType<typeof collect>>) => events.flatMap(event => event.type === "scene.add" ? [event.data.scene.narration] : []);
const expectIncomplete = (events: Awaited<ReturnType<typeof collect>>) => {
  expect(events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "other" } });
  expect(events).toContainEqual(expect.objectContaining({ type: "response.warning", data: expect.objectContaining({ warning: expect.objectContaining({ code: "plan_incomplete" }) }) }));
};

describe("first shot before the authored ending", () => {
  it("starts and delivers the first footage while the provider is blocked before the ending, then preserves playback order", async () => {
    const waiting = gate();
    let endingSent = false;
    const test = setup(async function* () {
      yield encode([brief, shot]);
      await waiting.promise;
      endingSent = true;
      yield encode([ending, nextShot]);
    });
    const response = await test.handler(new Request("https://app.example/?action=response", { method: "POST", body: JSON.stringify({ prompt: "A robot garden story" }) }));
    const seen: Awaited<ReturnType<typeof collect>> = [];
    const consuming = (async () => { for await (const event of decodeVideoSse(response.body!)) seen.push(event); })();
    try {
      await vi.waitFor(() => expect(narrations(seen)).toEqual([shot.narration]));
      expect(test.generateVideo).toHaveBeenCalledOnce();
      expect(test.generateVideo.mock.calls[0]?.[1].generatedLook).toBe(compileVisualDirection({}).generatedLook);
      expect(endingSent).toBe(false);
    } finally { waiting.release(); await consuming; }
    expect(narrations(seen)).toEqual([shot.narration, nextShot.narration, ending.narration]);
    expect(test.generateVideo).toHaveBeenCalledTimes(3);
    expect(test.generateVideo.mock.calls.map(call => call[1].generatedLook)).toEqual(
      Array(3).fill(compileVisualDirection({}).generatedLook));
    expect(test.errors).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
  });

  it("stores the ending without starting its media before the rest of planning finishes", async () => {
    const waiting = gate();
    let endingSent = false;
    const test = setup(async function* () { yield encode([brief, shot, ending]); endingSent = true; await waiting.promise; yield encode([nextShot]); });
    const pending = test.start();
    try {
      await vi.waitFor(() => expect(endingSent).toBe(true));
      expect(test.generateVideo).toHaveBeenCalledOnce();
    } finally { waiting.release(); }
    expect(narrations(await pending)).toEqual([shot.narration, nextShot.narration, ending.narration]);
  });

  it("accepts a complete one-slot answer as brief then ending", async () => {
    const test = setup(encode([{ ...brief, development: "" }, ending]), { maxGeneratedVideos: 1 });
    const events = await test.start();
    expect(narrations(events)).toEqual([ending.narration]);
    expect(test.generateVideo).toHaveBeenCalledOnce();
    expect(test.errors).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
  });

  it.each([false, true])("retains the first valid ending and rejects a duplicate before paying for it (embedded=%s)", async embedded => {
    const duplicate = { ...ending, narration: "This second ending must never be generated.", subject: "duplicate ending" };
    const test = setup(encode(embedded ? [{ ...brief, ending }, shot, duplicate] : [brief, shot, ending, duplicate]));
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, ending.narration]);
    expect(test.generateVideo).toHaveBeenCalledTimes(2);
    expect(test.errors).toContain("Chat ending was emitted more than once");
    expectIncomplete(events);
  });

  it.each([false, true])("recovers a valid ending after an invalid one while reporting incomplete content (embedded=%s)", async embedded => {
    const invalid = { ...ending, narration: " ", subject: "invalid ending" };
    const test = setup(encode(embedded ? [{ ...brief, ending: invalid }, shot, ending] : [brief, shot, invalid, ending]));
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, ending.narration]);
    expect(test.generateVideo).toHaveBeenCalledTimes(2);
    expect(test.errors).toContain("Chat shot requires bounded authored narration");
    expectIncomplete(events);
  });

  it("rejects an ending before its brief without recovering it as a mislabeled brief", async () => {
    const test = setup(encode([{ ...brief, ...ending }, shot]));
    const events = await test.start();
    expect(test.errors).toContain("Chat ending arrived before its answer brief");
    expect(narrations(events)).toEqual([]);
    expect(test.generateVideo).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains only authored scenes when the provider fails (ending known=%s)", async known => {
    const test = setup(async function* () { yield encode([brief, shot, ...(known ? [ending] : [])]); throw new Error("private provider failure"); });
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, ...(known ? [ending.narration] : [])]);
    expect(test.generateVideo).toHaveBeenCalledTimes(known ? 2 : 1);
    expectIncomplete(events);
    expect(JSON.stringify(events)).not.toContain("private provider failure");
  });

  it("preserves the shared treatment after a planning interruption", async () => {
    const test = setup(async function* () {
      yield encode([brief, shot, ending]);
      throw new Error('private provider failure');
    });
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, ending.narration]);
    expect(test.generateVideo.mock.calls.map(call => call[1].generatedLook)).toEqual(
      Array(2).fill(compileVisualDirection({}).generatedLook));
    expectIncomplete(events);
  });

  it("marks a clean stream without an ending incomplete without inventing a closer", async () => {
    const test = setup(encode([brief, shot]));
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration]);
    expect(test.generateVideo).toHaveBeenCalledOnce();
    expectIncomplete(events);
  });

  it("reserves a duration slot for an ending that has not arrived", async () => {
    const bodies = Array.from({ length: 5 }, (_, index) => ({ ...shot, narration: `The robot plants seed ${index}.` }));
    const test = setup(encode([brief, ...bodies, ending]), { generatedClipDurationSec: 10 });
    const events = await test.start();
    expect(narrations(events)).toEqual([...bodies.slice(0, 3).map(body => body.narration), ending.narration]);
    expect(test.generateVideo).toHaveBeenCalledTimes(4);
    expect(test.errors.filter(error => error === "Chat shot exceeds the answer duration budget")).toHaveLength(2);
    expectIncomplete(events);
  });

  it("rejects a late ending that duplicates any dispatched body instead of presenting it as a distinct closer", async () => {
    const test = setup(encode([brief, shot, nextShot, { ...shot, type: "ending" }]));
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, nextShot.narration]);
    expect(test.generateVideo).toHaveBeenCalledTimes(2);
    expect(test.errors).toContain("Chat ending repeats an already dispatched shot");
    expectIncomplete(events);
  });

  it("cancels a pending first job without dispatching an ending after cancellation", async () => {
    const waiting = gate(), started = gate();
    let mediaSignal: AbortSignal | undefined;
    const generated = vi.fn<NonNullable<Options["generateVideo"]>>((_query, context) => { mediaSignal = context.signal; started.release(); return new Promise<null>(() => undefined); });
    const test = setup(async function* () { yield encode([brief, shot]); await waiting.promise; yield encode([ending]); }, { generateVideo: generated });
    const controller = new AbortController();
    const pending = test.start(controller.signal);
    await started.promise;
    controller.abort();
    waiting.release();
    const events = await pending;
    expect(events.at(-1)?.type).toBe("response.abort");
    expect(narrations(events)).toEqual([]);
    expect(generated).toHaveBeenCalledOnce();
    expect(mediaSignal?.aborted).toBe(true);
  });
});

describe("atomic arrays and bounded compact brief recovery", () => {
  it.each([1, 17, 10000])("keeps complete flat arrays equivalent to standalone records across %i-character chunks", async chunkSize => {
    const baseline = setup(encode(records));
    const source = JSON.stringify(records, null, 2);
    const wrapped = setup(async function* () { for (let offset = 0; offset < source.length; offset += chunkSize) yield source.slice(offset, offset + chunkSize); });
    const expected = await baseline.start(), actual = await wrapped.start();
    expect(narrations(actual)).toEqual(narrations(expected));
    expect(narrations(actual)).toEqual([shot.narration, nextShot.narration, ending.narration]);
    expect(wrapped.errors).toEqual([]);
    expect(wrapped.generateVideo).toHaveBeenCalledTimes(3);
  });

  it.each([
    JSON.stringify(records).slice(0, -1),
    '["broken\n",' + encode(records) + ']',
    JSON.stringify([brief, shot, [ending]]),
    JSON.stringify({ records }),
  ])("does not dispatch any inner records from a truncated, malformed or nested container", async source => {
    const test = setup(source);
    const events = await test.start();
    expect(narrations(events)).toEqual([]);
    expect(test.generateVideo).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("response.error");
  });

  it("waits for the array close before any provider side effect", async () => {
    const waiting = gate();
    let partialSent = false;
    const test = setup(async function* () { yield JSON.stringify(records).slice(0, -1); partialSent = true; await waiting.promise; yield "]"; });
    const pending = test.start();
    try { await vi.waitFor(() => expect(partialSent).toBe(true)); expect(test.generateVideo).not.toHaveBeenCalled(); }
    finally { waiting.release(); }
    expect(narrations(await pending)).toEqual([shot.narration, nextShot.narration, ending.narration]);
  });

  it("recovers a complete compact brief with an unknown label", async () => {
    const test = setup(encode([{ ...brief, type: "outline" }, shot, ending]));
    const events = await test.start();
    expect(narrations(events)).toEqual([shot.narration, ending.narration]);
    expect(test.errors).toEqual([]);
  });

  it.each([{ opening: undefined }, { subject: undefined }, { development: undefined }, { visualDirection: undefined },
    { opening: " " }, { subject: "x".repeat(81) }, { development: "x".repeat(2001) }, { visualDirection: "x".repeat(601) }, { ending: null },
  ])("does not recover a compact brief with missing or invalid fields %j", async invalid => {
    const test = setup(encode([{ ...brief, type: "outline", ...invalid }, shot, ending]));
    const events = await test.start();
    expect(narrations(events)).toEqual([]);
    expect(test.generateVideo).not.toHaveBeenCalled();
  });
});
