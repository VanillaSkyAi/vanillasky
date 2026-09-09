// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoChat, useVideoChat } from "../src/react";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";
import { checksumVideo } from "../src/protocol/checksum";
import type { Video } from "../src/protocol/types";

afterEach(cleanup);
const voice = () => ({ prepare: vi.fn(async () => ({ seconds: 1 })), speak: vi.fn(async () => {}), pause() {}, resume() {}, setMuted() {} });
const fallbackFetch: typeof fetch = async (input) => new URL(String(input), "http://local").searchParams.get("action") === "capabilities"
  ? Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: true, transcription: false, modes: ["cinematic", "pexels"] })
  : Response.json({ hero: null, cards: [], suggestions: [] });

it("shows the real chapter immediately, before the response produces any text", async () => {
  const fetcher: typeof fetch = (input, init) => new URL(String(input), "http://local").searchParams.get("action") === "response"
    ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
    : fallbackFetch(input, init);
  const { container } = render(<VideoChat options={{ fetcher, voice: voice() }} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "How to play golf?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(container.querySelector('[data-template="title"]')?.textContent).toBe("How to play golf?");
  expect(container.querySelector(".asked, .ground")).toBeNull();
});

it("selects Pexels in settings and sends it with the next prompt", async () => {
  const requests: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input), "http://local").searchParams.get("action") !== "response") return fallbackFetch(input, init);
    requests.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 503 });
  };
  render(<VideoChat options={{ fetcher, voice: voice() }} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Pexels/ }));
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "How to play golf?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ mode: "pexels" })));
});

it("prepares authored speech before footage arrives with at most two requests and no repeated synthesis", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let sequence = 0;
  const send = (type: string, data: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ protocolVersion: "0.6", runId: "early", sequence, eventId: `early:${sequence++}`, type, data })}\n\n`));
  const lines = ["Choose a comfortable grip.", "Stand with balanced weight.", "Swing smoothly through the ball."];
  const finish: Array<() => void> = [];
  const audio = voice();
  audio.prepare = vi.fn(() => new Promise<{seconds:number}>(resolve => finish.push(() => resolve({seconds:1}))));
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const action = new URL(String(input), "http://local").searchParams.get("action")!;
    calls.push(action);
    if (action !== "response") return fallbackFetch(input, init);
    return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "content-type": "text/event-stream" } });
  };
  const { result } = renderHook(() => useVideoChat({ fetcher, voice: audio }));
  let answer!: ReturnType<typeof result.current.ask>;
  act(() => { answer = result.current.ask("How to play golf?"); });
  await waitFor(() => expect(stream).toBeDefined());
  act(() => {
    send("response.start", { requestId: "early", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"], extensions: ["data.video-chat-preparation"] } });
    lines.forEach((narration, index) => send("data.video-chat-preparation", { sceneId: `shot-${index}`, narration }));
  });
  await waitFor(() => expect(audio.prepare).toHaveBeenCalledTimes(2));
  expect(result.current.playerProps).toBeUndefined();
  await act(async () => { finish.shift()!(); });
  await waitFor(() => expect(audio.prepare).toHaveBeenCalledTimes(3));
  await act(async () => { finish.splice(0).forEach(done => done()); });
  const scenes = lines.map((narration, index) => ({ id: `shot-${index}`, templateId: "chapterTitle", variables: { title: `Step ${index+1}` }, narration, timing: { fixedDuration: 4 } }));
  const snapshot: Video = { schemaVersion: "0.2", orientation: "landscape", scenes, style: TEST_VIDEO_STYLE };
  await act(async () => {
    scenes.forEach((scene, position) => send("scene.add", { scene, position }));
    send("response.complete", { snapshot, checksum: checksumVideo(snapshot), finishReason: "stop" });
    stream.close();
    await answer;
  });
  expect(audio.prepare).toHaveBeenCalledTimes(3);
  expect(result.current.currentTurn?.completed).toBe(true);
  expect(calls).not.toContain("opening-media");
});

it("describes request throttling without claiming the conversation allowance is exhausted", async () => {
  const { result } = renderHook(() => useVideoChat({ voice: voice(), fetcher: async (input, init) => new URL(String(input), "http://local").searchParams.get("action") === "response"
    ? new Response("private quota details", { status: 429, headers: { "retry-after": "60" } }) : fallbackFetch(input, init) }));
  await act(async () => { await result.current.ask("How to play golf?"); });
  expect(result.current.error?.message).toMatch(/Too many requests/);
  expect(result.current.error?.message).not.toMatch(/conversation limit|private quota/);
});
