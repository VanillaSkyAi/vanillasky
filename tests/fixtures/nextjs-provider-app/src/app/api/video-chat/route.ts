import { createVideoChatHandler } from "@vanillaskyai/video/server";
import { streamVideoPlan } from "./planner";

const handle = createVideoChatHandler({
  // This local-only bypass makes the fixture runnable in development.
  // Replace it with the application's session check before deploying.
  authorize: (request) => {
    if (process.env.VANILLASKY_LOCAL_DEMO !== "1") return false;
    const hostname = new URL(request.url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  },
  streamText: streamVideoPlan,
  welcome: { heroQuery: "", prompts: [{ prompt: "Explain ocean waves" }] },
  generateVideo: async () => ({ type: "video", url: "https://media.example/fixture.mp4" }),
  generateText: ({ task }) => task === "suggestions"
    ? JSON.stringify({ suggestions: [
        { prompt: "How can activation improve further?", keyword: "product onboarding" },
      ] })
    : "Guided onboarding raised activation from forty-one to fifty-eight percent.",
  onWarning: (warning) => console.warn(JSON.stringify({
    event: "video.warning",
    code: warning.code,
    category: warning.category,
    recoverable: warning.recoverable,
  })),
  onComplete: (summary) => console.info(JSON.stringify({
    event: "video.complete",
    finishReason: summary.finishReason,
    usage: summary.usage,
    requestedModelId: summary.requestedModelId,
    resolvedModelId: summary.resolvedModelId,
    totalDurationMs: summary.totalDurationMs,
    acceptedSceneCount: summary.acceptedSceneCount,
    rejectedSceneCount: summary.rejectedSceneCount,
    videoDurationSec: summary.videoDurationSec,
  })),
  onError: (error) => console.error(JSON.stringify({
    event: "video.error",
    name: error.name,
  })),
});

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
