import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import { createVideoChatHandler } from "@vanillaskyai/video/server";
import { findStockFootage } from "./stock";
import { providers } from "./providers";

const PLANNER_MODEL = process.env.ANTHROPIC_PLANNER_MODEL ?? "claude-sonnet-5";
const NARRATION_MODEL = process.env.ANTHROPIC_NARRATION_MODEL ?? "claude-haiku-4-5";
/**
 * The application chooses providers and keeps their credentials here. The SDK
 * owns the video-chat protocol, prompts, capability negotiation, spend limits,
 * and HTTP responses.
 */
export const handleVideoChat = createVideoChatHandler({
  authorize: (request) => new URL(request.url).hostname === "localhost",
  streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
    model: anthropic(PLANNER_MODEL),
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: signal,
    maxOutputTokens: 8_192,
    providerOptions: {
      anthropic: {
        thinking: { type: "disabled" },
        output_config: { effort: "medium" },
      },
    },
  }),
  generateText: async ({ systemPrompt, userPrompt, maxOutputTokens, signal }) => {
    const { text } = await generateText({
      model: anthropic(NARRATION_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens,
      abortSignal: signal,
    });
    return text;
  },
  searchMedia: process.env.PEXELS_API_KEY
    ? (query, { orientation, signal }) => findStockFootage(query, orientation, signal)
    : undefined,
  ...providers,
  welcome: {
    // Omit the query to use the SDK's curated cloud welcome.
    ...(process.env.VIDEO_CHAT_WELCOME_KEYWORD ? { heroQuery: process.env.VIDEO_CHAT_WELCOME_KEYWORD } : {}),
    prompts: [
      {
        prompt: "Why does the Moon always show one face?",
        opening: "The Moon turns, perfectly matching its orbit.",
        mediaQuery: "full moon night sky",
      },
      {
        prompt: "Tell me a tiny story about a robot growing a garden on Mars",
        opening: "One patient robot is about to make Mars bloom.",
        mediaQuery: "robot garden mars",
      },
      {
        prompt: "Recommend a perfect rainy afternoon in Amsterdam",
        opening: "Rain makes Amsterdam's best afternoons feel even warmer.",
        mediaQuery: "Amsterdam rain cafe",
      },
      {
        prompt: "Pitch a playful ad for a coffee mug that never spills",
        opening: "This mug makes gravity look completely optional.",
        mediaQuery: "coffee mug desk",
      },
    ],
  },
  onError: (error) => console.error("[video-chat] planning failed:", error.message),
  onWarning: (warning) => console.warn(`[video-chat] ${warning.code}: ${warning.message}`),
  mediaConcurrency: 5,
});
