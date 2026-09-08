import { createVideoChatHandler } from "@vanillaskyai/video/server";
import { findStockFootage } from "./stock";
import { providers } from "./providers";
import { textProvider } from "./providers/text";

/**
 * The application chooses providers and keeps their credentials here. The SDK
 * owns the video-chat protocol, prompts, capability negotiation, spend limits,
 * and HTTP responses.
 */
export const handleVideoChat = createVideoChatHandler({
  authorize: (request) => new URL(request.url).hostname === "localhost",
  ...textProvider,
  searchMedia: process.env.PEXELS_API_KEY
    ? (query, { orientation, signal, scene }) => findStockFootage(query, orientation, signal, scene?.variables.stockSelection)
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
  onError: () => console.error("[video-chat] planning failed"),
  onWarning: (warning) => console.warn(`[video-chat] ${warning.code}: ${warning.message}`),
});
