import type { VideoScene } from "../protocol/types.js";

/** Keep the authored meaning when a built-in scene's optional media cannot decode. */
export function recoverSceneMedia(scene: VideoScene): VideoScene | undefined {
  if (scene.templateId === "cinemaMedia") {
    const title = scene.variables.fallbackText;
    if (typeof title !== "string" || !title.trim() || [...title].length > 65) return undefined;
    return { ...scene, templateId: "chapterTitle", variables: { title: title.trim() } };
  }
  if (!["comparison", "editorialTimeline", "quote", "keyFigure"].includes(scene.templateId)) return undefined;
  const variables = { ...scene.variables };
  for (const key of ["mediaUrl", "mediaPoster", "mediaType", "mediaKeyword", "mediaSource"]) delete variables[key];
  return { ...scene, variables };
}
