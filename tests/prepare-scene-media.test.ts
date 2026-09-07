// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareSceneMedia } from "../src/player/prepare-scene-media";
const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string; decode: () => Promise<void> }> = [];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); images.length = 0; });
function mockImages() {
  vi.stubGlobal("Image", class {
    onload = null; onerror = null; src = ""; complete = false; naturalWidth = 0;
    decode = vi.fn(async () => undefined);
    constructor() { images.push(this); }
  });
}
describe("scene media preparation", () => {
  it("acknowledges media-free scenes", async () => {
    expect(await prepareSceneMedia({}, new AbortController().signal)).toBe("graphic");
  });
  it("waits for the photo rather than treating its URL as ready", async () => {
    mockImages(); let ready = false;
    const task = prepareSceneMedia({mediaUrl: "https://example.com/photo.jpg", mediaType: "photo"}, new AbortController().signal).then(x => {ready = true; return x;});
    await Promise.resolve(); expect(ready).toBe(false);
    images[0].onload?.(); expect(await task).toBe("image");
  });
  it("does not hold video preparation behind an optional poster", async () => {
    mockImages();
    const create = vi.spyOn(document, "createElement");
    let ready = false;
    const task = prepareSceneMedia({mediaUrl: "https://example.com/movie.mp4", mediaType: "video", mediaPoster: "https://example.com/poster.jpg"}, new AbortController().signal)
      .then(value => { ready = true; return value; });
    // The poster never responds. Video preparation must still reach its owner.
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(true);
    expect(await task).toBe("awaiting-video-frame");
    expect(create).not.toHaveBeenCalledWith("video");
    expect(images).toHaveLength(0);
  });
  it("cancels a pending decode and releases handlers", async () => {
    mockImages(); const controller = new AbortController();
    const task = prepareSceneMedia({mediaUrl: "https://example.com/photo.jpg", mediaType: "photo"}, controller.signal);
    controller.abort(); await expect(task).rejects.toMatchObject({name: "AbortError"});
    expect(images[0].onload).toBeNull(); expect(images[0].src).toBe("");
  });
  it("bounds a hung load", async () => {
    vi.useFakeTimers(); mockImages();
    const task = prepareSceneMedia({mediaUrl: "https://example.com/photo.jpg", mediaType: "photo"}, new AbortController().signal);
    const expectation = expect(task).rejects.toMatchObject({name: "TimeoutError"});
    await vi.advanceTimersByTimeAsync(8000); await expectation;
  });
});
