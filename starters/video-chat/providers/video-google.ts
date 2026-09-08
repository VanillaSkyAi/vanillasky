import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";
import { deliverVideo, downloadVideo, videoDeliveryConfigured, type DeliverVideo } from "./video-delivery";
import { jsonResponse, providerUrl, runVideoJob, videoPrompt } from "./video-job";

// https://ai.google.dev/gemini-api/docs/video — Veo 3.1: 4/6/8s at 720p.
const VIDEO_MODEL = process.env.GOOGLE_VIDEO_MODEL ?? "veo-3.1-fast-generate-preview";
const CLIP_DURATION_SEC = 6;
const RESOLUTION = "720p";
const CONCURRENCY = 2;
const TIMEOUT_MS = 360_000;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export function createGoogleVideo(apiKey: string, delivery: DeliverVideo): NonNullable<VideoChatHandlerOptions["generateVideo"]> {
  const headers = { "x-goog-api-key": apiKey, "content-type": "application/json" };
  return async (query, context) => {
    if (context.requestedDurationSec !== CLIP_DURATION_SEC) throw new Error("Clip duration does not match the app-owned model policy");
    const { value } = await runVideoJob({
      ...context, deadlineAt: Math.min(context.deadlineAt, Date.now() + TIMEOUT_MS), pollIntervalMs: 10_000,
      submit: async (signal) => {
        const result = await jsonResponse<{ name: string }>(await fetch(`${BASE}/models/${VIDEO_MODEL}:predictLongRunning`, {
          method: "POST", headers, signal,
          body: JSON.stringify({ instances: [{ prompt: videoPrompt(query, context) }], parameters: {
            durationSeconds: CLIP_DURATION_SEC, resolution: RESOLUTION, aspectRatio: context.orientation === "portrait" ? "9:16" : "16:9",
          } }),
        }));
        return { id: result.name };
      },
      poll: async (job, signal) => {
        if (!/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(job.id)) throw new Error("Unexpected video operation name");
        const status = await jsonResponse<{ done?: boolean; error?: unknown; response?: { generateVideoResponse?: { generatedSamples?: { video: { uri: string } }[] } } }>(await fetch(`${BASE}/${job.id}`, { headers, signal }));
        if (status.error) throw new Error("Video generation failed");
        if (!status.done) return null;
        const uri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video.uri;
        if (!uri) throw new Error("Video generation returned no output");
        // Download is private; keep it and storage delivery inside the deadline.
        const response = await downloadVideo(providerUrl(uri, "https://generativelanguage.googleapis.com"), signal, apiKey);
        return { url: await delivery({ response, jobId: job.id, durationSec: CLIP_DURATION_SEC, signal }), type: "video" as const, durationSec: CLIP_DURATION_SEC };
      },
      // No documented Gemini Veo cancellation. Abort stops polling, not billing.
    });
    return value;
  };
}

export const videoProvider = {
  generatedClipDurationSec: CLIP_DURATION_SEC, mediaConcurrency: CONCURRENCY, generateVideoTimeoutMs: TIMEOUT_MS,
  generateVideo: process.env.GEMINI_API_KEY && videoDeliveryConfigured ? createGoogleVideo(process.env.GEMINI_API_KEY, deliverVideo) : undefined,
} satisfies Pick<VideoChatHandlerOptions, "generateVideo" | "generatedClipDurationSec" | "mediaConcurrency" | "generateVideoTimeoutMs">;
