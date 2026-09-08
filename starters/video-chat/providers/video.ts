import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";
import { deliverVideo, downloadVideo, videoDeliveryConfigured, type DeliverVideo } from "./video-delivery";
import { jsonResponse, providerUrl, runVideoJob, videoPrompt } from "./video-job";

// App-owned model policy: change these together after checking the model schema.
// https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api
const VIDEO_MODEL = process.env.FAL_VIDEO_MODEL ?? "minimax/h3-max-turbo/text-to-video";
const CLIP_DURATION_SEC = 5;
const RESOLUTION = "480P";
const CONCURRENCY = 3;
const TIMEOUT_MS = 120_000;

export function createFalVideo(apiKey: string, delivery: DeliverVideo): NonNullable<VideoChatHandlerOptions["generateVideo"]> {
  const headers = { Authorization: `Key ${apiKey}`, "content-type": "application/json" };
  return async (query, context) => {
    if (context.requestedDurationSec !== CLIP_DURATION_SEC) throw new Error("Clip duration does not match the app-owned model policy");
    let pending = true;
    const { value } = await runVideoJob({
      ...context, deadlineAt: Math.min(context.deadlineAt, Date.now() + TIMEOUT_MS), pollIntervalMs: 1000,
      submit: async (signal) => {
        const result = await jsonResponse<{ request_id: string; status_url: string; response_url: string; cancel_url: string }>(await fetch(`https://queue.fal.run/${VIDEO_MODEL}`, {
          method: "POST", headers, signal,
          body: JSON.stringify({ prompt: videoPrompt(query, context), duration: CLIP_DURATION_SEC, resolution: RESOLUTION,
            aspect_ratio: context.orientation === "portrait" ? "9:16" : "16:9", prompt_expansion_mode: "balanced" }),
        }));
        return { id: result.request_id, statusUrl: result.status_url, resultUrl: result.response_url, cancelUrl: result.cancel_url };
      },
      poll: async (job, signal) => {
        const status = await jsonResponse<{ status: string; error?: unknown }>(await fetch(providerUrl(job.statusUrl, "https://queue.fal.run"), { headers, signal }));
        if (status.error) throw new Error("Video generation failed");
        if (["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) return null;
        if (status.status !== "COMPLETED") throw new Error("Unexpected video job status");
        pending = false;
        const result = await jsonResponse<{ video: { url: string } }>(await fetch(providerUrl(job.resultUrl, "https://queue.fal.run"), { headers, signal }));
        const response = await downloadVideo(result.video.url, signal);
        return { url: await delivery({ response, jobId: job.id, durationSec: CLIP_DURATION_SEC, signal }), type: "video" as const, durationSec: CLIP_DURATION_SEC };
      },
      cancel: async (job, signal) => { if (pending) await fetch(providerUrl(job.cancelUrl, "https://queue.fal.run"), { method: "PUT", headers, signal }); },
    });
    return value;
  };
}

export const videoProvider = {
  generatedClipDurationSec: CLIP_DURATION_SEC, mediaConcurrency: CONCURRENCY, generateVideoTimeoutMs: TIMEOUT_MS,
  generateVideo: process.env.FAL_KEY && videoDeliveryConfigured ? createFalVideo(process.env.FAL_KEY, deliverVideo) : undefined,
} satisfies Pick<VideoChatHandlerOptions, "generateVideo" | "generatedClipDurationSec" | "mediaConcurrency" | "generateVideoTimeoutMs">;
