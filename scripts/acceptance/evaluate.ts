import type { VideoEvent } from "../../src/protocol/events";
import type { ChatFixture } from "./fixtures";

export interface TimedVideoEvent { event: VideoEvent; elapsedMs: number }
export function evaluateChatAcceptance(fixture: ChatFixture, events: TimedVideoEvent[]) {
  const opening = events.find(({ event }) => event.type === "data.video-chat-opening");
  const scenes = events.flatMap(({ event, elapsedMs }) => event.type === "scene.add" ? [{ scene: event.data.scene, elapsedMs }] : []);
  const completion = events.find(({ event }) => event.type === "response.complete");
  const checks = [
    { id: "opening-before-scenes", passed: !!opening && opening.elapsedMs <= 250 && events.indexOf(opening) < events.findIndex(({ event }) => event.type === "scene.add") },
    { id: "first-scene-ready", passed: !!scenes[0] && scenes[0].elapsedMs <= 1_000 },
    { id: "completed-scenes-preserved", passed: scenes.length === fixture.lines.length && completion?.event.type === "response.complete" && completion.event.data.snapshot.scenes.length === scenes.length },
    { id: "response-complete", passed: !!completion && completion.elapsedMs <= 3_000 && !events.some(({ event }) => event.type === "response.error" || event.type === "response.abort") },
    { id: "grounded-readable-copy", passed: scenes.length > 0 && scenes.every(({ scene }, index) => (fixture.provider === "stock" || scene.variables.title === fixture.lines[index]) && scene.narration === fixture.lines[index] && fixture.lines[index].split(/\s+/).length <= 15 && (scene.timing?.fixedDuration ?? 0) >= 4) },
    { id: "media-ready", passed: scenes.length > 0 && scenes.every(({ scene }) => fixture.provider === "stock" ? scene.variables.mediaUrl === "https://media.example/stock.mp4" : scene.templateId === "chapterTitle") },
    { id: "safe-recovery-warning", passed: (fixture.provider !== "failed" || events.some(({ event }) => event.type === "response.warning")) && !JSON.stringify(events).includes("private-provider-detail") },
  ];
  return { passed: checks.every(({ passed }) => passed), checks, metrics: { openingMs: opening?.elapsedMs, firstSceneMs: scenes[0]?.elapsedMs, completionMs: completion?.elapsedMs } };
}
