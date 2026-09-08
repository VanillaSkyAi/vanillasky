import { afterEach, describe, expect, it, vi } from "vitest";
import { createFalVideo } from "../starters/video-chat/providers/video";
import { createGoogleVideo } from "../starters/video-chat/providers/video-google";
import { createRunwayVideo } from "../starters/video-chat/providers/video-runway";
import { textProvider } from "../starters/video-chat/providers/text-native";
import { downloadVideo } from "../starters/video-chat/providers/video-delivery";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const context = (duration: number) => ({
  signal: new AbortController().signal, purpose: "response" as const, orientation: "portrait" as const,
  requestedDurationSec: duration, deadlineAt: Date.now() + 1000, shotDirection: "Track the cyclist", generatedLook: "Documentary",
});
const json = (value: unknown) => Response.json(value);

describe("reference video adapters (offline HTTP contracts)", () => {
  it.each([
    { vendor: "fal", create: createFalVideo, duration: 5, responses: [
      { request_id: "job", status_url: "https://queue.fal.run/model/requests/job/status", response_url: "https://queue.fal.run/model/requests/job", cancel_url: "https://queue.fal.run/model/requests/job/cancel" },
      { status: "COMPLETED" }, { video: { url: "https://v3.fal.media/clip.mp4" } },
    ] },
    { vendor: "google", create: createGoogleVideo, duration: 6, responses: [
      { name: "models/veo-3.1-fast-generate-preview/operations/job" },
      { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/clip:download" } }] } } },
    ] },
    { vendor: "runway", create: createRunwayVideo, duration: 5, responses: [
      { id: "job", estimatedCost: { credits: 60 } },
      { id: "job", status: "SUCCEEDED", createdAt: "2026-09-08T00:00:00Z", cost: { credits: 60 }, output: ["https://cdn.runwayml.com/clip.mp4"] },
    ] },
  ])("$vendor submits one supported portrait job and delivers public bytes + duration", async ({ vendor, create, duration, responses }) => {
    const requests: { url: string; init?: RequestInit }[] = [];
    let index = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return index < responses.length ? json(responses[index++]) : new Response("mp4-bytes", { headers: { "content-type": "video/mp4" } });
    });
    const generate = create("server-only-key", async ({ response, jobId, durationSec }) => {
      expect(jobId).toContain("job");
      expect(durationSec).toBe(duration);
      expect(await response.text()).toBe("mp4-bytes");
      return "https://app.example/video.mp4";
    });
    expect(await generate("A cyclist rides", context(duration))).toEqual({ url: "https://app.example/video.mp4", type: "video", durationSec: duration });
    expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(1);
    const body = JSON.parse(String(requests[0].init?.body));
    if (vendor === "fal") expect(body).toMatchObject({ duration: 5, resolution: "480P", aspect_ratio: "9:16" });
    if (vendor === "google") {
      expect(body.parameters).toMatchObject({ durationSeconds: 6, resolution: "720p", aspectRatio: "9:16" });
      expect(new Headers(requests.at(-1)?.init?.headers).get("x-goog-api-key")).toBe("server-only-key");
    }
    if (vendor === "runway") expect(body).toMatchObject({ model: "gen4.5", duration: 5, ratio: "720:1280" });
    expect(JSON.stringify(body)).toContain("Track the cyclist");
  });

  it("rejects mismatched duration before a paid submission", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return json({}); });
    await expect(createGoogleVideo("key", async () => "unused")("x", context(5))).rejects.toThrow(/duration/);
    expect(calls).toBe(0);
  });

  it("keeps Google credentials off a redirected CDN download", async () => {
    const keys: (string | null)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("x-goog-api-key"));
      return keys.length === 1 ? new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/clip.mp4" } }) : new Response("video");
    });
    expect(await (await downloadVideo("https://generativelanguage.googleapis.com/clip", new AbortController().signal, "private")).text()).toBe("video");
    expect(keys).toEqual(["private", null]);
  });

  it("does not delete a completed Runway job when delivery is aborted", async () => {
    const controller = new AbortController();
    const methods: string[] = [];
    let index = 0;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (index++ === 0) return json({ id: "completed" });
      return index === 2 ? json({ status: "SUCCEEDED", output: ["https://cdn.runwayml.com/clip.mp4"] }) : new Response("video");
    });
    const generate = createRunwayVideo("key", async ({ signal }) => { controller.abort(); signal.throwIfAborted(); return "unused"; });
    await expect(generate("A cyclist", { ...context(5), signal: controller.signal })).rejects.toMatchObject({ jobId: "completed" });
    expect(methods).not.toContain("DELETE");
  });

  it.each(["FAILED", "CANCELLED", "SUCCEEDED"])("retains Runway %s task diagnostics when no usable output is returned", async status => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return json(methods.length === 1 ? { id: "retained-task" } : { status });
    });
    await expect(createRunwayVideo("key", async () => "unused")("A cyclist", context(5))).rejects.toMatchObject({ jobId: "retained-task" });
    expect(methods).toEqual(["POST", "GET"]);
  });
});

describe("native text callbacks", () => {
  const input = () => ({ systemPrompt: "system", userPrompt: "user", signal: new AbortController().signal,
    request: { protocolVersion: "0.6" as const, requestId: "test", input: { input: "user" } },
    initialConfig: { schemaVersion: "0.2" as const, scenes: [], style: {} },
  });

  it.each([["STOP", "stop"], ["MAX_TOKENS", "length"], ["SAFETY", "content-filter"]])("exposes settled native %s completion as %s", async (raw, normalized) => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    vi.stubGlobal("fetch", async () => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "one beat" }] }, finishReason: raw }] })}\n\n`));
    const result = textProvider.streamText!(input());
    if (!("textStream" in result)) throw new Error("Expected completion metadata");
    const finish = result.finishReason;
    const rawFinish = result.rawFinishReason;
    const chunks: string[] = [];
    for await (const text of result.textStream) chunks.push(text);
    expect(chunks.join("")).toBe("one beat");
    expect(await finish).toBe(normalized);
    expect(await rawFinish).toBe(raw);
  });

  it.each(["MAX_TOKENS", "SAFETY", "PROMPT_BLOCKED"])("rejects %s instead of using a partial helper-task answer", async reason => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    vi.stubGlobal("fetch", async () => json(reason === "PROMPT_BLOCKED" ? { promptFeedback: { blockReason: "SAFETY" } }
      : { candidates: [{ content: { parts: [{ text: "partial claim" }] }, finishReason: reason }] }));
    await expect(textProvider.generateText!({ task: "narration", systemPrompt: "system", userPrompt: "user", signal: new AbortController().signal, maxOutputTokens: 100 })).rejects.toThrow(/complete|blocked/);
  });

  it("settles metadata when a consumer closes the stream before its terminal event", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    vi.stubGlobal("fetch", async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"first"}]}}]}\n\n'));
    const result = textProvider.streamText!(input());
    if (!("textStream" in result)) throw new Error("Expected completion metadata");
    const finish = result.finishReason;
    const rawFinish = result.rawFinishReason;
    const iterator = result.textStream[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: "first" });
    await iterator.return?.();
    expect(await finish).toBe("error");
    expect(await rawFinish).toBeUndefined();
  });

  it("settles failed-request metadata without an unhandled rejected promise", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    vi.stubGlobal("fetch", async () => new Response("private failure", { status: 503 }));
    const result = textProvider.streamText!(input());
    if (!("textStream" in result)) throw new Error("Expected completion metadata");
    await expect(result.textStream[Symbol.asyncIterator]().next()).rejects.toThrow("Text provider HTTP 503");
    expect(await result.finishReason).toBe("error");
    expect(await result.rawFinishReason).toBeUndefined();
  });

  it("settles an iterator closed before it starts without contacting the provider", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", async () => { requests++; return json({}); });
    const result = textProvider.streamText!(input());
    if (!("textStream" in result)) throw new Error("Expected completion metadata");
    await result.textStream[Symbol.asyncIterator]().return?.();
    expect(await result.finishReason).toBe("error");
    expect(requests).toBe(0);
  }, 200);

  it("accepts completed non-stream text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    vi.stubGlobal("fetch", async () => json({ candidates: [{ content: { parts: [{ text: "A complete answer." }] }, finishReason: "STOP" }] }));
    await expect(textProvider.generateText!({ task: "narration", systemPrompt: "system", userPrompt: "user", signal: new AbortController().signal, maxOutputTokens: 100 })).resolves.toBe("A complete answer.");
  });

  it("streams text across network/UTF-8 boundaries and never emits thought parts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private");
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"Café"}]}}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":" sky"}]}}]}');
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(controller) {
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
      controller.close();
    } })));
    const result = await textProvider.streamText!({ systemPrompt: "system", userPrompt: "user", signal: new AbortController().signal,
      request: { protocolVersion: "0.6", requestId: "test", input: { input: "user" } },
      initialConfig: { schemaVersion: "0.2", scenes: [], style: {} },
    });
    const chunks: string[] = [];
    for await (const chunk of "textStream" in result ? result.textStream : result) chunks.push(chunk);
    expect(chunks.join("")).toBe("Café sky");
  });
});
