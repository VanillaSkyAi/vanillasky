import type { VideoScene } from "../protocol/types.js";

/** Keep the authored meaning when a built-in scene's optional media cannot decode. */
export function recoverSceneMedia(scene: VideoScene): VideoScene | undefined {
  if (scene.templateId === "cinemaMedia") {
    const title = scene.variables.fallbackText;
    const fallback = typeof title === "string" && title.trim() && [...title].length <= 65 ? title.trim() : "Your response continues.";
    return { ...scene, templateId: "chapterTitle", variables: { title: fallback } };
  }
  return undefined;
}
