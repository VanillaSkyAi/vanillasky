import { describe, expect, it, vi } from "vitest";
import { createVideoChatResponseInstructions } from "../src/server/video-chat-prompts";
import { createVideoChatHandler } from "../src/server";
import { decodeVideoSse } from "../src/protocol/sse";
import cases from "./fixtures/creative-answers.json";

const words = (text: string) => text.trim().split(/\s+/u).length;

describe("concise creative answer guidance", () => {
  it("makes the opening useful and starts the body without a second planning pass", () => {
    const instructions = createVideoChatResponseInstructions(true, false, 3);
    expect(instructions).toContain("4–7 ordinary words");
    expect(instructions).toContain("roughly 2–3 seconds");
    expect(instructions).toContain("Emit the complete brief, then the first developing shot immediately");
    expect(instructions).toContain("Compare the same criteria");
    expect(instructions).not.toContain("inviting spoken introduction");
  });

  // Authored examples exercise the real protocol and recovery path, not a model.
  for (const example of cases) it.each(["cinematic", "pexels"] as const)(`${example.intent}: ${example.subject} fixture preserves its complete treatment in %s`, async mode => {
    const ending = example.beats.at(-1)!;
    const brief = {type:"answer", intent:example.intent, opening:example.opening, subject:example.subject, development:example.development, visualDirection:example.visualDirection, ending};
    const searchMedia = vi.fn(async () => null), generateVideo = vi.fn(async () => null);
    const generateText = vi.fn(async () => { throw new Error("No second model pass in this fixture"); });
    const handler = createVideoChatHandler({authorize:"none", heartbeatMs:false, searchMedia, generateVideo, generateText,
      maxGeneratedVideos:3,
      streamText: async function* () {
        yield JSON.stringify(brief) + "\n";
        for (const beat of example.beats.slice(0,-1)) yield JSON.stringify({type:"shot", ...beat}) + "\n";
      },
    });
    const response = await handler(new Request("https://fixture.example/?action=response", {method:"POST", body:JSON.stringify({prompt:example.prompt, mode})}));
    const events=[]; for await (const event of decodeVideoSse(response.body!)) events.push(event);
    const scenes = events.filter(event => event.type === "scene.add").map(event => event.data.scene);
    expect(scenes.map(scene => scene.narration)).toEqual(example.beats.map(beat => beat.narration));
    expect(scenes.map(scene => scene.variables.title)).toEqual(example.beats.map(beat => beat.title));
    expect(scenes.every(scene => scene.templateId === "chapterTitle")).toBe(true);
    expect(events.some(event => event.type === "response.error")).toBe(false);
    expect(words(example.opening)).toBeGreaterThanOrEqual(4);
    expect(words(example.opening)).toBeLessThanOrEqual(7);
    expect(example.beats).toHaveLength(3);
    for (const beat of example.beats) {
      expect(words(beat.narration)).toBeLessThanOrEqual(beat.durationSec * 2);
      expect(beat.narration.toLowerCase()).not.toContain(example.opening.toLowerCase());
      expect(beat.title.length).toBeLessThanOrEqual(65);
    }
    expect(generateText).not.toHaveBeenCalled();
    expect(mode === "cinematic" ? searchMedia : generateVideo).not.toHaveBeenCalled();
    expect(mode === "cinematic" ? generateVideo : searchMedia).toHaveBeenCalledTimes(3);
  });
});

type Example = (typeof cases)[number];
type Beat = Example["beats"][number];
type MediaCall = {query: string; narration?: string; variables: Record<string, unknown>};
function assertVisualTreatment(calls: MediaCall[], example: Example, beats: Beat[], mode: "cinematic" | "pexels") {
  expect(calls).toHaveLength(beats.length);
  for (const [index, beat] of beats.entries()) {
    const call = calls[index]!;
    expect(call.query).toBe(beat.subject);
    expect(call.narration).toBe(beat.narration);
    expect(call.variables.shotDirection).toBe([
      example.visualDirection,
      beat.action,
      beat.continuity === "continue"
        ? "Continue the established subject, setting and action consistently."
        : "A deliberate new shot; choose framing that reveals this beat.",
      "Silent illustration. No spoken dialogue, voiceover, written words or subtitles in the generated footage.",
    ].join("\n"));
    expect(call.variables.stockSelection).toEqual(mode === "pexels" ? {subject: example.subject} : undefined);
  }
}

describe("authored creative treatment reaches the media adapter", () => {
  for (const example of cases) it.each(["cinematic", "pexels"] as const)(`${example.intent}: ${example.subject} preserves each ready visual in %s`, async mode => {
    // Exercise both a continued subject and a deliberate cut without adding an
    // extra scene or model call. This is an adapter contract, not generated art.
    const beats = example.beats.map((beat, index) => ({...beat, continuity:index === 1 ? "continue" : "cut", stockSelection:{subject:example.subject}}));
    const calls: MediaCall[] = [];
    const media: NonNullable<import("../src/server").VideoChatHandlerOptions["generateVideo"]> = async (query, context) => {
      calls.push({query, narration:context.scene?.narration, variables:structuredClone(context.scene?.variables ?? {})});
      return {type:"video", url:`https://fixture.example/clip-${calls.length}.mp4`};
    };
    const searchMedia = vi.fn(media), generateVideo = vi.fn(media);
    const generateText = vi.fn(async () => { throw new Error("No extra model call"); });
    const handler = createVideoChatHandler({authorize:"none", heartbeatMs:false, maxGeneratedVideos:3, searchMedia, generateVideo, generateText,
      streamText: async function* () {
        yield JSON.stringify({type:"answer", intent:example.intent, opening:example.opening, subject:example.subject, development:example.development, visualDirection:example.visualDirection, ending:beats.at(-1)}) + "\n";
        for (const beat of beats.slice(0,-1)) yield JSON.stringify({type:"shot", ...beat}) + "\n";
      },
    });
    const response = await handler(new Request("https://fixture.example/?action=response", {method:"POST", body:JSON.stringify({prompt:example.prompt, mode})}));
    const events=[]; for await (const event of decodeVideoSse(response.body!)) events.push(event);
    assertVisualTreatment(calls, example, beats, mode);
    const scenes = events.filter(event => event.type === "scene.add").map(event => event.data.scene);
    expect(scenes.map(scene => scene.narration)).toEqual(beats.map(beat => beat.narration));
    expect(scenes.map(scene => scene.variables)).toEqual(beats.map((beat, index) => ({fallbackText:beat.title, mediaType:"video", mediaUrl:`https://fixture.example/clip-${index + 1}.mp4`})));
    expect(scenes.every(scene => scene.templateId === "cinemaMedia")).toBe(true);
    expect(events.at(-1)).toMatchObject({type:"response.complete", data:{finishReason:"stop"}});
    expect(generateText).not.toHaveBeenCalled();
    expect(mode === "cinematic" ? searchMedia : generateVideo).not.toHaveBeenCalled();

    // A green motion/narration result alone cannot establish visual alignment.
    // Mutate real captured evidence, leaving all narration and media URLs intact:
    // this oracle must reject both lost direction and another beat's direction.
    const missing = structuredClone(calls);
    delete missing[0]!.variables.shotDirection;
    expect(() => assertVisualTreatment(missing, example, beats, mode)).toThrow();
    const swapped = structuredClone(calls);
    [swapped[0]!.variables.shotDirection, swapped[1]!.variables.shotDirection] = [swapped[1]!.variables.shotDirection, swapped[0]!.variables.shotDirection];
    expect(() => assertVisualTreatment(swapped, example, beats, mode)).toThrow();
  });
});
