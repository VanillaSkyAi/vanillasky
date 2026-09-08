/**
 * How a scene's backdrop resolves from its variables. Pure, React-free, and
 * deliberately a leaf module: the player's media preloader shares it so the
 * question "is this scene backed by a photo, a video, or the brand gradient?"
 * has exactly one answer in the codebase.
 */

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v", ".avi"];

function isVideoUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    const lower = url.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }
}

export type ResolvedMediaType = "photo" | "video" | "gradient";

export function resolveMediaType(
  mediaType: string,
  mediaUrl: string,
): ResolvedMediaType {
  if (mediaType === "gradient") return "gradient";
  if (mediaType === "video") return "video";
  if (mediaType === "photo") return "photo";
  // "auto" — detect from URL extension
  return mediaUrl && isVideoUrl(mediaUrl) ? "video" : "photo";
}

/**
 * True when the scene actually renders a photo or video backdrop — i.e. a
 * mediaUrl is set and the template has not been pinned to the brand gradient.
 * Templates use it to switch their type onto the media legibility recipe.
 */
export function hasSceneMedia(variables: Record<string, unknown>): boolean {
  return (
    String(variables.mediaUrl || "").trim() !== "" &&
    String(variables.mediaType || "auto") !== "gradient"
  );
}
