import { getReadableSceneDuration } from "./pacing.js";
import type { VideoScene, VideoTemplatePacing } from "./types.js";

/**
 * How long a scene should be held.
 *
 * Every template already declares what it needs: `minDuration`,
 * `preferredDuration`, and which of its fields hold the content. What was
 * missing was any way for an application to ask. Reaching for `minDuration`
 * instead - the obvious field, and the one this repository documents least well
 * - gives the wrong answer: it is the least a template survives being squeezed
 * to when a video has to fit a fixed length, not the time it takes to read. It
 * is 1 second for `media` and 1.5 for `bigNumber`, and a narrated response built
 * on those flashes past.
 *
 * There is deliberately no upper bound. Once every word is on screen and read,
 * holding longer adds nothing but also breaks nothing, and a line too long for
 * its scene is a composition problem - split the beat - rather than something a
 * duration can fix.
 */
const NARRATION_WORDS_PER_SECOND = 2.6;
const NARRATION_TAIL_SECONDS = 0.6;

export interface SceneDurationBounds {
  /**
   * The least this scene survives being shown for.
   *
   * A compression bound, used when a video must fit a fixed length. It is not
   * a readability bound and should not be used as one.
   */
  minimum: number;
  /** How long the scene's own content takes to read, given what it holds. */
  readable: number;
}

export function getSceneDurationBounds(
  scene: Pick<VideoScene, "variables">,
  metadata: VideoTemplatePacing | undefined,
): SceneDurationBounds {
  return {
    minimum: Math.max(0.001, metadata?.minDuration ?? 1),
    readable: getReadableSceneDuration(scene, metadata),
  };
}

/**
 * How long a narrated line takes to say.
 *
 * Reading is faster than speech - the readable estimate runs at 4.5 words a
 * second, a realtime voice lands nearer 2.6 - so the two bounds measure
 * different things and a scene needs whichever is longer. The tail covers the
 * breath between lines.
 */
export function getSpokenDuration(narration: string): number {
  const words = narration.trim().split(/\s+/u).filter(Boolean).length;
  if (words === 0) return 0;
  return words / NARRATION_WORDS_PER_SECOND + NARRATION_TAIL_SECONDS;
}

export function getSceneDuration(
  scene: Pick<VideoScene, "variables" | "narration">,
  metadata: VideoTemplatePacing | undefined,
): number {
  const { readable } = getSceneDurationBounds(scene, metadata);
  // The voice sets the length and the template sets the floor: a six-word line
  // must not cut a five-step list short, and a long line must not be talked
  // over by the next scene.
  return Math.max(readable, scene.narration ? getSpokenDuration(scene.narration) : 0);
}
