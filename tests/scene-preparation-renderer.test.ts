// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VideoScene } from "../src/protocol/types";

const scene: VideoScene = { id: "first", templateId: "cinemaMedia", variables: {}, narration: "A complete first beat.", timing: { fixedDuration: 5 } };
const renderer = { MediaScene: () => null };

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("../src/visual-system/scene-templates/cinema-media");
  vi.restoreAllMocks();
});

async function setup(load: () => Promise<typeof renderer>, signal = new AbortController().signal) {
  vi.doMock("../src/visual-system/scene-templates/cinema-media", load);
  const { createScenePreparation } = await import("../src/video-chat/scene-preparation");
  const voice = { prepare: vi.fn(async () => ({ seconds: 2 })), speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), setMuted: vi.fn() };
  const warn = vi.fn();
  const preparation = createScenePreparation({ voice: () => voice, customVoice: true, signal,
    onVoiceUnavailable: vi.fn(), warn });
  return { preparation, voice, warn };
}

it("starts the shared renderer load before scenes arrive without delaying speech or allocating a decoder", async () => {
  let finish!: (value: typeof renderer) => void;
  const loading = new Promise<typeof renderer>(resolve => { finish = resolve; });
  const load = vi.fn(() => loading);
  const create = vi.spyOn(document, "createElement");
  const { preparation, voice } = await setup(load);
  try {
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await expect(preparation.prepareSpeech(scene.narration!)).resolves.toEqual({ seconds: 2 });
    expect(voice.prepare).toHaveBeenCalledOnce();
    expect(create.mock.calls.some(([tag]) => tag === "video")).toBe(false);
    // The ordered scene joins the load that began at Ask; it does not start a
    // second renderer request, and still waits for that exact renderer.
    const visual = preparation.prepareVisual(scene);
    let ready = false;
    void visual.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    finish(renderer);
    await expect(visual).resolves.toBe(scene);
    expect(load).toHaveBeenCalledOnce();
    expect(create.mock.calls.some(([tag]) => tag === "video")).toBe(false);
  } finally { finish(renderer); }
});

it("contains an early renderer failure while retaining the normal visual error path", async () => {
  const failure = new Error("Renderer could not load");
  const load = vi.fn(async () => { throw failure; });
  const { preparation, warn } = await setup(load);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  // Allow an unhandled warm rejection to surface before visual preparation.
  await new Promise(resolve => setTimeout(resolve, 0));
  await expect(preparation.prepareSpeech(scene.narration!)).resolves.toEqual({ seconds: 2 });
  const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
  const sharedFailure = await preloadBuiltinTemplate("cinemaMedia")!.catch((cause: unknown) => cause);
  expect(sharedFailure).toBeInstanceOf(Error);
  await expect(preparation.prepareVisual(scene)).rejects.toBe(sharedFailure);
  expect(load).toHaveBeenCalledOnce();
  expect(warn).not.toHaveBeenCalled();
});

it("does not warm a renderer for an already aborted turn", async () => {
  const controller = new AbortController();
  controller.abort();
  const load = vi.fn(async () => renderer);
  const { preparation } = await setup(load, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(load).not.toHaveBeenCalled();
  await expect(preparation.prepareSpeech(scene.narration!)).rejects.toMatchObject({ name: "AbortError" });
});
