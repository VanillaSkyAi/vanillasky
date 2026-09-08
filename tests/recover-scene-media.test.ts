import { describe, expect, it } from "vitest";
import { recoverSceneMedia } from "../src/player/recover-scene-media";
import type { VideoScene } from "../src/protocol/types";

const scene: VideoScene = {
  id: "shot", templateId: "cinemaMedia", timing: { fixedDuration: 5 },
  narration: "The robot plants a seed and waits for the first green shoot.",
  variables: { mediaUrl: "https://media.example/broken.jpg", mediaType: "photo", fallbackText: "A seed of hope" },
};

describe("unusable photo recovery", () => {
  it("keeps the authored anchor, timing and entire narration without retaining a broken URL", () => {
    expect(recoverSceneMedia(scene)).toEqual({ ...scene, templateId: "chapterTitle", variables: { title: "A seed of hope" } });
    expect(scene.variables.mediaUrl).toBeTruthy();
  });
  it("uses a simple recovery chapter with the complete line when no anchor was supplied", () => {
    expect(recoverSceneMedia({ ...scene, variables: { mediaUrl: "broken.jpg" } })).toEqual({
      ...scene, templateId: "chapterTitle", variables: { title: "Your response continues." },
    });
    expect(recoverSceneMedia({ ...scene, templateId: "customerDiagram" })).toBeUndefined();
  });
});
