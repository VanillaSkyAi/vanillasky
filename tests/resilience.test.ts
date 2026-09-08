import { describe, expect, it } from "vitest";
import { createVideo } from "../src/server/compose-video";
import { createVideoRequest } from "../src/protocol/types";
import { decodeVideoSse } from "../src/protocol/sse";
import { createVideoStreamHandler } from "../src/server/video-stream-handler";

const validScene = (id: string) => ({
  type: "scene.add" as const,
  scene: { id, templateId: "notification", variables: { message: id }, timing: { fixedDuration: 3 } },
});

describe("generated-part resilience", () => {
  it("drops an invalid scene, reports its internal reason, and keeps accumulated context", async () => {
    const reported: string[] = [];
    const contexts: string[][] = [];
    const run = createVideo({ input: "facts" }, {
      invalidPartBehavior: "drop",
      onError: (error) => reported.push(error.message),
      validateScene: (scene, context) => {
        contexts.push(context.previousScenes.map(({ id }) => id));
        if (scene.id === "bad") throw new Error("private variable detail");
      },
      generate: async function* () {
        yield validScene("one");
        yield validScene("bad");
        yield validScene("two");
        yield { type: "plan.complete" as const };
      },
    });
    const events = [];
    for await (const event of run.stream) events.push(event);
    expect((await run.result).status).toBe("complete");
    expect((await run.result).config?.scenes.map(({ id }) => id))
      .toEqual(["supplied-opening", "one", "two"]);
    expect(reported).toEqual(["private variable detail"]);
    expect(contexts).toEqual([
      [],
      ["supplied-opening"],
      ["supplied-opening", "one"],
      ["supplied-opening", "one"],
    ]);
    expect(JSON.stringify(events)).not.toContain("private variable detail");
    expect(events).toContainEqual(expect.objectContaining({
      type: "response.warning",
      data: { warning: { code: "provider_warning", category: "provider", message: "Some generated content was skipped.", recoverable: true } },
    }));
  });

  it("preserves explicit fail-fast behavior", async () => {
    const run = createVideo({ input: "facts" }, {
      invalidPartBehavior: "fail",
      validateScene: (scene) => { if (scene.id === "bad") throw new Error("rejected"); },
      generate: async function* () { yield validScene("bad"); },
    });
    const events = [];
    for await (const event of run.stream) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "response.error", data: { terminal: true } });
  });

  it("recovers a reserved closer when a host callback interrupts finalization", async () => {
    let interrupted = false;
    const run = createVideo({ input: "facts", maxDurationSec: 10 }, {
      capabilities: { templates: ["body", "close"] },
      getTemplatePacing: (templateId) => ({
        jobs: templateId === "close" ? ["ask"] : ["claim"],
        minDuration: 2,
        preferredDuration: templateId === "close" ? 3 : 4,
      }),
      onEvent: (event) => {
        if (!interrupted && event.type === "response.warning" &&
          event.data.warning.code === "scene_omitted_for_closer") {
          interrupted = true;
          throw new Error("host interrupted finalization");
        }
      },
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "body-1", templateId: "body", variables: {}, timing: { fixedDuration: 4 } },
        };
        yield {
          type: "scene.add" as const,
          scene: { id: "body-2", templateId: "body", variables: {}, timing: { fixedDuration: 2 } },
        };
        yield {
          type: "scene.add" as const,
          scene: { id: "close-1", templateId: "close", variables: {}, timing: { fixedDuration: 3 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    await expect(run.result).resolves.toMatchObject({
      status: "error",
      config: { scenes: [{ id: "supplied-opening" }, { id: "body-1" }, { id: "close-1" }] },
    });
  });

  it("makes handler dropping the default, redacts the client, and isolates throwing onError", async () => {
    const reported: string[] = [];
    const handler = createVideoStreamHandler({
      authorize: "none",
      heartbeatMs: false,
      onError(error) { reported.push(error.message); throw new Error("reporter failed"); },
      validateScene: (scene) => { if (scene.id === "bad") throw new Error("secret schema detail"); },
      generate: async function* () {
        yield validScene("bad");
        yield validScene("good");
        yield { type: "plan.complete" as const };
      },
    });
    const body = createVideoRequest({ input: "facts" }, { requestId: "request-1" });
    const response = await handler(new Request("https://app.test/api", { method: "POST", body: JSON.stringify(body) }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(reported).toEqual(["secret schema detail"]);
    expect(JSON.stringify(events)).not.toMatch(/secret schema detail|reporter failed/);
  });

  it("reports interrupted plans without discarding playable scenes", async () => {
    const reported: string[] = [];
    const handler = createVideoStreamHandler({
      authorize: "none",
      heartbeatMs: false,
      onError: (error) => reported.push(error.message),
      generate: async function* () { yield validScene("good"); },
    });
    const body = createVideoRequest({ input: "facts" }, { requestId: "request-terminal" });
    const response = await handler(new Request("https://app.test/api", { method: "POST", body: JSON.stringify(body) }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(reported).toContain("The planner stream ended before plan.complete");
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: { finishReason: "other" },
    });
  });

  it("supports explicit handler fail-fast behavior without leaking the reason", async () => {
    const handler = createVideoStreamHandler({
      authorize: "none",
      heartbeatMs: false,
      invalidPartBehavior: "fail",
      validateScene: (scene) => {
        if (scene.id === "bad") throw new Error("private rejection");
      },
      generate: async function* () { yield validScene("bad"); },
    });
    const body = createVideoRequest({ input: "facts" }, { requestId: "request-fail" });
    const response = await handler(new Request("https://app.test/api", { method: "POST", body: JSON.stringify(body) }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "response.error", data: { terminal: true } });
    expect(JSON.stringify(events)).not.toContain("private rejection");
  });

  it("drops malformed runtime values before a later valid scene", async () => {
    const handler = createVideoStreamHandler({
      authorize: "none",
      heartbeatMs: false,
      generate: async function* () {
        yield null as never;
        yield validScene("good");
        yield { type: "plan.complete" as const };
      },
    });
    const body = createVideoRequest({ input: "facts" }, { requestId: "request-malformed" });
    const response = await handler(new Request("https://app.test/api", { method: "POST", body: JSON.stringify(body) }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.map(({ type }) => type)).toEqual([
      "response.start", "scene.add", "response.warning", "scene.add", "response.complete",
    ]);
  });
});

describe("remote consumption and credentials", () => {

  it("emits credentialed CORS headers only for an allowed origin", async () => {
    const handler = createVideoStreamHandler({
      authorize: "none",
      allowedOrigins: ["https://app.test"], allowCredentials: true, heartbeatMs: false,
      generate: async function* () { yield validScene("good"); yield { type: "plan.complete" as const }; },
    });
    const response = await handler(new Request("https://api.test", {
      method: "OPTIONS", headers: { origin: "https://app.test" },
    }));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

});

describe("local consumption lifecycle", () => {

  it.each([
    ["cancelled in test", "cancelled in test"],
    [new DOMException("private timeout detail", "TimeoutError"), "Request timed out"],
  ])("keeps generated scenes in the partial snapshot after interruption (%s)", async (reason, publicReason) => {
    const controller = new AbortController();
    const run = createVideo({ input: "Grounded partial answer" }, {
      signal: controller.signal,
      generate: async function* ({ signal }) {
        yield validScene("partial");
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        }
      },
    });
    const events = [];
    for await (const event of run.stream) {
      events.push(event);
      if (event.type === "scene.add" && event.data.scene.id === "partial") controller.abort(reason);
    }
    expect(events.at(-1)).toMatchObject({
      type: "response.abort",
      data: {
        reason: publicReason,
        snapshot: { scenes: expect.arrayContaining([expect.objectContaining({ id: "partial" })]) },
      },
    });
    expect(JSON.stringify(events)).not.toContain("private timeout detail");
  });

  it("resolves terminal protocol errors and aborts without a stream consumer", async () => {
    const failed = createVideo({ input: "facts" }, {
      generate: async function* () { yield validScene("good"); },
    });
    await expect(failed.result).resolves.toMatchObject({ status: "error" });

    const waiting = createVideo({ input: "facts" }, {
      generate: async function* ({ signal }) {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield* [];
      },
    });
    waiting.abort("cancelled in test");
    await expect(waiting.result).resolves.toMatchObject({ status: "aborted", abortReason: "cancelled in test" });
  });

  it("rejects lifecycle execution failures", async () => {
    const run = createVideo({ input: "facts" }, {
      onEvent: () => { throw new Error("host callback failed"); },
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });
    await expect(run.result).rejects.toThrow("host callback failed");
    await expect(async () => { for await (const event of run.stream) void event; })
      .rejects.toThrow("host callback failed");
  });
});
