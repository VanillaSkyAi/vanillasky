import { fal } from "@fal-ai/client";
import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";

// Change only to a duration supported by the selected model and your allowance.
const CLIP_DURATION_SEC = 5;
const VIDEO_MODEL = process.env.FAL_VIDEO_MODEL ?? "minimax/h3-max-turbo/text-to-video";

async function filmScene(
  subject: string,
  generatedLook: string | undefined,
  orientation: "portrait" | "landscape",
  signal: AbortSignal,
  shotDirection?: string,
) {
  fal.config({ credentials: process.env.FAL_KEY });
  const started = Date.now();
  try {
    const result = await fal.subscribe(VIDEO_MODEL, {
      input: {
        prompt: [
          `One continuous moving shot, ${orientation === "portrait" ? "9:16 vertical" : "16:9"}. ${subject}.`,
          "Depict the requested action clearly throughout the clip. Follow its stated visual style and world rules.",
          shotDirection,
          "No on-screen text, captions, subtitles, watermarks or logos.",
          "Natural scene sound only when appropriate. No speech, dialogue, singing, music or voiceover; narration is added separately.",
          generatedLook,
        ].filter(Boolean).join("\n\n"),
        duration: CLIP_DURATION_SEC,
        resolution: "480P",
        aspect_ratio: orientation === "portrait" ? "9:16" : "16:9",
        prompt_expansion_mode: "balanced",
      },
      abortSignal: signal,
    });
    const url = result?.data?.video?.url;
    if (typeof url !== "string") throw new Error("the video provider returned no url");
    console.log(`[video-chat] filmed in ${Date.now() - started}ms`);
    return url;
  } catch (cause) {
    const status = (cause as { status?: unknown })?.status;
    console.error(
      `[video-chat] filming failed after ${Date.now() - started}ms${typeof status === "number" ? ` (status ${status})` : ""}`,
    );
    throw cause;
  }
}

/** Optional generated video and transcription; credentials remain server-only. */
export const videoProvider: Pick<VideoChatHandlerOptions, "generateVideo" | "transcribe" | "generatedClipDurationSec"> = {
  generatedClipDurationSec: CLIP_DURATION_SEC,
  generateVideo: process.env.FAL_KEY
    ? async (query, { generatedLook, orientation, signal, scene }) => ({
        url: await filmScene(query, generatedLook, orientation, signal, typeof scene?.variables.shotDirection === "string" ? scene.variables.shotDirection : undefined),
        type: "video" as const,
      })
    : undefined,
  transcribe: process.env.FAL_KEY
    ? async ({ audio, mediaType, signal }) => {
        signal.throwIfAborted();
        fal.config({ credentials: process.env.FAL_KEY });
        const bytes = Uint8Array.from(audio);
        const url = await fal.storage.upload(new Blob([bytes.buffer], { type: mediaType }));
        signal.throwIfAborted();
        const result = await fal.subscribe(process.env.FAL_TRANSCRIBE_MODEL ?? "fal-ai/whisper", {
          input: { audio_url: url, task: "transcribe" },
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        });
        return String((result?.data as { text?: unknown })?.text ?? "");
      }
    : undefined,
};
