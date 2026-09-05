import { describe, expect, it } from "vitest";
import { decodeVideoSse } from "../src/protocol/sse";

/**
 * A style has two halves once media can be generated.
 *
 * The brand decides how captions are drawn; the generated look decides what the
 * footage behind them looks like. They have to travel together - pale
 * illustrated ground under dark documentary footage is unreadable - and until
 * now only the first was part of the style, so every application threaded the
 * second into each provider call by hand and a mismatch was silent.
 */
const LOOK = "Hand-drawn cel animation on ivory, rough ink contours, flat cobalt and crimson.";

describe("generated look", () => {
  it("reaches the media resolver as part of the style", async () => {
    const { createVideoHandler } = await import("../src/server/create-video-handler");
    const seen: Array<string | undefined> = [];
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      resolveMedia: (_query, context) => {
        seen.push(context.generatedLook);
        return { url: "https://media.example.test/shot.mp4", type: "video" as const };
      },
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"first","templateId":"cinemaMedia","variables":{"fallbackText":"One","mediaKeyword":"a wave","mediaType":"video"},"timing":{"fixedDuration":3}}}\n';
        yield '{"type":"scene.add","scene":{"id":"second","templateId":"cinemaMedia","variables":{"fallbackText":"Two","mediaKeyword":"a shore","mediaType":"video"},"timing":{"fixedDuration":3}}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });
    const response = await handler(new Request("https://app.example/api/video", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "0.6",
        requestId: "request-generated-look",
        input: { input: "Waves break because the sea floor slows their base.", style: { generatedLook: LOOK } },
        capabilities: { templates: ["cinemaMedia"] },
      }),
    }));
    for await (const event of decodeVideoSse(response.body!)) void event;

    expect(seen.length).toBeGreaterThan(0);
    // Every call, not just the first: a look that applies to one shot in a
    // sequence is the mismatch this exists to prevent.
    expect(seen.every((look) => look === LOOK)).toBe(true);
  });

  it("is absent when the application did not ask for one", async () => {
    const { createVideoHandler } = await import("../src/server/create-video-handler");
    let seen: string | undefined | "unset" = "unset";
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      resolveMedia: (_query, context) => {
        seen = context.generatedLook;
        return { url: "https://media.example.test/shot.mp4", type: "video" as const };
      },
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"first","templateId":"cinemaMedia","variables":{"fallbackText":"One","mediaType":"gradient"},"timing":{"fixedDuration":3}}}\n';
        yield '{"type":"scene.add","scene":{"id":"second","templateId":"cinemaMedia","variables":{"fallbackText":"Two","mediaKeyword":"a shore","mediaType":"video"},"timing":{"fixedDuration":3}}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });
    const response = await handler(new Request("https://app.example/api/video", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "0.6",
        requestId: "request-no-look",
        input: { input: "Waves break because the sea floor slows their base." },
        capabilities: { templates: ["cinemaMedia"] },
      }),
    }));
    for await (const event of decodeVideoSse(response.body!)) void event;

    expect(seen).toBeUndefined();
  });

  it("travels on the resolved style, so a stored video keeps its look", async () => {
    const { parseVideo } = await import("../src/index");
    const { TEST_VIDEO_STYLE } = await import("./semantic-brand-fixture");
    const stored = {
      schemaVersion: "0.2",
      orientation: "landscape",
      scenes: [{ id: "a", templateId: "media", variables: { texts: "One" }, timing: { fixedDuration: 3 } }],
      style: { ...TEST_VIDEO_STYLE, generatedLook: LOOK },
    };
    expect(parseVideo(stored).style.generatedLook).toBe(LOOK);
  });
});
