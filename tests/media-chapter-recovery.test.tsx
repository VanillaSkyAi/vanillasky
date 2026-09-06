// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { VideoFrame } from "../src/player/video-frame";
import { BUILTIN_PLAYER_KIT, preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import type { Video } from "../src/protocol/types";
import { recoverSceneMedia } from "../src/player/recover-scene-media";
beforeAll(async () => { await preloadBuiltinTemplate("cinemaMedia"); await preloadBuiltinTemplate("chapterTitle"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const scene = { id: "wave", templateId: "cinemaMedia", variables: { mediaUrl: "/wave.mp4", mediaType: "video", fallbackText: "Wind transfers energy" }, narration: "Wind transfers energy to the water.", timing: { fixedDuration: 12 } };
function frame(url = "/wave.mp4") {
  const config: Video = {schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: [{...scene, variables: {...scene.variables, mediaUrl: url}}]};
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  return render(<VideoFrame kit={BUILTIN_PLAYER_KIT} config={config} width={360} height={640} time={3} playing />);
}
it("uses the authored chapter immediately when a persisted shot has no URL", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const view = frame("");
  await waitFor(() => expect(view.container.querySelector('[data-template="title"]')?.textContent).toBe("Wind transfers energy"));
  expect(view.queryByText("Visual unavailable")).toBeNull();
});
it("recovers a rejected native play request to the authored chapter", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("Decoder unavailable"));
  const view = frame();
  await waitFor(() => expect(view.container.querySelector('[data-template="title"]')?.textContent).toBe("Wind transfers energy"));
  expect(view.queryByText("Visual unavailable")).toBeNull();
});
it("recovers a native decode error without changing the narration or scene duration", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const view = frame();
  fireEvent.error(view.container.querySelector("video")!);
  await waitFor(() => expect(view.container.querySelector('[data-template="title"]')?.textContent).toBe("Wind transfers energy"));
  expect(recoverSceneMedia(scene)).toMatchObject({ id: scene.id, narration: scene.narration, timing: scene.timing, templateId: "chapterTitle", variables: {title: "Wind transfers energy"} });
});
