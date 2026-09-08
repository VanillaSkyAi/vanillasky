import type { VideoScene } from "../protocol/types.js";
import { sanitizeVideoChatMedia } from "../video-chat/media.js";

/** Validate the actual playback contract, without an extensible template schema. */
export function validateBuiltinScene(scene: Pick<VideoScene, "templateId" | "variables">): void {
  const variables = scene.variables;
  const boundedText = (value: unknown, maximum: number) =>
    typeof value === "string" && Boolean(value.trim()) && [...value].length <= maximum;
  if (scene.templateId === "chapterTitle") {
    if (!boundedText(variables.title, 65)) throw new Error("Chapter requires a title of 1–65 characters");
    if (Object.keys(variables).some(key => key !== "title")) throw new Error("Unsupported chapter variable");
    return;
  }
  if (scene.templateId !== "cinemaMedia") throw new Error("Unsupported scene kind");
  if (!sanitizeVideoChatMedia({
    url: variables.mediaUrl,
    type: variables.mediaType === "photo" ? "image" : variables.mediaType,
    ...(variables.mediaPoster ? { posterUrl: variables.mediaPoster } : {}),
  })) throw new Error("Media scene requires a safe media URL and type");
  if (variables.fallbackText !== undefined && !boundedText(variables.fallbackText, 65)) {
    throw new Error("Media recovery title must contain 1–65 characters");
  }
  const allowed = new Set(["mediaUrl", "mediaType", "mediaPoster", "fallbackText"]);
  if (Object.keys(variables).some(key => !allowed.has(key))) throw new Error("Unsupported media variable");
}
