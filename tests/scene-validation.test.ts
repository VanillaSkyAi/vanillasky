import { describe, expect, it } from "vitest";
import { validateBuiltinScene } from "../src/server/scene-validation";

describe("the two supported scene kinds", () => {
  it("accepts chapter recovery and application-resolved footage", () => {
    expect(() => validateBuiltinScene({ templateId: "chapterTitle", variables: { title: "A grounded answer" } })).not.toThrow();
    expect(() => validateBuiltinScene({ templateId: "cinemaMedia", variables: { mediaUrl: "https://app.test/clip.mp4", mediaType: "video", fallbackText: "An answer" } })).not.toThrow();
  });
  it("rejects retired scene kinds and unsafe media", () => {
    expect(() => validateBuiltinScene({ templateId: "comparison", variables: {} })).toThrow();
    expect(() => validateBuiltinScene({ templateId: "cinemaMedia", variables: { mediaUrl: "javascript:alert(1)", mediaType: "video" } })).toThrow();
    expect(() => validateBuiltinScene({ templateId: "chapterTitle", variables: { title: "" } })).toThrow();
  });
});
