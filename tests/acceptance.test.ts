import { describe, expect, it } from "vitest";
import { evaluateChatAcceptance } from "../scripts/acceptance/evaluate";
import { ACCEPTANCE_FIXTURES } from "../scripts/acceptance/fixtures";
import { runChatAcceptance } from "../scripts/acceptance/journey";

describe("chat acceptance gates", () => {
  it("rejects slow opening and first scene, lost completed scenes, and invented copy", async () => {
    const [result] = await runChatAcceptance();
    const events = structuredClone(result.events);
    for (const entry of events) {
      if (entry.event.type === "data.video-chat-opening") entry.elapsedMs = 500;
      if (entry.event.type === "scene.add") {
        entry.elapsedMs = 2_000;
        entry.event.data.scene.narration = "Invented claim";
      }
      if (entry.event.type === "response.complete") entry.event.data.snapshot.scenes.pop();
    }
    const report = evaluateChatAcceptance(ACCEPTANCE_FIXTURES[0], events);
    expect(report.passed).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id)).toEqual(expect.arrayContaining([
      "opening-before-scenes", "first-scene-ready", "completed-scenes-preserved", "grounded-readable-copy",
    ]));
  });

  it("rejects unresolved media, missing completion, and leaked provider details", async () => {
    const results = await runChatAcceptance();
    const events = structuredClone(results[3].events).filter(({ event }) => event.type !== "response.complete");
    for (const { event } of events) {
      if (event.type === "scene.add") { event.data.scene.variables.mediaUrl = ""; event.data.scene.narration = "private-provider-detail"; }
      if (event.type === "response.warning") event.data.warning.message = "private-provider-detail";
    }
    const report = evaluateChatAcceptance(ACCEPTANCE_FIXTURES[3], events);
    expect(report.passed).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id)).toEqual(expect.arrayContaining([
      "response-complete", "media-ready", "safe-recovery-warning",
    ]));
  });
});
