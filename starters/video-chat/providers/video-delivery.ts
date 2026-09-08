/** Replace this callback with your own storage integration. It receives server
 * bytes; provider credentials and private URLs never reach a browser. Serve
 * H.264 MP4 with Content-Type, Content-Length, byte ranges, CORS and replay-safe
 * retention. Put the MP4 moov atom first for progressive playback.
 */
export type DeliverVideo = (input: {
  response: Response; jobId: string; durationSec: number; signal: AbortSignal;
}) => Promise<string>;

function configured(): boolean {
  try {
    const url = new URL(process.env.VIDEO_UPLOAD_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password && Boolean(process.env.VIDEO_STORAGE_TOKEN);
  }
  catch { return false; }
}
export const videoDeliveryConfigured = configured();

/** YOUR endpoint contract, not an SDK service: PUT MP4 bytes, return { url }.
 * Or replace this whole callback with your S3/R2/local storage code.
 */
export const deliverVideo: DeliverVideo = async ({ response, jobId, signal }) => {
  if (!videoDeliveryConfigured) throw new Error("Configure app-owned video delivery before generation");
  if (!response.ok || !response.body) throw new Error("Provider video download failed");
  const upload = new URL(process.env.VIDEO_UPLOAD_URL!);
  if (upload.protocol !== "https:") throw new Error("Video upload endpoint must use HTTPS");
  upload.searchParams.set("jobId", jobId);
  const result = await fetch(upload, {
    method: "PUT", signal,
    headers: { authorization: `Bearer ${process.env.VIDEO_STORAGE_TOKEN}`, "content-type": "video/mp4" },
    body: response.body, duplex: "half",
  } as RequestInit);
  if (!result.ok) throw new Error("App-owned video upload failed");
  const { url } = await result.json() as { url: string };
  const publicUrl = new URL(url);
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) throw new Error("Delivery must return a browser-safe HTTPS URL");
  return publicUrl.href;
};

/** Follow provider/CDN redirects without forwarding Google's key off its origin. */
export async function downloadVideo(url: string, signal: AbortSignal, googleKey?: string): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("Unexpected video download URL");
    const response = await fetch(target.href, { signal, redirect: "manual",
      headers: googleKey && target.origin === "https://generativelanguage.googleapis.com" ? { "x-goog-api-key": googleKey } : undefined });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw new Error("Provider video download failed");
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Video download redirect has no location");
    url = new URL(location, target).href;
  }
  throw new Error("Too many video download redirects");
}
