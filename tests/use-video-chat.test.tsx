// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Video, VideoScene } from "../src/protocol/types";
import { checksumVideo } from "../src/protocol/checksum";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";

function scene(id: string, value: string, narration?: string): VideoScene {
  return {
    id,
    templateId: "chapterTitle",
    variables: { title: value },
    timing: { fixedDuration: 4 },
    ...(narration ? { narration } : {}),
  };
}

function responseStream(
  requestId: string,
  scenes: VideoScene[],
  opening = { line: "Let us begin somewhere unexpected.", keyword: "unexpected story opening", fallbackKeyword: "night sky" },
): Response {
  const snapshot: Video = {
    schemaVersion: "0.2",
    orientation: "landscape",
    scenes,
    style: TEST_VIDEO_STYLE,
  };
  const events = [
    { protocolVersion: "0.6", type: "response.start", eventId: `${requestId}:0`, runId: requestId, sequence: 0, data: { requestId, format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"], extensions: ["data.video-chat-opening"] } } },
    { protocolVersion: "0.6", type: "data.video-chat-opening", eventId: `${requestId}:1`, runId: requestId, sequence: 1, data: opening },
    ...scenes.map((entry, position) => ({ protocolVersion: "0.6", type: "scene.add", eventId: `${requestId}:${position + 2}`, runId: requestId, sequence: position + 2, data: { scene: entry, position } })),
    { protocolVersion: "0.6", type: "response.complete", eventId: `${requestId}:${scenes.length + 2}`, runId: requestId, sequence: scenes.length + 2, data: { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6" },
  });
}

function fakeVoice() {
  return {
    prepare: vi.fn(async () => ({ seconds: 1.2 })),
    speak: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    setMuted: vi.fn(),
    dispose: vi.fn(),
  };
}

function videoChatFetcher(options: { requests?: Array<{ action: string | null; body?: unknown }> } = {}): typeof fetch {
  let responseCount = 0;
  return vi.fn(async (input, init) => {
    const url = new URL(String(input), "https://app.example");
    const action = url.searchParams.get("action");
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    options.requests?.push({ action, body });
    if (action === "capabilities") {
      return Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: true, transcription: false, modes: ["cinematic"] });
    }
    if (action === "welcome") {
      return Response.json({
        hero: null,
        cards: [{
          prompt: "Tell me a tiny story",
          opening: "Tonight, one tiny story changes everything.",
          media: null,
        }],
      });
    }
    if (action === "opening-media") {
      return Response.json({ media: { url: "https://media.example/opening.mp4", type: "video" } });
    }
    if (action === "narration") return Response.json({ line: `Spoken ${String((body as { scene?: { id?: string } })?.scene?.id)}` });
    if (action === "suggestions") {
      return Response.json({ suggestions: [{ prompt: "Take it somewhere stranger", media: null }] });
    }
    if (action === "response") {
      responseCount += 1;
      return responseStream(`run-${responseCount}`, [
        scene(`one-${responseCount}`, "First"),
        scene(`two-${responseCount}`, "Second", "The planned second line."),
      ]);
    }
    return new Response("missing", { status: 404 });
  });
}

describe("useVideoChat", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { seconds: 6.2, supportsOffsets: true, duration: 6.2 },
    { seconds: 5.5, supportsOffsets: true, duration: 5.5 },
    { seconds: 14.282, supportsOffsets: true, duration: 14.282 },
    { seconds: 5.5, supportsOffsets: undefined, duration: 6.3 },
  ])("retains speech and footage with $seconds seconds and measured evidence $supportsOffsets", async ({ seconds, supportsOffsets, duration }) => {
    const { useVideoChat } = await import("../src/react");
    const line = "The complete explanation still matters, including this qualification.";
    const clip: VideoScene = { id: "short", templateId: "cinemaMedia", narration: line,
      variables: { mediaUrl: "https://media.example/short.mp4", mediaType: "video", mediaDurationSec: 5, fallbackText: "The full explanation" }, timing: { fixedDuration: 6 } };
    const base = videoChatFetcher();
    const fetcher: typeof fetch = async (input, init) => String(input).includes("action=response")
      ? responseStream("short", [clip], { line: "", keyword: "", fallbackKeyword: "" }) : base(input, init);
    const metrics = vi.fn();
    const { result } = renderHook(() => useVideoChat({ fetcher, onPlaybackMetric: metrics, voice: { ...fakeVoice(), prepare: vi.fn(async () => ({ seconds, supportsOffsets })) } }));
    await act(async () => { await result.current.ask("Explain it"); });
    expect(result.current.currentTurn?.video?.scenes[0]).toMatchObject({ templateId: "cinemaMedia", narration: line, variables: { mediaUrl: clip.variables.mediaUrl }, timing: { fixedDuration: duration } });
    expect(result.current.currentTurn?.video?.scenes[0]?.variables.measuredSpeechDurationSec).toBe(supportsOffsets ? seconds : undefined);
    expect(result.current.playerProps?.narrationActive).toBeTypeOf("function");
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ type: "scene-duration", speechDurationSec: seconds, clipDurationSec: 5, recovered: false }));
  });

  it("does not resubmit an ambiguous cinematic response request", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    let submitted = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (!String(input).includes("action=response")) return base(input, init);
      submitted++;
      throw new TypeError("Network disconnected after submission");
    };
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), mode: "cinematic" }));
    await act(async () => { await result.current.ask("One paid request"); });
    expect(submitted).toBe(1);
    expect(result.current.status).toBe("error");
  });

  it("prepares speech alongside a pending photo and keeps the full answer when it fails", async () => {
    const { useVideoChat } = await import("../src/react");
    const images: Array<{ onerror: (() => void) | null }> = [];
    let failImages = false;
    vi.stubGlobal("Image", class {
      onload = null; onerror: (() => void) | null = null; complete = false; naturalWidth = 0;
      set src(_value: string) { if (failImages) queueMicrotask(() => this.onerror?.()); }
      constructor() { images.push(this); }
    });
    const narration = "The robot plants a seed and waits for the first green shoot.";
    const shot: VideoScene = { id: "photo", templateId: "cinemaMedia", variables: {
      mediaUrl: "https://media.example/seed.jpg", mediaType: "photo", fallbackText: "A seed of hope",
    }, narration, timing: { fixedDuration: 5 } };
    const ending: VideoScene = { id: "ending", templateId: "chapterTitle", variables: { title: "The garden wakes" },
      narration: "At sunrise, the whole garden finally answers with a thousand tiny leaves.", timing: { fixedDuration: 5 } };
    const base = videoChatFetcher();
    const fetcher: typeof fetch = (input, init) => String(input).includes("action=response")
      ? Promise.resolve(responseStream("photo-failure", [shot, ending])) : base(input, init);
    const voice = fakeVoice();
    const { result } = renderHook(() => useVideoChat({ fetcher, voice }));
    let answer!: Promise<Video | undefined>;
    act(() => { answer = result.current.ask("Tell a story about a robot gardener"); });
    await waitFor(() => expect(voice.prepare).toHaveBeenCalledWith(narration, expect.any(Object)));
    expect(result.current.currentTurn?.completed).not.toBe(true);
    await waitFor(() => expect(images.some(image => image.onerror != null)).toBe(true));
    await act(async () => { failImages = true; for (const image of images) image.onerror?.(); });
    await waitFor(() => expect(result.current.currentTurn?.completed).toBe(true));
    const video = await answer;
    expect(video?.scenes.map(({ templateId }) => templateId)).toEqual(["chapterTitle", "chapterTitle"]);
    expect(video?.scenes[0].variables).toEqual({ title: "A seed of hope" });
    expect(video?.scenes.map(({ narration }) => narration)).toEqual([narration, ending.narration]);
    expect(result.current.currentTurn?.completed).toBe(true);
  });


  it("completes before suggestions and retains context while late suggestions are discarded", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    const base = videoChatFetcher({ requests });
    let resolveSuggestions!: (response: Response) => void;
    let suggestionsSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = (input, init) => {
      if (String(input).includes("action=suggestions")) {
        suggestionsSignal = init?.signal ?? undefined;
        return new Promise((resolve) => { resolveSuggestions = resolve; });
      }
      return base(input, init);
    };
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));
    let first: Promise<Video | undefined>;
    act(() => { first = result.current.ask("Explain the Moon"); });
    await waitFor(() => expect(result.current.currentTurn?.completed).toBe(true));
    expect(await first!).toBeDefined();
    const firstSignal = suggestionsSignal;
    const firstResolve = resolveSuggestions;
    act(() => { void result.current.ask("Give an analogy"); });
    await waitFor(() => expect(result.current.currentTurn?.completed).toBe(true));
    expect(firstSignal?.aborted).toBe(true);
    const responseRequests = requests.filter(({ action }) => action === "response");
    expect(JSON.stringify(responseRequests[1].body)).toContain("Explain the Moon");
    await act(async () => { firstResolve(Response.json({ suggestions: [{ prompt: "Obsolete suggestion", media: null }] })); });
    expect(result.current.suggestions).toEqual([]);
    await act(async () => { resolveSuggestions(Response.json({ suggestions: [{ prompt: "Current suggestion", media: null }] })); });
    await waitFor(() => expect(result.current.suggestions[0]?.prompt).toBe("Current suggestion"));
  });

  it("falls back when scene narration ignores cancellation and never settles", async () => {
    const { useVideoChat } = await import("../src/react");
    vi.useFakeTimers();
    const base = videoChatFetcher();
    const fetcher: typeof fetch = (input, init) => String(input).includes("action=narration")
      ? new Promise(() => undefined) : base(input, init);
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));
    try {
      act(() => { void result.current.ask("Explain the Moon"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
      expect(result.current.currentTurn?.completed).toBe(true);
      expect(result.current.currentTurn?.video?.scenes).toHaveLength(2);
      expect(result.current.warnings).toContain("Some narration was simplified so the response could continue.");
    } finally { result.current.cancel(); vi.useRealTimers(); }
  });

  it("keeps playable scenes when a custom voice preparation never settles", async () => {
    const { useVideoChat } = await import("../src/react");
    vi.useFakeTimers();
    const voice = { ...fakeVoice(), prepare: vi.fn(() => new Promise<{ seconds: number }>(() => undefined)) };
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher(), voice }));
    try {
      act(() => { void result.current.ask("Explain the Moon"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
      expect(result.current.currentTurn?.completed).toBe(true);
      expect(result.current.playerProps).toBeDefined();
      expect(result.current.currentTurn?.video?.scenes).toHaveLength(2);
    } finally { act(() => result.current.cancel()); vi.useRealTimers(); }
  });

  it("reports presentation, actual speech onset, and starvation without content", async () => {
    const { useVideoChat } = await import("../src/react");
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const metrics: unknown[] = [];
    const firstFrame = vi.fn();
    let speechStarted: (() => void) | undefined;
    const voice = { ...fakeVoice(), speak: vi.fn((text: string, options: { onStart?: () => void }) => {
      if (text.startsWith("Let us begin")) return Promise.resolve();
      return new Promise<void>((resolve) => { speechStarted = () => { options.onStart?.(); resolve(); }; });
    }) };
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher(), voice,
      createTurnId: () => "opaque-turn", onFirstFrame: firstFrame, onPlaybackMetric: (metric) => { metrics.push(metric); },
    }));
    await act(async () => { await result.current.ask("private prompt"); });
    expect(metrics).toEqual([]);
    act(() => result.current.playerProps?.onSceneChange?.(scene("one", "private scene", "private narration"), 0));
    expect(metrics).toEqual([]);
    now = 150;
    act(() => result.current.playerProps?.onFramePresented?.());
    now = 175;
    act(() => result.current.playerProps?.onMediaFramePresented?.());
    act(() => result.current.playerProps?.onMediaFramePresented?.());
    now = 200;
    act(() => speechStarted?.());
    act(() => speechStarted?.());
    now = 300;
    act(() => result.current.playerProps?.onStallChange?.(true));
    now = 550;
    act(() => result.current.playerProps?.onStallChange?.(false));
    expect(metrics).toEqual([
      { type: "first-frame", turnId: "opaque-turn", mode: "cinematic", elapsedMs: 50 },
      { type: "first-media-frame", turnId: "opaque-turn", mode: "cinematic", elapsedMs: 75 },
      { type: "first-speech", turnId: "opaque-turn", mode: "cinematic", elapsedMs: 100, source: "custom" },
      { type: "stall", turnId: "opaque-turn", mode: "cinematic", elapsedMs: 450, durationMs: 250, reason: "scene-generation" },
    ]);
    expect(firstFrame).toHaveBeenCalledOnce();
    expect(JSON.stringify(metrics)).not.toMatch(/private|https|sceneId/);
    act(() => result.current.cancel());
    act(() => result.current.playerProps?.onFramePresented?.());
    act(() => speechStarted?.());
    expect(metrics).toHaveLength(4);
  });

  it("excludes pauses from starvation and isolates rejected metric observers", async () => {
    const { useVideoChat } = await import("../src/react");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const observer = vi.fn(() => Promise.reject(new Error("observer failure")));
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher(), voice: fakeVoice(),
      onPlaybackMetric: observer, onFirstFrame: () => { throw new Error("frame observer failure"); },
    }));
    await act(async () => { await result.current.ask("A response"); });
    act(() => result.current.playerProps?.onFramePresented?.());
    now = 100;
    act(() => result.current.playerProps?.onStallChange?.(true));
    now = 200;
    act(() => result.current.pause());
    act(() => result.current.playerProps?.onStallChange?.(true));
    now = 1_000;
    act(() => result.current.resume());
    act(() => result.current.playerProps?.onStallChange?.(true));
    now = 1_200;
    act(() => result.current.playerProps?.onStallChange?.(false));
    await act(async () => { await Promise.resolve(); });
    expect(observer.mock.calls.map((call) => (call as unknown[])[0]).filter((metric) => (metric as { type: string }).type === "stall"))
      .toEqual([expect.objectContaining({ durationMs: 100 }), expect.objectContaining({ durationMs: 200 })]);
    expect(result.current.error).toBeUndefined();
    expect(result.current.currentTurn?.completed).toBe(true);
  });

  it("ignores retained player callbacks while the next turn is waiting for its stream", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    let count = 0;
    let release!: (response: Response) => void;
    let turn = 0;
    const metrics: unknown[] = [];
    const fetcher: typeof fetch = (input, init) => {
      if (String(input).includes("action=response") && ++count === 2) return new Promise((resolve) => { release = resolve; });
      return base(input, init);
    };
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(),
      createTurnId: () => `turn-${++turn}`, onPlaybackMetric: (metric) => { metrics.push(metric); },
    }));
    await act(async () => { await result.current.ask("First"); });
    const old = result.current.playerProps;
    let next!: Promise<Video | undefined>;
    act(() => { next = result.current.ask("Second"); });
    act(() => { old?.onFramePresented?.(); old?.onStallChange?.(true); old?.onPlaybackEnd?.(result.current.turns[0].video!); });
    expect(result.current.status).toBe("composing");
    expect(metrics).toEqual([]);
    await act(async () => { release(responseStream("second", [scene("second", "Second", "Second narration")])); await next; });
    act(() => result.current.playerProps?.onFramePresented?.());
    expect(metrics).toEqual([expect.objectContaining({ type: "first-frame", turnId: "turn-2" })]);
  });

  it("loads capabilities and welcome content from the one default endpoint", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher({ requests }), voice: fakeVoice() }));

    expectTypeOf(useVideoChat).toBeFunction();
    await waitFor(() => expect(result.current.capabilities?.modes).toEqual(["cinematic"]));
    await waitFor(() => expect(result.current.welcome?.cards[0]?.prompt).toBe("Tell me a tiny story"));
    expect(requests.filter(({ action }) => action === "capabilities")).toHaveLength(1);
    expect(requests.filter(({ action }) => action === "welcome")).toHaveLength(1);
    expect(result.current.availableModes).toEqual(["cinematic"]);
  });

  it("starts from the opening carried by the response stream without a separate opening request", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    const voice = fakeVoice();
    const { result } = renderHook(() => useVideoChat({
      fetcher: videoChatFetcher({ requests }),
      voice,
    }));

    await act(async () => { await result.current.ask("Take me somewhere unexpected"); });

    expect(requests.filter(({ action }) => action === "response")).toHaveLength(1);
    expect(requests.some(({ action }) => action === "opening")).toBe(false);
    expect(voice.speak).toHaveBeenCalledWith(
      "Let us begin somewhere unexpected.",
      expect.any(Object),
    );
  });

  it("reports the first displayed response frame once", async () => {
    const { useVideoChat } = await import("../src/react");
    const onFirstFrame = vi.fn();
    const { result } = renderHook(() => useVideoChat({
      fetcher: videoChatFetcher(),
      voice: fakeVoice(),
      createTurnId: () => "measured-turn",
      onFirstFrame,
    }));

    await act(async () => { await result.current.ask("Measure this response"); });
    act(() => result.current.playerProps?.onFramePresented?.());
    act(() => result.current.playerProps?.onFramePresented?.());

    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(onFirstFrame).toHaveBeenCalledWith({
      turnId: "measured-turn",
      mode: "cinematic",
      timeToFirstFrameMs: expect.any(Number),
    });
  });

  it("owns response streaming, narration, measured pacing, suggestions, and real playback completion", async () => {
    const { useVideoChat } = await import("../src/react");
    const voice = fakeVoice();
    const { result } = renderHook(() => useVideoChat({
      fetcher: videoChatFetcher(),
      voice,
      mode: "cinematic",
      orientation: "landscape",
      style: { generatedLook: "paper collage" },
    }));

    let completed: Video | undefined;
    await act(async () => { completed = await result.current.ask("Invent a playful mystery"); });

    expect(completed?.scenes.map((entry) => entry.narration)).toEqual([
      "Spoken one-1",
      "The planned second line.",
    ]);
    for (const scene of completed!.scenes) expect(scene.timing.fixedDuration).toBeCloseTo(3.1);
    expect(voice.prepare).toHaveBeenCalledWith("Spoken one-1", expect.any(Object));
    expect(result.current.status).toBe("playing");
    expect(result.current.playbackEnded).toBe(false);
    await waitFor(() => expect(result.current.suggestions).toEqual([{ prompt: "Take it somewhere stranger", media: null }]));
    expect(result.current.playerProps).toMatchObject({ autoPlay: true, paused: false, controls: false });
    expect(result.current.playerProps).toHaveProperty("stream");
    const events = [];
    for await (const event of result.current.playerProps!.stream!) events.push(event);
    expect(events.map(({ type }) => type)).toEqual([
      "response.start",
      "scene.add",
      "scene.add",
      "response.complete",
    ]);

    act(() => result.current.playerProps?.onComplete?.(completed!));
    expect(result.current.status).toBe("playing");
    act(() => result.current.playerProps?.onPlaybackEnd?.(completed!));
    expect(result.current.status).toBe("ended");
    expect(result.current.playbackEnded).toBe(true);
  });

  it("sends completed turns as bounded conversation context on follow-ups", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher({ requests }), voice: fakeVoice() }));

    await act(async () => { await result.current.ask("Create a fox hero"); });
    await act(async () => { await result.current.ask("Now make it mysterious"); });

    const responses = requests.filter(({ action }) => action === "response");
    expect(responses[0]?.body).toMatchObject({ prompt: "Create a fox hero", conversation: [] });
    expect(responses[1]?.body).toMatchObject({
      prompt: "Now make it mysterious",
      conversation: [{
        prompt: "Create a fox hero",
        response: expect.stringContaining("Spoken one-1"),
      }],
    });
  });

  it("starts a selected suggestion's prepared hook and footage immediately", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    let finishOpening!: () => void;
    const openingFinished = new Promise<void>((resolve) => { finishOpening = resolve; });
    const voice = {
      ...fakeVoice(),
      speak: vi.fn(() => openingFinished),
    };
    const { result } = renderHook(() => useVideoChat({
      fetcher: videoChatFetcher({ requests }),
      voice,
    }));
    const suggestion = {
      prompt: "Explain the Moon's locked face",
      opening: "The Moon turns, perfectly matching its orbit.",
      media: { url: "https://media.example/suggested-moon.mp4", type: "video" as const },
    };

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask(suggestion.prompt, {
      openingMedia: suggestion.media,
      opening: suggestion.opening,
    }); });

    await waitFor(() => expect(result.current.currentTurn?.openingMedia).toEqual(suggestion.media));
    await waitFor(() => expect(voice.speak).toHaveBeenCalledWith(
      suggestion.opening,
      expect.any(Object),
    ));
    await waitFor(() => expect(requests.find(({ action }) => action === "response")?.body).toMatchObject({
      prompt: suggestion.prompt,
      opening: suggestion.opening,
    }));
    expect(requests.some(({ action }) => action === "opening-media")).toBe(false);
    expect(result.current.playerProps).toBeUndefined();

    finishOpening();
    await act(async () => { await openingFinished; await pending; });
    await waitFor(() => expect(result.current.playerProps?.stream).toBeDefined());
  });

  it("uses the authored opening without issuing an extra media request", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    let finishOpening!: () => void;
    const openingFinished = new Promise<void>((resolve) => { finishOpening = resolve; });
    const voice = {
      ...fakeVoice(),
      speak: vi.fn(() => openingFinished),
    };
    const { result } = renderHook(() => useVideoChat({
      fetcher: videoChatFetcher({ requests }),
      voice,
    }));

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask("Take me somewhere unexpected"); });

    await waitFor(() => expect(result.current.currentTurn?.opening).toBe("Let us begin somewhere unexpected."));
    expect(result.current.currentTurn?.openingMedia).toBeUndefined();
    expect(requests.some(({ action }) => action === "opening-media")).toBe(false);
    expect(result.current.playerProps).toBeUndefined();

    finishOpening();
    await act(async () => { await openingFinished; await pending; });
    await waitFor(() => expect(result.current.playerProps?.stream).toBeDefined());
  });

  it("does not wait for late intro footage or attach it to a subsequent turn", async () => {
    const { useVideoChat } = await import("../src/react");
    let release!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => { release = resolve; });
    const base = videoChatFetcher();
    const fetcher: typeof fetch = (input, init) => String(input).includes("action=opening-media")
      ? delayed : base(input, init);
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));
    await act(async () => { await result.current.ask("First response"); });
    expect(result.current.playerProps?.stream).toBeDefined();
    expect(result.current.currentTurn?.openingMedia).toBeUndefined();
    await act(async () => { await result.current.ask("Next response"); });
    await act(async () => { release(Response.json({ media: { url: "https://media.example/late.mp4", type: "video" } })); });
    expect(result.current.currentTurn?.openingMedia).toBeUndefined();
    expect(result.current.playerProps?.stream).toBeDefined();
  });

  it("does not send an interrupted partial response as conversation context", async () => {
    const { useVideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    let responseCount = 0;
    const base = videoChatFetcher({ requests });
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action !== "response") return base(input, init);
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ action, body });
      responseCount += 1;
      if (responseCount > 1) return responseStream("replacement", [scene("replacement", "Replacement", "Complete")]);

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const events = [
            { protocolVersion: "0.6", type: "response.start", eventId: "partial:0", runId: "partial", sequence: 0, data: { requestId: "partial", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
            { protocolVersion: "0.6", type: "scene.add", eventId: "partial:1", runId: "partial", sequence: 1, data: { scene: scene("partial", "Partial", "Abandoned"), position: 0 } },
          ];
          controller.enqueue(encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
          init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: { ...fakeVoice(), prepare: vi.fn(async () => ({ seconds: 8 })) } }));

    let first!: Promise<Video | undefined>;
    act(() => { first = result.current.ask("Abandon this response"); });
    await waitFor(() => expect(result.current.currentTurn?.video?.scenes).toHaveLength(1));
    await act(async () => { await result.current.ask("Start over cleanly"); });
    await act(async () => { await first; });

    const responses = requests.filter(({ action }) => action === "response");
    expect(responses[1]?.body).toMatchObject({
      prompt: "Start over cleanly",
      conversation: [],
    });
  });

  it.each([['pexels', 'pexels'], ['unknown', 'cinematic']] as const)("records the host's resolved mode %s", async (resolved, expected) => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input), "https://app.example").searchParams.get("action") !== "response") return base(input, init);
      const response = responseStream("resolved-mode", [scene("mode", "Mode", "Mode")]);
      response.headers.set("x-vanillasky-resolved-video-mode", resolved);
      return response;
    };
    const { result } = renderHook(() => useVideoChat({fetcher, voice: fakeVoice(), mode: "cinematic"}));
    await act(async () => { await result.current.ask("Explain a topic"); });
    expect(result.current.shownTurn?.mode).toBe(expected);
  });

  it("records a credit fallback separately from an intentional Pexels choice", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input), "https://app.example").searchParams.get("action") !== "response") return base(input, init);
      const response = responseStream("credit-fallback", [scene("fallback", "Pexels", "Using stock footage")]);
      response.headers.set("x-vanillasky-resolved-video-mode", "pexels");
      response.headers.set("x-vanillasky-video-fallback", "credits");
      return response;
    };
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), mode: "cinematic" }));
    await act(async () => { await result.current.ask("Explain a topic"); });
    expect(result.current.shownTurn).toMatchObject({ mode: "pexels", fallback: "credits" });
  });

  it("records credit exhaustion announced after a cinematic response starts", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input), "https://app.example").searchParams.get("action") !== "response") return base(input, init);
      const response = responseStream("late-credits", [scene("stock", "Pexels", "The answer continues.")]);
      const events = (await response.text()).split("\n\n").filter(block => block && !block.includes("[DONE]")).map(block => JSON.parse(block.slice(6)));
      events.splice(2, 0, { type: "response.warning", data: { warning: { code: "credits_exhausted", category: "media", message: "Credits exhausted", recoverable: true } } });
      const body = events.map((event, sequence) => `data: ${JSON.stringify({ ...event, protocolVersion: "0.6", runId: "late-credits", eventId: `late-credits:${sequence}`, sequence })}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(body, { headers: response.headers });
    };
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), mode: "cinematic" }));
    await act(async () => { await result.current.ask("Explain a topic"); });
    expect(result.current.shownTurn).toMatchObject({ mode: "cinematic", fallback: "credits" });
    expect(result.current.warnings).toEqual([]);
  });

  it("preserves the requested mode while capabilities are still loading", async () => {
    const { useVideoChat } = await import("../src/react");
    let releaseCapabilities!: (response: Response) => void;
    const capabilities = new Promise<Response>((resolve) => { releaseCapabilities = resolve; });
    let responseBody: { mode?: string } | undefined;
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "capabilities") return capabilities;
      if (action === "response") {
        responseBody = JSON.parse(String(init?.body)) as { mode?: string };
        return responseStream("immediate-mode", [scene("mode", "Mode", "Mode")]);
      }
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), mode: "cinematic" }));

    await act(async () => { await result.current.ask("Use generated video immediately"); });
    expect(responseBody?.mode).toBe("cinematic");
    releaseCapabilities(Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: false, transcription: false, modes: ["cinematic"] }));
  });

  it("keeps pause, voice, replay, and history selection synchronized with the player", async () => {
    const { useVideoChat } = await import("../src/react");
    const voice = fakeVoice();
    const { result } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher(), voice }));

    await act(async () => { await result.current.ask("First response"); });
    const firstId = result.current.currentTurn!.id;
    await act(async () => { await result.current.ask("Second response"); });

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    expect(result.current.playerProps?.paused).toBe(true);
    expect(voice.pause).toHaveBeenCalledOnce();
    act(() => result.current.resume());
    expect(voice.resume).toHaveBeenCalled();

    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    expect(voice.setMuted).toHaveBeenLastCalledWith(true);

    const keyBefore = result.current.playerKey;
    act(() => result.current.selectTurn(firstId));
    expect(result.current.shownTurn?.id).toBe(firstId);
    expect(result.current.playerKey).toBeGreaterThan(keyBefore);
    expect(result.current.playerProps).toHaveProperty("video", result.current.shownTurn?.video);
    act(() => result.current.playerProps?.onPlaybackEnd?.(result.current.shownTurn!.video!));
    expect(result.current.playbackEnded).toBe(true);
    act(() => result.current.replay());
    expect(result.current.playbackEnded).toBe(false);
    expect(result.current.playerKey).toBeGreaterThan(keyBefore + 1);
  });

  it("does not abort composition when replay has no completed video yet", async () => {
    const { useVideoChat } = await import("../src/react");
    let responseSignal: AbortSignal | undefined;
    let releaseResponse!: (response: Response) => void;
    const responseReady = new Promise<Response>((resolve) => { releaseResponse = resolve; });
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "response") {
        responseSignal = init?.signal ?? undefined;
        return responseReady;
      }
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask("Still composing"); });
    await waitFor(() => expect(responseSignal).toBeDefined());
    act(() => result.current.replay());
    expect(responseSignal?.aborted).toBe(false);

    releaseResponse(responseStream("replay-guard", [scene("guard", "Finished", "Finished")]));
    await act(async () => { await pending; });
    expect(result.current.currentTurn?.completed).toBe(true);
  });

  it("does not abort composition for an invalid history selection", async () => {
    const { useVideoChat } = await import("../src/react");
    let responseSignal: AbortSignal | undefined;
    let releaseResponse!: (response: Response) => void;
    const responseReady = new Promise<Response>((resolve) => { releaseResponse = resolve; });
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "response") {
        responseSignal = init?.signal ?? undefined;
        return responseReady;
      }
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask("Still composing"); });
    await waitFor(() => expect(responseSignal).toBeDefined());
    act(() => result.current.selectTurn("missing-turn"));
    expect(responseSignal?.aborted).toBe(false);

    releaseResponse(responseStream("select-guard", [scene("guard", "Finished", "Finished")]));
    await act(async () => { await pending; });
    expect(result.current.currentTurn?.completed).toBe(true);
  });

  it("cancels replaced prompts and discards their late results", async () => {
    const { useVideoChat } = await import("../src/react");
    let firstSignal: AbortSignal | undefined;
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let responseCount = 0;
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "response") {
        responseCount += 1;
        if (responseCount === 1) {
          firstSignal = init?.signal ?? undefined;
          await firstReleased;
          return responseStream("late", [scene("late", "Late", "Late answer")]);
        }
      }
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));

    let first: Promise<Video | undefined>;
    act(() => { first = result.current.ask("Old prompt"); });
    await waitFor(() => expect(firstSignal).toBeDefined());
    await act(async () => { await result.current.ask("New prompt"); });
    releaseFirst();
    await act(async () => { await first; });

    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.currentTurn?.prompt).toBe("New prompt");
    expect(result.current.currentTurn?.video?.scenes[0]?.id).not.toBe("late");
  });

  it("retries stock planning once before playback starts", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    let responses = 0;
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "response" && responses++ === 0) {
        return Response.json({ error: { code: "provider_failed", message: "Planning failed" } }, { status: 502 });
      }
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), mode: "pexels" }));

    await act(async () => { await result.current.ask("Recover this response"); });

    expect(responses).toBe(2);
    expect(result.current.currentTurn?.video?.scenes).toHaveLength(2);
    expect(result.current.error).toBeUndefined();
  });

  it("reports timeouts and explicit cancellation without accepting late work", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action !== "response") return base(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const { result, rerender } = renderHook(
      ({ timeoutMs }) => useVideoChat({ fetcher, voice: fakeVoice(), timeoutMs }),
      { initialProps: { timeoutMs: 5 } },
    );

    await act(async () => { await result.current.ask("Time out"); });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toContain("timed out");

    rerender({ timeoutMs: 10_000 });
    let cancelled: Promise<Video | undefined>;
    act(() => { cancelled = result.current.ask("Cancel this"); });
    await waitFor(() => expect(result.current.status).toMatch(/composing|playing/));
    act(() => result.current.cancel());
    await act(async () => { await cancelled; });
    expect(result.current.status).toBe("cancelled");
  });

  it("starts a short prepared scene before planning finishes and closes it on cancellation", async () => {
    const { useVideoChat } = await import("../src/react");
    const encoder = new TextEncoder();
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action !== "response") return base(input, init);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const events = [
            { protocolVersion: "0.6", type: "response.start", eventId: "cancel:0", runId: "cancel", sequence: 0, data: { requestId: "cancel", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
            { protocolVersion: "0.6", type: "scene.add", eventId: "cancel:1", runId: "cancel", sequence: 1, data: { scene: scene("cancelled", "Partial", "First line"), position: 0 } },
          ];
          controller.enqueue(encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
          init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask("Cancel after playback starts"); });
    await waitFor(() => expect(result.current.playerProps?.stream).toBeDefined());
    const playerStream = result.current.playerProps!.stream!;
    act(() => result.current.cancel());
    await act(async () => { await pending; });

    expect(result.current.status).toBe("cancelled");
    expect(result.current.playerProps).toBeUndefined();
    const events = [];
    for await (const event of playerStream) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
  });

  it("preserves and completes the playable response after a terminal failure", async () => {
    const { useVideoChat } = await import("../src/react");
    let fail!: () => void;
    const failureReady = new Promise<void>((resolve) => { fail = resolve; });
    const encoder = new TextEncoder();
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action !== "response") return base(input, init);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const first = [
            { protocolVersion: "0.6", type: "response.start", eventId: "terminal:0", runId: "terminal", sequence: 0, data: { requestId: "terminal", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
            { protocolVersion: "0.6", type: "scene.add", eventId: "terminal:1", runId: "terminal", sequence: 1, data: { scene: scene("terminal", "Partial", "First line"), position: 0 } },
          ];
          controller.enqueue(encoder.encode(first.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
          void failureReady.then(() => {
            const event = { protocolVersion: "0.6", type: "response.error", eventId: "terminal:2", runId: "terminal", sequence: 2, data: { error: { code: "generation_failed", message: "Planning stopped", recoverable: false }, terminal: true } };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`));
            controller.close();
          });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: { ...fakeVoice(), prepare: vi.fn(async () => ({ seconds: 8 })) } }));

    let pending!: Promise<Video | undefined>;
    act(() => { pending = result.current.ask("Fail after playback starts"); });
    await waitFor(() => expect(result.current.playerProps?.stream).toBeDefined());
    const playerStream = result.current.playerProps!.stream!;
    fail();
    await act(async () => { await pending; });

    expect(result.current.error).toBeUndefined();
    expect(result.current.currentTurn?.completed).toBe(true);
    expect(result.current.playerProps?.stream).toBe(playerStream);
    expect(result.current.warnings.length).toBeGreaterThan(0);
    const events = [];
    for await (const event of playerStream) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
  });

  it.each([502, 200])("uses scene narration fallback for unusable narration HTTP %s", async (status) => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => String(input).includes("action=narration")
      ? Response.json({ line: "" }, { status }) : base(input, init));
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: { ...fakeVoice(), prepare: vi.fn(async () => ({ seconds: 8 })) } }));
    await act(async () => { await result.current.ask("Keep going"); });
    expect(result.current.currentTurn?.video?.scenes[0]?.narration).toBe("First");
    expect(result.current.warnings.length).toBeGreaterThan(0);
  });

  it("finishes received scenes when optional narration ignores the request timeout", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => String(input).includes("action=narration")
      ? new Promise<Response>(() => undefined) : base(input, init));
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice(), timeoutMs: 30 }));
    await act(async () => { await result.current.ask("Keep completed scenes"); });
    expect(result.current.currentTurn?.video?.scenes).toHaveLength(2);
    expect(result.current.currentTurn?.completed).toBe(true);
    expect(result.current.error).toBeUndefined();
  });

  it("reports an error when an opening has no actual response scenes", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => String(input).includes("action=response")
      ? responseStream("empty", []) : base(input, init));
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));
    await act(async () => { await result.current.ask("Keep the opening"); });
    expect(result.current.currentTurn?.video).toBeUndefined();
    expect(result.current.error?.code).toBe("empty_response");
    expect(result.current.currentTurn?.completed).toBe(false);
  });

  it.each([429, 503])("reports HTTP %s after an optimistic suggestion instead of completing its opening", async (status) => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => String(input).includes("action=response")
      ? new Response("private provider details", { status }) : base(input, init));
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));
    await act(async () => { await result.current.ask("Explain the Moon", { opening: "The Moon keeps one face toward us." }); });
    expect(result.current.currentTurn?.video).toBeUndefined();
    expect(result.current.currentTurn?.completed).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.status).toBe(status);
    expect(result.current.error?.message).not.toContain("private provider details");
    if (status === 429) expect(result.current.error?.message).toBe("Too many requests right now. Please try again shortly.");
  });

  it("warns when the default voice recovers a speech provider failure", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => String(input).includes("action=speech")
      ? new Response("private provider failure", { status: 502 }) : base(input, init));
    const { result } = renderHook(() => useVideoChat({ fetcher }));
    await act(async () => { await result.current.ask("Keep speaking"); });
    expect(result.current.currentTurn?.video?.scenes).toHaveLength(2);
    expect(result.current.warnings).toContain("Using browser voice for this response.");
    expect(JSON.stringify(result.current.warnings)).not.toContain("private");
  });

  it("keeps every scene when narration and speech preparation fail", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      if (String(input).includes("action=narration")) throw new Error("private provider detail");
      return base(input, init);
    });
    const voice = fakeVoice();
    voice.prepare.mockRejectedValue(new Error("private speech detail"));
    const { result } = renderHook(() => useVideoChat({ fetcher, voice }));
    let video: Video | undefined;
    await act(async () => { video = await result.current.ask("Keep going"); });
    expect(video?.scenes).toHaveLength(2);
    expect(result.current.error).toBeUndefined();
    expect(result.current.currentTurn?.opening).toBe("Let us begin somewhere unexpected.");
    expect(result.current.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.current.warnings)).not.toContain("private");
  });

  it("keeps a playable video when follow-up suggestions fail", async () => {
    const { useVideoChat } = await import("../src/react");
    const base = videoChatFetcher();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "suggestions") throw new Error("Suggestion provider unavailable");
      return base(input, init);
    });
    const { result } = renderHook(() => useVideoChat({ fetcher, voice: fakeVoice() }));

    let completed: Video | undefined;
    await act(async () => { completed = await result.current.ask("Keep the useful answer"); });

    expect(completed?.scenes).toHaveLength(2);
    expect(result.current.status).toBe("playing");
    expect(result.current.error).toBeUndefined();
    expect(result.current.suggestions).toEqual([]);
  });


  it("restores archived completed turns after reset and can select an earlier answer", async () => {
    const { useVideoChatSession } = await import("../src/video-chat/use-video-chat");
    const { result } = renderHook(() => useVideoChatSession({ fetcher: videoChatFetcher(), voice: fakeVoice() }));
    await act(async () => { await result.current.chat.ask("First question", { opening: "The opening belongs to the full answer." }); });
    await act(async () => { await result.current.chat.ask("Second question"); });
    const saved = result.current.chat.turns;
    act(() => result.current.chat.reset());
    expect(result.current.chat.turns).toHaveLength(0);
    act(() => result.current.restoreSession(saved));
    expect(result.current.chat.turns).toEqual(saved);
    expect(result.current.chat.shownTurn?.id).toBe(saved[1]!.id);
    expect(result.current.chat.status).toBe("playing");
    act(() => result.current.chat.selectTurn(saved[0]!.id));
    expect(result.current.chat.shownTurn?.id).toBe(saved[0]!.id);
    expect(result.current.chat.playerProps?.video).toEqual(saved[0]!.video);
    expect(result.current.chat.transcript[0]).toBe("The opening belongs to the full answer.");
    expect(result.current.chat.transcript.filter(line => line === "The opening belongs to the full answer.")).toHaveLength(1);
    expect(Object.keys(result.current.chat)).not.toContain("restoreSession");
    const longHistory = Array.from({ length: 105 }, (_, index) => ({ ...saved[0]!, id: `saved-${index}` }));
    act(() => result.current.restoreSession([...longHistory, { ...saved[1]!, id: "unfinished", completed: false }]));
    expect(result.current.chat.turns).toHaveLength(100);
    expect(result.current.chat.turns[0]?.id).toBe("saved-5");
    expect(result.current.chat.shownTurn?.id).toBe("saved-104");
  });

  it("isolates restored history from a pending response that ignores cancellation", async () => {
    const { useVideoChatSession } = await import("../src/video-chat/use-video-chat");
    let resolvePending!: (response: Response) => void;
    let responseSignal: AbortSignal | undefined;
    const base = videoChatFetcher();
    let hold = false;
    const fetcher: typeof fetch = (input, init) => {
      if (hold && new URL(String(input), "https://app.example").searchParams.get("action") === "response") {
        responseSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => { resolvePending = resolve; });
      }
      return base(input, init);
    };
    const voice = fakeVoice();
    const { result } = renderHook(() => useVideoChatSession({ fetcher, voice }));
    await act(async () => { await result.current.chat.ask("Archived answer"); });
    const saved = result.current.chat.turns;
    hold = true;
    let pending!: ReturnType<typeof result.current.chat.ask>;
    act(() => { pending = result.current.chat.ask("Abandoned answer"); });
    await waitFor(() => expect(resolvePending).toBeTypeOf("function"));
    act(() => result.current.restoreSession(saved));
    expect(responseSignal?.aborted).toBe(true);
    await act(async () => {
      resolvePending(responseStream("late", [scene("late", "Must not replace history")]));
      await pending;
    });
    expect(result.current.chat.turns).toEqual(saved);
    expect(result.current.chat.shownTurn?.prompt).toBe("Archived answer");
    expect(result.current.chat.status).toBe("playing");
  });
  it("resets the full session and aborts work on unmount", async () => {
    const { useVideoChat } = await import("../src/react");
    const voice = fakeVoice();
    const { result, unmount } = renderHook(() => useVideoChat({ fetcher: videoChatFetcher(), voice }));
    await act(async () => { await result.current.ask("A response"); });

    act(() => result.current.reset());
    expect(result.current.turns).toEqual([]);
    expect(result.current.status).toBe("idle");
    unmount();
    expect(voice.dispose).not.toHaveBeenCalled();
  });
});

describe("createVideoChatVoice", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["browser", "generated"])("settles %s speech when playback never reports completion", async (source) => {
    const { createVideoChatVoice } = await import("../src/react");
    vi.useFakeTimers();
    vi.stubGlobal("speechSynthesis", { speak: (utterance: { onstart?: () => void }) => utterance.onstart?.(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    vi.stubGlobal("Audio", class { play() { return Promise.resolve(); } pause() {} });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:audio"), revokeObjectURL: vi.fn() }));
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => source === "browser"
      ? new Response(null, { status: 204 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })) });
    let settled = false;
    const speaking = Promise.resolve(voice.speak("Keep going.", { signal: new AbortController().signal })).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    voice.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    voice.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(true);
    await speaking;
    expect(vi.getTimerCount()).toBe(0);
    voice.dispose?.();
  });

  it.each(["end", "abort", "dispose"])("cleans the speech watchdog and abort listener on %s", async (finish) => {
    const { createVideoChatVoice } = await import("../src/react");
    vi.useFakeTimers();
    let utterance: { onend?: () => void } | undefined;
    vi.stubGlobal("speechSynthesis", { speak: (value: typeof utterance) => { utterance = value; }, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response(null, { status: 204 })) });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const speaking = voice.speak("Keep going.", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    remove.mockClear();
    if (finish === "abort") controller.abort();
    else if (finish === "dispose") voice.dispose?.();
    else utterance?.onend?.();
    await speaking;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    voice.dispose?.();
  });

  it("remembers the server's browser-voice fallback without repeating requests", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const voice = createVideoChatVoice({ fetcher });

    await voice.prepare("The first browser-spoken line.");
    await voice.prepare("The second browser-spoken line.");

    expect(fetcher).toHaveBeenCalledOnce();
    voice.dispose?.();
  });

  it("falls back to browser speech when generated speech is unavailable", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    const speak = vi.fn((utterance: { onend?: () => void }) => utterance.onend?.());
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      rate = 1;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    });
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response("missing", { status: 404 })) });

    expect((await voice.prepare("A short spoken response.")).seconds).toBeGreaterThan(0);
    await voice.speak("A short spoken response.", { signal: new AbortController().signal });

    expect(speak).toHaveBeenCalledOnce();
    voice.dispose?.();
  });

  it.each(["play", "resume"])("uses browser speech when generated audio cannot %s", async (failure) => {
    const { createVideoChatVoice } = await import("../src/react");
    const speak = vi.fn((utterance: { onend?: () => void }) => utterance.onend?.());
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    vi.stubGlobal("Audio", class {
      play() { return Promise.reject(new Error("private playback failure")); }
      pause() {}
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:audio"), revokeObjectURL: vi.fn() }));
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })) });
    if (failure === "resume") voice.pause();
    const speaking = voice.speak("Keep speaking.", { signal: new AbortController().signal });
    if (failure === "resume") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      voice.resume();
    }
    await speaking;
    expect(speak).toHaveBeenCalledOnce();
    voice.dispose?.();
  });

  it("cancels generated speech preparation with its prompt", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    let requestSignal: AbortSignal | undefined;
    const voice = createVideoChatVoice({
      fetcher: vi.fn((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
        });
      }),
    });
    const controller = new AbortController();
    const preparing = voice.prepare("A line that gets replaced.", { signal: controller.signal });

    controller.abort(new DOMException("Prompt replaced", "AbortError"));

    await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
    voice.dispose?.();
  });

  it("does not couple concurrent same-text preparations to the first caller's abort signal", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    const pending: Array<{ resolve(response: Response): void; reject(cause: unknown): void }> = [];
    const voice = createVideoChatVoice({
      fetcher: vi.fn((_input, init) => new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject });
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })),
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = voice.prepare("The same line.", { signal: firstController.signal });
    const second = voice.prepare("The same line.", { signal: secondController.signal });

    expect(pending).toHaveLength(2);
    firstController.abort(new DOMException("First caller replaced", "AbortError"));
    pending[1]!.resolve(new Response("missing", { status: 404 }));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ seconds: expect.any(Number) });
    voice.dispose?.();
  });

  it("does not let a later same-text caller cancel the first preparation", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    const pending: Array<{ resolve(response: Response): void; reject(cause: unknown): void }> = [];
    const voice = createVideoChatVoice({
      fetcher: vi.fn((_input, init) => new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject });
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })),
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = voice.prepare("Another repeated line.", { signal: firstController.signal });
    const second = voice.prepare("Another repeated line.", { signal: secondController.signal });

    expect(pending).toHaveLength(2);
    secondController.abort(new DOMException("Second caller replaced", "AbortError"));
    pending[0]!.resolve(new Response("missing", { status: 404 }));

    await expect(first).resolves.toMatchObject({ seconds: expect.any(Number) });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    voice.dispose?.();
  });

  it("cannot start speech after the voice is disposed during a pending load", async () => {
    const { createVideoChatVoice } = await import("../src/react");
    let release!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    const synthesisSpeak = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      speak: synthesisSpeak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      rate = 1;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    });
    const voice = createVideoChatVoice({
      fetcher: vi.fn((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => { release = resolve; });
      }),
    });
    const speaking = voice.speak("Never say this.", { signal: new AbortController().signal });

    voice.dispose?.();
    expect(requestSignal?.aborted).toBe(true);
    release(new Response("missing", { status: 404 }));

    await expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    expect(synthesisSpeak).not.toHaveBeenCalled();
  });
});


it.each([true, false])("publishes a group only with measured offset-capable audio (%s)", async (supported) => {
  const { useVideoChat } = await import("../src/react");
  const grouped = ["First thought.", "Second thought."].map((line, index) => ({ ...scene(String(index), "Quiet", line),
    timing: { fixedDuration: 3 }, narrationGroup: { id: "group", text: "First thought. Second thought.", offsetSeconds: index * 3, durationSeconds: 3, totalSeconds: 6 },
  }));
  const base = videoChatFetcher();
  const fetcher: typeof fetch = (input, init) => String(input).includes("action=response")
    ? Promise.resolve(responseStream("group", grouped, { line: "", keyword: "", fallbackKeyword: "" })) : base(input, init);
  const voice = { ...fakeVoice(), supportsOffsets: supported, prepare: vi.fn(async () => ({ seconds: 6, supportsOffsets: supported })) };
  const { result, unmount } = renderHook(() => useVideoChat({ fetcher, voice }));
  await act(async () => { await result.current.ask("A short paragraph"); });
  if (supported) {
    expect(result.current.currentTurn?.video?.scenes.map((entry) => entry.timing.fixedDuration)).toEqual([3, 3]);
    expect(voice.prepare).toHaveBeenCalledWith("First thought. Second thought.", expect.anything());
    voice.prepare.mockClear();
    await act(async () => { result.current.replay(); await Promise.resolve(); });
    await waitFor(() => expect(voice.prepare).toHaveBeenCalledWith("First thought. Second thought.", expect.anything()));
  } else {
    expect(result.current.error).toBeTruthy();
    expect(result.current.playerProps).toBeUndefined();
  }
  unmount();
});

it("forwards the prepared audio clock through the actual chat player props", async () => {
  const { useVideoChat } = await import("../src/react");
  const { usePlaybackClock } = await import("../src/player/use-playback-clock");
  const { createVideoState } = await import("../src/protocol/state");
  let audioTime: number | undefined;
  let onset: (() => void) | undefined;
  const voice = { ...fakeVoice(), getCurrentTime: () => audioTime, speak: vi.fn((_text: string, options: { onStart?: () => void }) => {
    onset = options.onStart;
    return new Promise<void>(() => undefined);
  }) };
  const base = videoChatFetcher();
  const fetcher: typeof fetch = (input, init) => String(input).includes("action=response")
    ? Promise.resolve(responseStream("clock", [scene("ordinary", "First", "A short thought.")], { line: "", keyword: "", fallbackKeyword: "" })) : base(input, init);
  const chat = renderHook(() => useVideoChat({ fetcher, voice }));
  await act(async () => { await chat.result.current.ask("A thought"); });
  const video = chat.result.current.currentTurn!.video!;
  const timeRef = { current: 0 };
  vi.useFakeTimers();
  const clock = renderHook(() => usePlaybackClock({ isPlaying: true, stateRef: { current: { ...createVideoState(), status: "complete", config: video } }, timeRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: chat.result.current.playerProps! }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() }));
  try {
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(chat.result.current.playerProps!.narrationReady?.()).toBe(false);
    audioTime = 0.05; act(() => onset?.());
    await act(() => vi.advanceTimersByTimeAsync(1800));
    expect(timeRef.current).toBe(0.05);
    audioTime = 1.5;
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(timeRef.current).toBe(1.5);
    expect(chat.result.current.playerProps!.narrationTime?.(video.scenes[0])).toBe(1.5);
  } finally {
    clock.unmount(); chat.unmount(); vi.useRealTimers();
  }
});

it("keeps received video playable with a warning when native browser speech never starts", async () => {
  const { useVideoChat } = await import("../src/react");
  const { usePlaybackClock } = await import("../src/player/use-playback-clock");
  const { createVideoState } = await import("../src/protocol/state");
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel, pause: vi.fn(), resume: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", class {});
  const base = videoChatFetcher();
  const fetcher: typeof fetch = (input, init) => String(input).includes("action=response")
    ? Promise.resolve(responseStream("blocked-voice", [scene("one", "First", "A thought worth seeing.")], { line: "", keyword: "", fallbackKeyword: "" }))
    : String(input).includes("action=speech") ? Promise.resolve(new Response(null, { status: 204 })) : base(input, init);
  const chat = renderHook(() => useVideoChat({ fetcher }));
  await act(async () => { await chat.result.current.ask("Show a thought"); });
  const video = chat.result.current.currentTurn!.video!;
  const timeRef = { current: 0 }; const onStop = vi.fn();
  vi.useFakeTimers();
  const clock = renderHook(() => usePlaybackClock({ isPlaying: true, stateRef: { current: { ...createVideoState(), status: "complete", config: video } }, timeRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: chat.result.current.playerProps! }, setCurrentTime: vi.fn(), setIsPlaying: onStop }));
  try {
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(timeRef.current).toBeGreaterThan(1);
    expect(cancel).toHaveBeenCalled();
    expect(chat.result.current.error).toBeUndefined();
    expect(chat.result.current.currentTurn!.video).toEqual(video);
    expect(chat.result.current.warnings).toContain("Voice playback is unavailable. Continuing with subtitles.");
    expect(chat.result.current.playerProps).toBeDefined();
  } finally {
    clock.unmount(); chat.unmount(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
