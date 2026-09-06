import { createVideoChatHandler } from "../../src/server";
import { decodeVideoSse } from "../../src/protocol/sse";
import { ACCEPTANCE_FIXTURES, replayParts } from "./fixtures";
import { evaluateChatAcceptance, type TimedVideoEvent } from "./evaluate";

/** Runs only in-memory provider doubles: no credentials or network provider calls. */
export async function runChatAcceptance() {
  const results = [];
  for (const fixture of ACCEPTANCE_FIXTURES) {
    let plannerInput = "";
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false,
      streamText: (context) => {
        plannerInput = context.userPrompt;
        return (async function* () {
          for (const part of replayParts(fixture)) yield JSON.stringify(part) + "\n";
        })();
      },
      generateText: async () => { throw new Error("Unexpected non-streaming text call"); },
      ...(fixture.provider ? {
        generateVideo: async () => { throw new Error("private-provider-detail"); },
        generateSpeech: async () => { throw new Error("private-provider-detail"); },
        searchMedia: async () => {
          if (fixture.provider === "failed") throw new Error("private-provider-detail");
          return { url: "https://media.example/stock.mp4", type: "video" as const };
        },
      } : {}),
    });
    const started = performance.now();
    const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: fixture.prompt, mode: "cinematic", ...(fixture.id === "follow-up" ? {
        conversation: [{ prompt: results[0].prompt, response: ACCEPTANCE_FIXTURES[0].lines.join(" ") }],
      } : {}) }),
    }));
    if (!response.ok || !response.body) throw new Error(`Chat acceptance response failed: ${response.status}`);
    const events: TimedVideoEvent[] = [];
    for await (const event of decodeVideoSse(response.body)) events.push({ event, elapsedMs: performance.now() - started });
    const speech = await handler(new Request("https://app.example/api/video-chat?action=speech", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: fixture.lines[0] }),
    }));
    const speechBody = await speech.text();
    const report = evaluateChatAcceptance(fixture, events);
    report.checks.push({ id: "speech-fallback-contract", passed: fixture.provider
      ? speech.status === 502 && speechBody.includes("speech_failed") && !speechBody.includes("private-provider-detail")
      : speech.status === 204 });
    report.checks.push({ id: "conversation-context", passed: fixture.id !== "follow-up" || (
      plannerInput.includes(results[0].prompt) && plannerInput.includes(ACCEPTANCE_FIXTURES[0].lines[0])
    ) });
    report.passed = report.checks.every(({ passed }) => passed);
    results.push({ id: fixture.id, prompt: fixture.prompt, plannerInput, events,
      warnings: events.flatMap(({ event }) => event.type === "response.warning" ? [event.data.warning] : []),
      report,
    });
  }
  return results;
}
