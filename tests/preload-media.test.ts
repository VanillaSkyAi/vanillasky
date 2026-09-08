// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("bounded media byte preparation", () => {
  it("fetches media once without allocating a detached video decoder", async () => {
    const fetcher = vi.fn(async () => new Response("clip"));
    vi.stubGlobal("fetch", fetcher);
    const create = vi.spyOn(document, "createElement");
    const { preloadSceneMedia } = await import("../src/player/preload-media");
    await Promise.all([
      preloadSceneMedia({ mediaUrl: "https://media.test/clip.mp4", mediaType: "video" }),
      preloadSceneMedia({ mediaUrl: "https://media.test/clip.mp4", mediaType: "video" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(create.mock.calls.some(([tag]) => tag === "video")).toBe(false);
  });

  it("queues a later completed clip while the earlier byte fetch is pending", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response("clip"));
    vi.stubGlobal("fetch", fetcher);
    const { preloadSceneMedia } = await import("../src/player/preload-media");
    const first = preloadSceneMedia({ mediaUrl: "https://media.test/first.mp4", mediaType: "video" });
    const second = preloadSceneMedia({ mediaUrl: "https://media.test/second.mp4", mediaType: "video" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(new Response("first"));
    await Promise.all([first, second]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://media.test/first.mp4", "https://media.test/second.mp4"]);
  });

  it("drops cancelled queued work without blocking following clips", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response("clip"));
    vi.stubGlobal("fetch", fetcher);
    const { preloadSceneMedia } = await import("../src/player/preload-media");
    const first = preloadSceneMedia({ mediaUrl: "https://media.test/first.mp4" });
    const controller = new AbortController();
    const cancelled = preloadSceneMedia({ mediaUrl: "https://media.test/cancelled.mp4" }, controller.signal);
    const next = preloadSceneMedia({ mediaUrl: "https://media.test/next.mp4" });
    controller.abort();
    finish(new Response("first"));
    await Promise.all([first, cancelled, next]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://media.test/first.mp4", "https://media.test/next.mp4"]);
  });

  it("warms the poster and photo bytes and ignores empty or graphic media", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response("image"));
    vi.stubGlobal("fetch", fetcher);
    const { preloadSceneMedia } = await import("../src/player/preload-media");
    await preloadSceneMedia({ mediaUrl: "https://media.test/clip.mp4", mediaPoster: "https://media.test/poster.jpg" });
    await preloadSceneMedia({ mediaUrl: "https://media.test/photo.jpg", mediaType: "photo" });
    await preloadSceneMedia({});
    await preloadSceneMedia({ mediaUrl: "https://media.test/unused.jpg", mediaType: "gradient" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://media.test/poster.jpg", "https://media.test/clip.mp4", "https://media.test/photo.jpg"]);
  });
});
