import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";
import { jsonResponse, providerUrl, runVideoJob } from "./video-job";

// Separate capability: using fal Whisper does not select fal for video.
// https://fal.ai/models/fal-ai/whisper/api — accepts a base64 data URI.
export const transcriptionProvider: Pick<VideoChatHandlerOptions, "transcribe"> = {
  transcribe: process.env.FAL_KEY ? async ({ audio, mediaType, signal }) => {
    signal.throwIfAborted();
    const headers = { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" };
    const { value } = await runVideoJob({
      signal, deadlineAt: Date.now() + 60_000, pollIntervalMs: 1000,
      submit: async (signal) => {
        const result = await jsonResponse<{ request_id: string; status_url: string; response_url: string; cancel_url: string }>(await fetch("https://queue.fal.run/fal-ai/whisper", {
          method: "POST", headers, signal,
          body: JSON.stringify({ audio_url: `data:${mediaType};base64,${Buffer.from(audio).toString("base64")}`, task: "transcribe" }),
        }));
        return { id: result.request_id, statusUrl: providerUrl(result.status_url, "https://queue.fal.run"),
          resultUrl: providerUrl(result.response_url, "https://queue.fal.run"), cancelUrl: providerUrl(result.cancel_url, "https://queue.fal.run") };
      },
      poll: async (job, signal) => {
        const status = await jsonResponse<{ status: string; error?: unknown }>(await fetch(job.statusUrl, { headers, signal }));
        if (status.error) throw new Error("Transcription failed");
        if (["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) return null;
        if (status.status !== "COMPLETED") throw new Error("Unexpected transcription status");
        const result = await jsonResponse<{ text: string }>(await fetch(job.resultUrl, { headers, signal }));
        return result.text;
      },
      cancel: async (job, signal) => { await fetch(job.cancelUrl, { method: "PUT", headers, signal }); },
    });
    return value;
  } : undefined,
};
