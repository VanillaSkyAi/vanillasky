/** Preflight never allocates a video decoder; the mounted player owns decoding. */
export type PreparedSceneVisual = "graphic" | "image" | "awaiting-video-frame";

export async function prepareSceneMedia(
  variables: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PreparedSceneVisual> {
  signal.throwIfAborted();
  const url = typeof variables.mediaUrl === "string" ? variables.mediaUrl.trim() : "";
  if (!url || variables.mediaType === "gradient") return "graphic";
  const video = variables.mediaType === "video" || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
  // An optional poster cannot delay the real video. The existing media warmer
  // can fetch it independently; mounted playback still requires an actual frame.
  if (video) return "awaiting-video-frame";
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) { image.src = ""; reject(error); } else resolve();
    };
    const abort = () => finish(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new DOMException("Media preparation timed out", "TimeoutError")), 8_000);
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      void (image.decode ? image.decode() : Promise.resolve()).then(() => finish(), () => finish(new Error("Could not prepare scene image")));
    };
    image.onerror = () => finish(new Error("Could not prepare scene image"));
    image.src = url;
    if (image.complete && image.naturalWidth > 0) image.onload(new Event("load"));
  });
  return "image";
}
