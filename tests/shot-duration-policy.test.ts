import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";

const brief = { type: "answer", opening: "Wind gives waves their energy.", subject: "ocean waves",
  development: "Follow the transfer, motion and result.", visualDirection: "Natural coastline." };
const shot = (narration: string, type = "shot") => ({ type, title: "Moving water", narration,
  subject: "ocean waves", action: "A wave passes a buoy.", durationSec: 999, continuity: "cut" });
const ending = shot("The energy reaches the shore.", "ending");
const encode = (parts: unknown[]) => parts.map(part => JSON.stringify(part)).join("\n");
type Options = Parameters<typeof createVideoChatHandler>[0];
const request = (mode = "cinematic") => new Request("https://app.example/?action=response", {
  method: "POST", body: JSON.stringify({ prompt: "Explain how waves move energy.", mode }),
});
async function collect(response: Response) {
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return events;
}
function setup(parts: unknown[], options: Partial<Options> = {}) {
  const errors: string[] = [];
  const generateVideo = vi.fn<NonNullable<Options["generateVideo"]>>((_query, context) => ({
    type: "video", url: "https://media.example/waves.mp4", durationSec: context.requestedDurationSec,
  }));
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
    generatedClipDurationSec: 8, firstGeneratedClipDurationSec: 5, maxGeneratedVideos: 5,
    generateVideo, generateText: () => "", onError: error => errors.push(error.message),
    streamText: async function* () { yield encode(parts); }, ...options,
  });
  return { handler, generateVideo, errors };
}
const scenes = (events: Awaited<ReturnType<typeof collect>>) => events.flatMap(event => event.type === "scene.add" ? [event.data.scene] : []);

describe("short first clip with longer development", () => {
  afterEach(() => vi.restoreAllMocks());

  it("assigns duration by playback order, including an ending authored early", async () => {
    const first = shot("Wind pushes the surface water.");
    const next = shot("Water moves locally as the wave carries energy onward.");
    const test = setup([brief, first, ending, next]);
    const events = await collect(await test.handler(request()));
    expect(test.generateVideo.mock.calls.map(([, context]) => context.requestedDurationSec)).toEqual([5, 8, 8]);
    expect(scenes(events).map(scene => scene.timing.fixedDuration)).toEqual([5, 8, 8]);
    expect(scenes(events).map(scene => scene.narration)).toEqual([first.narration, next.narration, ending.narration]);
    expect(test.errors).toEqual([]);
  });

  it("starts the five-second job before the provider writes the ending", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let endingWritten = false;
    const test = setup([], { streamText: async function* () {
      yield encode([brief, shot("Wind pushes the surface water.")]);
      await waiting;
      endingWritten = true;
      yield encode([ending, shot("The moving wave transfers energy toward the shore.")]);
    } });
    const response = await test.handler(request());
    const pending = collect(response);
    try {
      await vi.waitFor(() => expect(test.generateVideo).toHaveBeenCalledOnce());
      expect(test.generateVideo.mock.calls[0]![1].requestedDurationSec).toBe(5);
      expect(endingWritten).toBe(false);
    } finally { release(); await pending; }
  });

  it.each([false, true])("uses the short duration for an ending-only answer (embedded=%s)", async embedded => {
    const onlyBrief = { ...brief, development: "" };
    const test = setup(embedded ? [{ ...onlyBrief, ending }] : [onlyBrief, ending], { maxGeneratedVideos: 1 });
    const events = await collect(await test.handler(request()));
    expect(test.generateVideo.mock.calls.map(([, context]) => context.requestedDurationSec)).toEqual([5]);
    expect(scenes(events).map(scene => scene.timing.fixedDuration)).toEqual([5]);
    expect(test.errors).toEqual([]);
  });

  it("reserves the longer ending and rejects a sixth scene before generation", async () => {
    const bodies = Array.from({ length: 5 }, (_, i) => shot(`Water carries energy through section ${i}.`));
    const test = setup([brief, ...bodies, ending], { maxGeneratedVideos: 10 });
    const events = await collect(await test.handler(request()));
    const durations = scenes(events).map(scene => scene.timing.fixedDuration!);
    expect(durations).toEqual([5, 8, 8, 8, 8]);
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(37);
    expect(test.generateVideo).toHaveBeenCalledTimes(5);
    expect(test.errors).toEqual(["Chat shot exceeds the answer duration budget"]);
    expect(scenes(events).at(-1)?.narration).toBe(ending.narration);
  });

  it("sets later media deadlines from cumulative preceding clip durations", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    const bodies = Array.from({ length: 4 }, (_, i) => shot(`Water carries energy through section ${i}.`));
    const test = setup([brief, bodies[0], ending, ...bodies.slice(1)]);
    await collect(await test.handler(request()));
    expect(test.generateVideo.mock.calls.map(([, context]) => context.deadlineAt)).toEqual([115_000, 120_000, 128_000, 136_000, 144_000]);
  });

  it("uses each assigned clip duration for its single narration rewrite", async () => {
    const original = "This sentence contains several important details that need much longer than either clip allows to explain completely and naturally.";
    const rewrite = vi.fn<Options["generateText"]>(() => "Wind moves the water.");
    const test = setup([brief, shot(original), { ...ending, narration: original + " Finally." }], { generateText: rewrite });
    const events = await collect(await test.handler(request()));
    expect(rewrite.mock.calls.map(([context]) => JSON.parse(context.userPrompt).clipDurationSec)).toEqual([5, 8]);
    expect(test.generateVideo.mock.calls.map(([, context]) => context.requestedDurationSec)).toEqual([5, 8]);
    expect(scenes(events).map(scene => scene.narration)).toEqual(["Wind moves the water.", "Wind moves the water."]);
  });

  it("keeps stock duration independent of both generated clip settings", async () => {
    const searchMedia = vi.fn<NonNullable<Options["searchMedia"]>>(() => ({ type: "video", url: "https://media.example/stock.mp4", durationSec: 12 }));
    const rewrite = vi.fn<Options["generateText"]>(() => "");
    const narration = "Water moves locally as the wave carries energy onward toward the shoreline.";
    const test = setup([brief, shot(narration), ending], { searchMedia, generateText: rewrite });
    const events = await collect(await test.handler(request("pexels")));
    expect(test.generateVideo).not.toHaveBeenCalled();
    expect(searchMedia).toHaveBeenCalledTimes(2);
    expect(rewrite).not.toHaveBeenCalled();
    expect(scenes(events).map(scene => scene.variables.mediaDurationSec)).toEqual([12, 12]);
    expect(scenes(events)[0]?.narration).toBe(narration);
  });

  it.each([0, 21, Number.NaN, Number.POSITIVE_INFINITY, 9])("rejects invalid first duration %s", firstGeneratedClipDurationSec => {
    expect(() => setup([], { firstGeneratedClipDurationSec })).toThrow("firstGeneratedClipDurationSec");
  });
});
