import { readFile } from "node:fs/promises";
import speechManifest from "./speech/manifest.json";
import { createVideoChatHandler } from "../../src/server/create-video-chat-handler";

export const scenarios = ["ready", "slow", "miss", "decode-error", "speech-error", "allowance", "throttled"] as const;
export const intents = ["explanation", "story", "comedy", "imagination", "practical", "golf"] as const;
export type FixtureOptions = { scenario: typeof scenarios[number]; intent: typeof intents[number] };
export function readFixtureOptions(url: URL): FixtureOptions {
  const scenario = scenarios.find(value => value === url.searchParams.get("scenario")) ?? "ready";
  const intent = intents.find(value => value === url.searchParams.get("intent")) ?? "explanation";
  return {scenario, intent};
}


/** Fixture-only providers: no credentials, external fetches, or paid SDKs. */
export function createOfflineChatHandler(options: FixtureOptions, origin = "http://127.0.0.1:4281") {
  const [opening, first, ending] = speechManifest.utterances.filter(line => line.intent === options.intent).map(line => line.text);
  const shot = (narration: string, title: string) => ({ narration, title, subject: "water flowing over rocks", action: "Water flows steadily over the rocks.", durationSec: 5, continuity: "cut" });
  const media = async (_query: string, context: { signal: AbortSignal }) => {
    if (options.scenario === "slow") await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2500);
      context.signal.addEventListener("abort", () => {clearTimeout(timer); reject(context.signal.reason);}, {once: true});
    });
    if (options.scenario === "miss") return null;
    return { type: "video" as const, url: `${origin}/tests/browser/fixtures/media-transition/${options.scenario === "decode-error" ? "does-not-exist.mp4" : "waterfall.mp4"}`, durationSec: 5 };
  };
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    ...{onDiagnostic: (event: {phase: string; elapsedMs: number; durationMs?: number; reason?: string}) => {
      // Host-only provider phases; never log request IDs, copy, queries or errors.
      console.info("[chat fixture]", JSON.stringify({phase: event.phase, elapsedMs: event.elapsedMs,
        ...(event.durationMs !== undefined ? {durationMs: event.durationMs} : {}), ...(event.reason ? {reason: event.reason} : {})}));
    }},
    maxGeneratedVideos: options.scenario === "allowance" ? 0 : 5,
    generateVideo: media, searchMedia: media,
    welcome: {heroQuery: "local flowing water", prompts: [{prompt: "Try the selected fixture"}]},
    generateText: ({task}) => task === "suggestions" ? JSON.stringify({suggestions: [
      "Explain that in another way",
      "Show me a practical example",
      "What happens in the next scene",
      "Explore the idea in more detail",
    ].map(prompt => ({prompt, keyword: "local flowing water"}))}) : task === "narration-rewrite" ? "" : "[]",
    generateSpeech: async ({text, signal}) => {
      if (options.scenario === "speech-error") throw new Error("Fixture speech failure");
      signal.throwIfAborted();
      const line = speechManifest.utterances.find(line => line.text === text.trim());
      if (!line) throw new Error("No spoken fixture matches this narration");
      const audio = await readFile(new URL(`./speech/${line.file}`, import.meta.url));
      signal.throwIfAborted();
      return {audio, mediaType: "audio/mpeg"};
    },
    streamText: async function* () {
      yield JSON.stringify({type: "answer", intent: options.intent, opening, subject: "fixture answer", development: first, visualDirection: "Offline fixture footage, not a live creative result.", ending: shot(ending, "The answer lands")}) + "\n";
      yield JSON.stringify({type: "shot", ...shot(first, "The first useful step")}) + "\n";
    },
  });
  return (request: Request) => options.scenario === "throttled" && new URL(request.url).searchParams.get("action") === "response"
    ? Promise.resolve(Response.json({error: {code: "rate_limited", message: "Fixture request throttle", recoverable: true}}, {status: 429}))
    : handler(request);
}
