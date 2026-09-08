import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";

// Optional Vercel AI SDK integration. Replace just this file to change text vendors.
const PLANNER_MODEL = process.env.ANTHROPIC_PLANNER_MODEL ?? "claude-sonnet-5";
const NARRATION_MODEL = process.env.ANTHROPIC_NARRATION_MODEL ?? "claude-haiku-4-5";
export const textProvider: Pick<VideoChatHandlerOptions, "streamText" | "generateText"> = {
  streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
    model: anthropic(PLANNER_MODEL), system: systemPrompt, prompt: userPrompt,
    abortSignal: signal, maxOutputTokens: 8192,
    providerOptions: { anthropic: { thinking: { type: "disabled" }, output_config: { effort: "medium" } } },
  }),
  generateText: async ({ systemPrompt, userPrompt, maxOutputTokens, signal }) => {
    const { text } = await generateText({ model: anthropic(NARRATION_MODEL), system: systemPrompt,
      prompt: userPrompt, maxOutputTokens, abortSignal: signal });
    return text;
  },
};
