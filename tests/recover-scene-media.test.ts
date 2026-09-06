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
  it("preserves an overlay's evidence on black", () => {
    const graphic = { ...scene, templateId: "keyFigure", variables: { value: "2", label: "Completed steps", mediaUrl: "https://media.example/broken.jpg", mediaType: "photo" } };
    expect(recoverSceneMedia(graphic)).toEqual({ ...graphic, variables: { value: "2", label: "Completed steps" } });
  });
  it("does not invent fallback copy or change unknown customer templates", () => {
    expect(recoverSceneMedia({ ...scene, variables: { mediaUrl: "broken.jpg" } })).toEqual({
      ...scene, variables: { mediaType: "video", mediaUrl: "" },
    });
    expect(recoverSceneMedia({ ...scene, templateId: "customerDiagram" })).toBeUndefined();
  });
});
