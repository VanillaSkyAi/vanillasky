/** Preflight never allocates a video decoder; the mounted player owns decoding. */
export type PreparedSceneVisual = "graphic" | "image" | "poster-bridge" | "awaiting-video-frame";

export async function prepareSceneMedia(
  variables: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PreparedSceneVisual> {
  signal.throwIfAborted();
  const url = typeof variables.mediaUrl === "string" ? variables.mediaUrl.trim() : "";
  if (!url || variables.mediaType === "gradient") return "graphic";
  const video = variables.mediaType === "video" || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
  const poster = typeof variables.mediaPoster === "string" ? variables.mediaPoster.trim() : "";
  if (video && !poster) return "awaiting-video-frame";
  let posterFailed = false;
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
    image.src = video ? poster : url;
    if (image.complete && image.naturalWidth > 0) image.onload(new Event("load"));
  }).catch((error: unknown) => {
    // A broken optional poster does not invalidate a video that can still decode.
    if (!video || signal.aborted) throw error;
    posterFailed = true;
  });
  return video ? posterFailed ? "awaiting-video-frame" : "poster-bridge" : "image";
}
