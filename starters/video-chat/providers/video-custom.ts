import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";
import type { DeliverVideo } from "./video-delivery";
import { runVideoJob } from "./video-job";

// Your model, duration, resolution and account throughput live in application code.
const CLIP_DURATION_SEC = 5;
const CONCURRENCY = 2;
const TIMEOUT_MS = 120_000;
type Context = Parameters<NonNullable<VideoChatHandlerOptions["generateVideo"]>>[1];

/** Any vendor SDK or native API can implement these callbacks. Submission is
 * called ONCE; null means still pending. Supply your model/resolution in submit,
 * persist its ID with onSubmitted, and deliver a browser-safe copy of the bytes.
 */
export function createCustomVideo<Job extends { id: string }>(adapter: {
  submit: (query: string, context: Context) => Promise<Job>;
  poll: (job: Job, signal: AbortSignal) => Promise<Response | null>;
  cancel?: (job: Job, signal: AbortSignal) => Promise<void>;
  onSubmitted?: (job: Job) => void | Promise<void>;
  deliver: DeliverVideo;
}): NonNullable<VideoChatHandlerOptions["generateVideo"]> {
  return async (query, context) => {
    if (context.requestedDurationSec !== CLIP_DURATION_SEC) throw new Error("Clip duration does not match the app-owned model policy");
    let pending = true;
    const { value } = await runVideoJob({
      ...adapter, ...context, deadlineAt: Math.min(context.deadlineAt, Date.now() + TIMEOUT_MS), pollIntervalMs: 5000,
      submit: (signal) => adapter.submit(query, { ...context, signal }),
      poll: async (job, signal) => {
        const response = await adapter.poll(job, signal);
        if (!response) return null;
        pending = false;
        return { url: await adapter.deliver({ response, jobId: job.id, durationSec: context.requestedDurationSec, signal }),
          type: "video" as const, durationSec: context.requestedDurationSec };
      },
      cancel: async (job, signal) => { if (pending) await adapter.cancel?.(job, signal); },
    });
    return value;
  };
}

export const videoProvider = {
  generatedClipDurationSec: CLIP_DURATION_SEC, mediaConcurrency: CONCURRENCY, generateVideoTimeoutMs: TIMEOUT_MS,
  // Wire createCustomVideo(...) here. No vendor or storage is imposed by the SDK.
  generateVideo: undefined,
} satisfies Pick<VideoChatHandlerOptions, "generateVideo" | "generatedClipDurationSec" | "mediaConcurrency" | "generateVideoTimeoutMs">;
