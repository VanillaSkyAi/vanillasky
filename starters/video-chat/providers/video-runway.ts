import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";
import { deliverVideo, downloadVideo, videoDeliveryConfigured, type DeliverVideo } from "./video-delivery";
import { jsonResponse, runVideoJob, videoPrompt } from "./video-job";

// https://docs.dev.runwayml.com/api/ — Gen-4.5: integer durations 2–10s.
const VIDEO_MODEL = process.env.RUNWAY_VIDEO_MODEL ?? "gen4.5";
const CLIP_DURATION_SEC = 5;
const RESOLUTION = { portrait: "720:1280", landscape: "1280:720" };
const CONCURRENCY = 2;
const TIMEOUT_MS = 180_000;
const BASE = "https://api.dev.runwayml.com/v1";

export function createRunwayVideo(apiKey: string, delivery: DeliverVideo): NonNullable<VideoChatHandlerOptions["generateVideo"]> {
  const headers = { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" };
  return async (query, context) => {
    if (context.requestedDurationSec !== CLIP_DURATION_SEC) throw new Error("Clip duration does not match the app-owned model policy");
    const promptText = videoPrompt(query, context);
    if (promptText.length > 1000) throw new Error("Runway video prompt exceeds 1000 characters");
    let pending = true;
    const { value } = await runVideoJob({
      ...context, deadlineAt: Math.min(context.deadlineAt, Date.now() + TIMEOUT_MS), pollIntervalMs: 5000,
      submit: async (signal) => jsonResponse<{ id: string }>(await fetch(`${BASE}/text_to_video`, {
        method: "POST", headers, signal,
        body: JSON.stringify({ model: VIDEO_MODEL, promptText, duration: CLIP_DURATION_SEC, ratio: RESOLUTION[context.orientation] }),
      })),
      poll: async (job, signal) => {
        const status = await jsonResponse<{ status: string; output?: string[] }>(await fetch(`${BASE}/tasks/${encodeURIComponent(job.id)}`, { headers, signal }));
        if (["PENDING", "THROTTLED", "RUNNING"].includes(status.status)) return null;
        // DELETE removes terminal tasks too; preserve their status and cost.
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(status.status)) pending = false;
        if (status.status !== "SUCCEEDED" || !status.output?.[0]) throw new Error("Video generation failed");
        const response = await downloadVideo(status.output[0], signal);
        return { url: await delivery({ response, jobId: job.id, durationSec: CLIP_DURATION_SEC, signal }), type: "video" as const, durationSec: CLIP_DURATION_SEC };
      },
      // DELETE cancels pending/running jobs; completion racing it may delete the task.
      cancel: async (job, signal) => { if (pending) await fetch(`${BASE}/tasks/${encodeURIComponent(job.id)}`, { method: "DELETE", headers, signal }); },
    });
    return value;
  };
}

export const videoProvider = {
  generatedClipDurationSec: CLIP_DURATION_SEC, mediaConcurrency: CONCURRENCY, generateVideoTimeoutMs: TIMEOUT_MS,
  generateVideo: process.env.RUNWAY_API_KEY && videoDeliveryConfigured ? createRunwayVideo(process.env.RUNWAY_API_KEY, deliverVideo) : undefined,
} satisfies Pick<VideoChatHandlerOptions, "generateVideo" | "generatedClipDurationSec" | "mediaConcurrency" | "generateVideoTimeoutMs">;
