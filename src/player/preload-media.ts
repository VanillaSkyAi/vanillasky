/**
 * Warms a scene's backdrop before the scene is on screen.
 *
 * SceneBackground holds its scrim back until the backdrop actually paints, so
 * a cold backdrop degrades to a clean brand gradient rather than a muddy one.
 * That is the safety net. This is what keeps the net from being needed: by the
 * time the scene mounts the bytes are in the browser cache, and the first
 * frame is already the picture instead of a gradient that flashes and pops.
 */
import {
  limitsConcurrentVideoDecoders,
  resolveMediaType,
} from "../visual-system/scene-templates/media-source.js";

/** URLs already warmed this session. Preloading twice costs a request. */
const warmed = new Set<string>();

/**
 * In-flight warms, held so the browser cannot collect them mid-request.
 * A detached Image or HTMLVideoElement with no reference is eligible for
 * garbage collection, and browsers are free to cancel its load when that
 * happens — which is how a preloader ends up doing nothing at all.
 */
const inFlight = new Set<HTMLImageElement | HTMLVideoElement>();

function warmImage(url: string): void {
  const trimmed = url.trim();
  if (!trimmed || warmed.has(trimmed)) return;
  warmed.add(trimmed);
  const image = new Image();
  const release = () => inFlight.delete(image);
  image.onload = release;
  image.onerror = release;
  inFlight.add(image);
  image.src = trimmed;
}

/**
 * Only one video is fetched at a time, and its element is torn down the moment
 * the first frame is available. Releasing the warmer bounds its memory use
 * rather than keeping a decoder alive for every future scene.
 */
let videoWarmInFlight = false;

function warmVideo(url: string): void {
  const trimmed = url.trim();
  if (!trimmed || warmed.has(trimmed) || videoWarmInFlight) return;
  warmed.add(trimmed);
  videoWarmInFlight = true;
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const release = () => {
    videoWarmInFlight = false;
    inFlight.delete(video);
    video.removeAttribute("src");
    video.load();
  };
  video.onloadeddata = release;
  video.onerror = release;
  inFlight.add(video);
  video.src = trimmed;
}

/**
 * Preload whatever paints this scene's backdrop. Safe to call for every scene,
 * repeatedly, and on any template: scenes without media do nothing.
 */
export function preloadSceneMedia(variables: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof Image === "undefined") return;

  const mediaUrl = String(variables.mediaUrl || "").trim();
  if (!mediaUrl) return;

  const resolved = resolveMediaType(String(variables.mediaType || "auto"), mediaUrl);
  if (resolved === "gradient") return;

  if (resolved === "video") {
    // The poster is what paints the first frame, so it comes first and is
    // never blocked behind the stream warm.
    warmImage(String(variables.mediaPoster || ""));
    // Mobile preparation owns the active and immediate-next mounted videos.
    // A detached warmer would add another resource outside that bound and
    // cannot supply the prepared element that must survive the cut.
    if (limitsConcurrentVideoDecoders()) return;
    warmVideo(mediaUrl);
    return;
  }
  warmImage(mediaUrl);
}
