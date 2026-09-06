import { readFile } from "node:fs/promises";
import { createVideoChatHandler } from "../../src/server/create-video-chat-handler";

export const scenarios = ["ready", "slow", "miss", "decode-error", "speech-error", "allowance", "throttled"] as const;
export const intents = ["explanation", "story", "comedy", "imagination", "practical", "golf"] as const;
export type FixtureOptions = { scenario: typeof scenarios[number]; intent: typeof intents[number] };
export function readFixtureOptions(url: URL): FixtureOptions {
  const scenario = scenarios.find(value => value === url.searchParams.get("scenario")) ?? "ready";
  const intent = intents.find(value => value === url.searchParams.get("intent")) ?? "explanation";
  return {scenario, intent};
}
const answers: Record<FixtureOptions["intent"], [string, string, string]> = {
  explanation: ["Wind gives ocean waves their energy.", "Wind transfers energy to the surface water.", "The wave carries that energy toward the shore."],
  story: ["A robot discovers one surviving seed.", "The robot plants its seed beside an empty house.", "Its neighbours arrive to share the new garden."],
  comedy: ["A duck applies for a desk job.", "The interviewer asks the duck for its bill.", "The duck submits an invoice for the interview."],
  imagination: ["Imagine a city built inside a teacup.", "Tiny ferries cross a lake of jasmine tea.", "At sunset, a sugar moon lights the harbour."],
  practical: ["Make room for one clear next step.", "Write down the task you can finish today.", "Set a short timer and begin that task."],
  golf: ["Let the club move through the ball.", "Set a balanced stance and turn through the swing.", "Finish balanced, facing where you want the ball to go."],
};

/** Fixture-only providers: no credentials, external fetches, or paid SDKs. */
export function createOfflineChatHandler(options: FixtureOptions, origin = "http://127.0.0.1:4281") {
  const [opening, first, ending] = answers[options.intent];
  const shot = (narration: string, title: string) => ({ narration, title, subject: "water flowing over rocks", action: "Water flows steadily over the rocks.", durationSec: 5, continuity: "cut" });
  const media = async (_query: string, context: { signal: AbortSignal }) => {
    if (options.scenario === "slow") await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2500);
      context.signal.addEventListener("abort", () => {clearTimeout(timer); reject(context.signal.reason);}, {once: true});
    });
    if (options.scenario === "miss") return null;
    return { type: "video" as const, url: `${origin}/tests/browser/fixtures/media-transition/${options.scenario === "decode-error" ? "does-not-exist.mp4" : "waterfall-short.mp4"}` };
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
    generateText: () => "[]",
    generateSpeech: async () => {
      if (options.scenario === "speech-error") throw new Error("Fixture speech failure");
      return {audio: await readFile(new URL("../../tests/browser/fixtures/media-transition/activation-cue.wav", import.meta.url)), mediaType: "audio/wav"};
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
