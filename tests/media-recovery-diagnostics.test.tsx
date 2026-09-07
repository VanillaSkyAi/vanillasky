// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { VideoFrame } from "../src/player/video-frame";
import { MountedReadinessContext } from "../src/player/mounted-scene-readiness";
import { BUILTIN_PLAYER_KIT, preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import type { Video } from "../src/protocol/types";
beforeAll(async () => { await preloadBuiltinTemplate("cinemaMedia"); await preloadBuiltinTemplate("chapterTitle"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it.each(["decode-error", "frame-readiness-timeout", "stalled-media"])("reports only a safe reason for actual %s recovery", async reason => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(reason === "frame-readiness-timeout" ? 0 : 2);
  vi.spyOn(HTMLMediaElement.prototype, "currentSrc", "get").mockImplementation(function (this: HTMLMediaElement) { return this.src; });
  const config: Video = {schemaVersion:"0.2",orientation:"portrait",style:{},scenes:[{id:"private-scene",templateId:"cinemaMedia",variables:{mediaUrl:"https://private.example/secret.mp4",mediaType:"video",fallbackText:"A useful chapter"},timing:{fixedDuration:12}}]};
  const view = render(<MountedReadinessContext.Provider value={vi.fn()}><VideoFrame kit={BUILTIN_PLAYER_KIT} config={config} time={1} width={360} height={640} playing /></MountedReadinessContext.Provider>);
  const details: unknown[] = [];
  view.container.addEventListener("vanillasky:media-recovery", event => details.push((event as CustomEvent).detail));
  const video = view.container.querySelector("video")!;
  if (reason === "decode-error") fireEvent.error(video);
  if (reason === "stalled-media") fireEvent.waiting(video);
  await act(() => vi.advanceTimersByTimeAsync(reason === "frame-readiness-timeout" ? 8100 : 1100));
  expect(view.container.textContent).toContain("A useful chapter");
  expect(details).toEqual([{reason}]);
  expect(JSON.stringify(details)).not.toContain("private");
});
