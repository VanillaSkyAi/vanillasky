import { streamChatShots } from "./helpers/chat-shot-fixture";
import { describe, expect, it } from "vitest";
import { decodeVideoSse } from "../src/protocol/sse";

type CreateVideoChatHandler = (options: Record<string, unknown>) =>
  (request: Request) => Promise<Response>;

async function loadCreateVideoChatHandler(): Promise<CreateVideoChatHandler> {
  const server = await import("../src/server") as unknown as {
    createVideoChatHandler?: CreateVideoChatHandler;
  };
  expect(server.createVideoChatHandler).toBeTypeOf("function");
  return server.createVideoChatHandler!;
}

function plannedResponse(opening?: string, subject?: string) {
  return () => streamChatShots(undefined, opening, subject);
}

describe("createVideoChatHandler", () => {
  it("keeps follow-up cards concise without cutting questions mid-sentence", async () => {
    const create = await loadCreateVideoChatHandler();
    const searched: string[] = [];
    const handler = create({
      authorize: "none", streamText: plannedResponse(),
      generateText: async ({ systemPrompt }: { systemPrompt: string }) => {
        expect(systemPrompt).toContain("8 words");
        expect(systemPrompt).toContain("60 characters");
        return JSON.stringify({suggestions: [
          {prompt: "What happens when atoms don't have enough electrons to be stable, and how do they gain or lose them?", keyword:"electrons"},
          {prompt: "a".repeat(61), keyword:"long"},
          {prompt: "a b c d e f g h i", keyword:"many"},
          null,
          {prompt: "  How do atoms   gain electrons?  ", keyword:"atom"},
          {prompt: "Why do atoms bond?", keyword:"molecule"},
        ]});
      },
      searchMedia: async (query: string) => { searched.push(query); return null; },
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=suggestions", {
      method:"POST", body:JSON.stringify({prompt:"Explain atoms", lines:[]}),
    }));
    expect(await response.json()).toEqual({suggestions:[
      {prompt:"How do atoms gain electrons?",media:null},
      {prompt:"Why do atoms bond?",media:null},
    ]});
    expect(searched).toEqual(["atom","molecule"]);
  });

  it("uses the selected cloud film without a provider lookup by default", async () => {
    const create = await loadCreateVideoChatHandler();
    let lookups = 0;
    const handler = create({ authorize: "none", streamText: plannedResponse(), generateText: async () => "", welcome: { prompts: [] }, searchMedia: () => { lookups++; return null; } });
    const response = await handler(new Request("https://app.example/api?action=welcome"));
    expect(await response.json()).toEqual({ hero: {
      url: "https://videos.pexels.com/video-files/11335959/11335959-hd_1920_1080_30fps.mp4",
      type: "video", posterUrl: "https://images.pexels.com/videos/11335959/pexels-photo-11335959.jpeg?auto=compress&fit=crop&w=1920",
    }, cards: [] });
    expect(lookups).toBe(0);
  });
  it("preserves host welcome queries instead of replacing them with clouds", async () => {
    const create = await loadCreateVideoChatHandler();
    const queries: string[] = [];
    const handler = create({ authorize: "none", streamText: plannedResponse(), generateText: async () => "", welcome: { heroQuery: "city lights", prompts: [] }, searchMedia: (query: string) => { queries.push(query); return { url: "https://media.example/city.jpg", type: "image" }; } });
    const response = await handler(new Request("https://app.example/api?action=welcome"));
    expect((await response.json()).hero.url).toBe("https://media.example/city.jpg");
    expect(queries).toEqual(["city lights"]);
  });

  it("does not forward obsolete generation options from JavaScript callers", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let selectedAudio = false;
    let createdRun = false;
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      selectAudio: () => { selectedAudio = true; return undefined; },
      createRunId: () => { createdRun = true; return "obsolete-run"; },
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      body: JSON.stringify({ prompt: "A useful answer", opening: "Start here" }),
    }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(selectedAudio).toBe(false);
    expect(createdRun).toBe(false);
    expect(JSON.stringify(events)).not.toContain("obsolete");
  });

  it("preserves non-enumerable provider lifecycle fields while intercepting the opening", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const warningCodes: string[] = [];
    let completed: Record<string, unknown> | undefined;
    const source = {
      textStream: (async function* () {
        yield* plannedResponse()();
      })(),
    };
    Object.defineProperties(source, {
      finishReason: { get: () => Promise.resolve("stop") },
      warnings: { get: () => Promise.resolve([{ type: "other", message: "test warning" }]) },
      usage: { get: () => Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }) },
      requestedModelId: { get: () => Promise.resolve("requested-model") },
      resolvedModelId: { get: () => Promise.resolve("resolved-model") },
    });
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: () => source as never,
      generateText: async () => "unused",
      onWarning: (warning: { code: string }) => warningCodes.push(warning.code),
      onComplete: (summary: Record<string, unknown>) => { completed = summary; },
    });

    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Test the lifecycle", mode: "cinematic", orientation: "landscape" }),
    }));
    await response.text();

    expect(warningCodes).toContain("provider_warning");
    expect(completed).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      requestedModelId: "requested-model",
      resolvedModelId: "resolved-model",
    });
  });

  it("streams the short opening and template plan from one model call", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const generatedTasks: string[] = [];
    let streamCalls = 0;
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: () => {
        streamCalls += 1;
        return (async function* () {
          yield* plannedResponse("The Moon turns, perfectly matching its orbit.", "moon orbit earth")();
        })();
      },
      generateText: async ({ task }: { task: string }) => {
        generatedTasks.push(task);
        return "unused";
      },
    });

    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Why does the Moon always show one face?",
        mode: "cinematic",
        orientation: "landscape",
      }),
    }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);

    expect(events.filter(({type}) => type !== "response.warning").map(({ type }) => type)).toEqual([
      "response.start",
      "data.video-chat-opening",
      "data.video-chat-preparation",
      "data.video-chat-preparation",
      "audio.set",
      "scene.add",
      "scene.add",
      "response.complete",
    ]);
    expect(events[0]).toMatchObject({
      data: { capabilities: { extensions: ["data.video-chat-opening", "data.video-chat-preparation"] } },
    });
    expect(events[1]).toMatchObject({
      data: {
        line: "The Moon turns, perfectly matching its orbit.",
        keyword: "moon orbit earth",
      },
    });
    expect(streamCalls).toBe(1);
    expect(generatedTasks).toEqual([]);
  });

  it("requires an explicit authorization policy", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    expect(() => createVideoChatHandler({
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
    })).toThrow('createVideoChatHandler requires authorize or authorize: "none"');
  });

  it("exposes one provider-neutral endpoint with capability fallbacks", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
    });

    const response = await handler(new Request("https://app.example/api/video-chat?action=capabilities"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      templates: true,
      generatedSpeech: false,
      generatedVideo: false,
      generatedVideoAudio: false,
      stockMedia: false,
      transcription: false,
      modes: ["cinematic"],
    });

    const speech = await handler(new Request("https://app.example/api/video-chat?action=speech", {
      method: "POST",
      body: JSON.stringify({ text: "Use the browser voice" }),
    }));
    expect(speech.status).toBe(204);
    expect(await speech.text()).toBe("");
  });

  it("passes the request, conversation and spoken opening into the video stream", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let userPrompt = "";
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: (context: { systemPrompt: string; userPrompt: string }) => {
        userPrompt = context.userPrompt;
        return plannedResponse()();
      },
      generateText: async () => "unused",
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Invent a playful bedtime story about a moonlit bakery",
        opening: "Tonight, one impossible loaf is about to change this tiny bakery.",
        mode: "cinematic",
        orientation: "landscape",
        conversation: [{ prompt: "Make it whimsical", response: "We chose a tiny fox hero." }],
      }),
    }));
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);

    expect(response.status).toBe(200);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(userPrompt).toContain("Invent a playful bedtime story");
    expect(userPrompt).toContain("Make it whimsical");
    expect(userPrompt).toContain("tiny fox hero");
    expect(userPrompt).toContain("OPENING ALREADY SPOKEN");
    expect(userPrompt).toContain("one impossible loaf");
  });

  it("resolves a streamed opening keyword into stock footage separately", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const mediaCalls: Array<{ query: string; purpose: string; fallbackQuery?: string }> = [];
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      searchMedia: async (query: string, { purpose, fallbackQuery }: { purpose: string; fallbackQuery?: string }) => {
        mediaCalls.push({ query, purpose, fallbackQuery });
        return { url: "https://media.example/moon.mp4", type: "video" };
      },
    });

    const media = await handler(new Request("https://app.example/api/video-chat?action=opening-media", {
      method: "POST",
      body: JSON.stringify({ keyword: "moon orbit earth", fallbackKeyword: "moon night sky", orientation: "landscape" }),
    }));
    expect(await media.json()).toEqual({
      media: { url: "https://media.example/moon.mp4", type: "video" },
    });
    expect(mediaCalls).toEqual([{ query: "moon orbit earth", purpose: "response", fallbackQuery: "moon night sky" }]);
  });

  it("keeps generated-video spend limits on the server and rejects the removed mixed mode", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let generated = 0;
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      generateVideo: async () => {
        generated += 1;
        return { url: "https://media.example/generated.mp4", type: "video" };
      },
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Tell a story",
        mode: "cinematic",
        orientation: "portrait",
        maxGeneratedVideos: 99,
      }),
    }));

    expect(response.status).toBe(400);
    expect(generated).toBe(0);

    const removed = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Tell a story", mode: "some", orientation: "portrait" }),
    }));
    expect(removed.status).toBe(400);
    expect(generated).toBe(0);

    const allowed = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Tell a story", mode: "cinematic", orientation: "portrait" }),
    }));
    await allowed.text();
    expect(allowed.status).toBe(200);
    expect(generated).toBe(2);
  });


  it("does not start a paid first shot before the composed video input is validated", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let generated = 0;
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      generateVideo: async () => {
        generated += 1;
        return { url: "https://media.example/generated.mp4", type: "video" as const };
      },
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Tell a story",
        mode: "cinematic",
        style: "not-a-style-object",
      }),
    }));
    await response.text();

    expect(response.status).toBe(400);
    expect(generated).toBe(0);
  });

  it("runs optional providers through bounded neutral adapters", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const tasks: string[] = [];
    const mediaPurposes: string[] = [];
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async ({ task }: { task: string }) => {
        tasks.push(task);
        return task === "suggestions"
          ? '{"suggestions":[{"prompt":"Continue the story","keyword":"moon bakery"}]}'
          : "A clean line";
      },
      generateSpeech: async () => ({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/test" }),
      transcribe: async ({ audio }: { audio: Uint8Array }) => `heard ${audio.byteLength} bytes`,
      searchMedia: async (_query: string, { purpose }: { purpose: string }) => {
        mediaPurposes.push(purpose);
        return {
          url: "https://media.example/stock.mp4",
          type: "video",
          providerSecret: "must stay on the server",
        };
      },
      generateVideo: async () => ({ url: "https://media.example/generated.mp4", type: "video" }),
    });

    const capabilities = await handler(new Request("https://app.example/api/video-chat?action=capabilities"));
    expect(await capabilities.json()).toMatchObject({
      generatedSpeech: true,
      generatedVideo: true,
      stockMedia: true,
      transcription: true,
      modes: ["cinematic", "pexels"],
    });

    const suggestions = await handler(new Request("https://app.example/api/video-chat?action=suggestions", {
      method: "POST",
      body: JSON.stringify({ prompt: "Tell me something", lines: ["One line"] }),
    }));
    expect(await suggestions.json()).toEqual({
      suggestions: [{
        prompt: "Continue the story",
        media: { url: "https://media.example/stock.mp4", type: "video" },
      }],
    });

    const speech = await handler(new Request("https://app.example/api/video-chat?action=speech", {
      method: "POST",
      body: JSON.stringify({ text: "Hello" }),
    }));
    expect(speech.headers.get("content-type")).toBe("audio/test");
    expect([...new Uint8Array(await speech.arrayBuffer())]).toEqual([1, 2, 3]);

    const transcription = await handler(new Request("https://app.example/api/video-chat?action=transcription", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: new Uint8Array([4, 5]),
    }));
    expect(await transcription.json()).toEqual({ text: "heard 2 bytes" });

    const welcome = await handler(new Request("https://app.example/api/video-chat?action=welcome"));
    const welcomeBody = await welcome.json() as { hero: unknown; cards: Array<{ opening?: string }> };
    expect(welcomeBody.cards).toHaveLength(8);
    expect(welcomeBody.cards.every(({ opening }) => opening === undefined)).toBe(true);
    expect(JSON.stringify(welcomeBody)).not.toContain("providerSecret");
    expect(tasks).toEqual(["suggestions"]);
    expect(mediaPurposes).toEqual(["suggestion"]);
  });

  it("cancels welcome media work with the request", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let providerSignal: AbortSignal | undefined;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      welcome: { heroQuery: "ocean", prompts: [] },
      searchMedia: async (_query: string, { signal }: { signal: AbortSignal }) => {
        providerSignal = signal;
        providerStarted();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return null;
      },
    });
    const controller = new AbortController();
    const pending = handler(new Request("https://app.example/api/video-chat?action=welcome", {
      signal: controller.signal,
    }));

    await started;
    controller.abort("prompt replaced");
    await pending;

    expect(providerSignal?.aborted).toBe(true);
  });

  it("does not cache a failed welcome lookup", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    let calls = 0;
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      welcome: { heroQuery: "ocean", prompts: [] },
      searchMedia: () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary provider failure");
        return {
          url: "https://media.example/recovered.jpg",
          type: "image",
          providerSecret: "must stay on the server",
        };
      },
    });

    const failed = await handler(new Request("https://app.example/api/video-chat?action=welcome"));
    expect(await failed.json()).toEqual({ hero: null, cards: [] });
    const recovered = await handler(new Request("https://app.example/api/video-chat?action=welcome"));
    expect(await recovered.json()).toEqual({
      hero: { url: "https://media.example/recovered.jpg", type: "image" },
      cards: [],
    });
    await handler(new Request("https://app.example/api/video-chat?action=welcome"));
    expect(calls).toBe(2);
  });

  it("returns a provider failure instead of blaming valid speech input", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const errors: string[] = [];
    const handler = createVideoChatHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
      generateSpeech: async () => { throw new Error("private provider detail"); },
      onError: (error: Error) => { errors.push(error.message); },
    });
    const response = await handler(new Request("https://app.example/api/video-chat?action=speech", {
      method: "POST",
      body: JSON.stringify({ text: "Hello" }),
    }));

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider detail");
    expect(errors).toEqual(["private provider detail"]);
  });

  it("keeps CORS headers on the streamed response", async () => {
    const createVideoChatHandler = await loadCreateVideoChatHandler();
    const handler = createVideoChatHandler({
      authorize: "none",
      allowedOrigins: ["https://client.example"],
      heartbeatMs: false,
      streamText: plannedResponse(),
      generateText: async () => "unused",
    });
    const response = await handler(new Request("https://api.example/video-chat?action=response", {
      method: "POST",
      headers: {
        origin: "https://client.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "A clear answer", mode: "cinematic" }),
    }));

    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example");
  });
});
