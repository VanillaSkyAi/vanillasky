import { resolveMediaType } from "../visual-system/scene-templates/media-source.js";
import { withDeadline } from "../video-chat/deadline.js";

const MAX_QUEUED_URLS = 64;
const MAX_REMEMBERED_URLS = 64;
const MAX_WARM_BYTES = 32 * 1024 * 1024;
const warmed = new Set<string>();
const pending = new Map<string, Promise<void>>();
const queue: Array<{ url: string; signal?: AbortSignal; done: () => void }> = [];
let running = false;

/** Fetch bytes into the browser cache without allocating a media decoder or retaining blobs. */
function pump(): void {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  if (job.signal?.aborted) {
    pending.delete(job.url);
    job.done();
    pump();
    return;
  }
  running = true;
  void withDeadline(async signal => {
    const response = await fetch(job.url, { signal, cache: "force-cache" });
    if (!response.ok) throw new Error("Media warm failed");
    const reader = response.body?.getReader();
    if (reader) {
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_WARM_BYTES) throw new Error("Media warm exceeded its byte allowance");
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    }
    warmed.add(job.url);
    while (warmed.size > MAX_REMEMBERED_URLS) warmed.delete(warmed.values().next().value!);
  }, 8_000, job.signal).catch(() => undefined).finally(() => {
    running = false;
    pending.delete(job.url);
    job.done();
    pump();
  });
}

function warm(url: string, signal?: AbortSignal): Promise<void> {
  if (!url || signal?.aborted || warmed.has(url)) return Promise.resolve();
  const existing = pending.get(url);
  if (existing) return existing;
  if (queue.length >= MAX_QUEUED_URLS) return Promise.resolve();
  let done!: () => void;
  const result = new Promise<void>(resolve => { done = resolve; });
  pending.set(url, result);
  queue.push({ url, signal, done });
  pump();
  return result;
}

/** Preparation is best effort; only mounted media can prove playback readiness. */
export async function preloadSceneMedia(variables: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  const url = typeof variables.mediaUrl === "string" ? variables.mediaUrl.trim() : "";
  if (!url || resolveMediaType(String(variables.mediaType || "auto"), url) === "gradient") return;
  const poster = typeof variables.mediaPoster === "string" ? variables.mediaPoster.trim() : "";
  await Promise.all([warm(poster, signal), warm(url, signal)]);
}
