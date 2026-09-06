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
    { id: "grounded-readable-copy", passed: scenes.length > 0 && scenes.every(({ scene }, index) => scene.narration === fixture.lines[index] && fixture.lines[index].split(/\s+/).length <= 15 && (scene.timing?.fixedDuration ?? 0) >= 4) },
    { id: "media-ready", passed: scenes.length > 0 && scenes.every(({ scene }, index) => fixture.recovery
      ? scene.templateId === "chapterTitle" && scene.variables.title === fixture.titles[index] && fixture.titles[index].length > 0 && fixture.titles[index].length <= 65
      : scene.templateId === "cinemaMedia" && scene.variables.mediaType === "video" && scene.variables.fallbackText === fixture.titles[index]
        && scene.variables.mediaUrl === (fixture.mode === "pexels" ? "https://media.example/stock.mp4" : "https://media.example/generated.mp4")) },
    { id: "speech-prepares-before-media", passed: scenes.length > 0 && scenes.every(({ scene }) => {
      const preparationIndex = events.findIndex(({ event }) => event.type === "data.video-chat-preparation" && event.data != null && typeof event.data === "object" && "sceneId" in event.data && "narration" in event.data && event.data.sceneId === scene.id && event.data.narration === scene.narration);
      return preparationIndex >= 0 && preparationIndex < events.findIndex(({ event }) => event.type === "scene.add" && event.data.scene.id === scene.id);
    }) },
    { id: "safe-recovery-warning", passed: (!fixture.recovery || events.some(({ event }) => event.type === "response.warning")) && !JSON.stringify(events).includes("private-provider-detail") },
  ];
  return { passed: checks.every(({ passed }) => passed), checks, metrics: { openingMs: opening?.elapsedMs, firstSceneMs: scenes[0]?.elapsedMs, completionMs: completion?.elapsedMs } };
}
