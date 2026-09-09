import { describe, expect, it } from "vitest";
import type { VideoAudio, VideoScene } from "../src/protocol/types";
import { applyVideoEvent, createVideoState } from "../src/protocol/state";
import { createSceneTimeline } from "../src/protocol/scene-timeline";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";

/**
 * Every assertion here runs the emitted events through the real reducer.
 *
 * That is the whole point of this timeline existing. A host composing envelopes
 * by hand gets the sequence, the event id, or the scene position slightly
 * wrong, the reducer rejects the stream, and the player renders nothing with a
 * clean console - a silent failure that costs days to find.
 */
async function play(stream: AsyncIterable<unknown>) {
  let state = createVideoState();
  for await (const event of stream) state = applyVideoEvent(state, event);
  return state;
}

function scene(id: string, texts: string): VideoScene {
  return {
    id,
    templateId: "media",
    variables: { texts, mediaType: "gradient" },
    timing: { fixedDuration: 4 },
  };
}

const AUDIO: VideoAudio = {
  trackId: "hosted-1",
  audioUrl: "https://audio.example.test/track.mp3",
  duration: 30,
  beatDetection: { sensitivity: 0.5 },
  beatMarkers: [{ time: 0.5 }],
};

describe("createSceneTimeline", () => {
  it("accepts host-built scenes as one playable video", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE });
    timeline.add(scene("first", "Opening"));
    timeline.add(scene("second", "Answer"));
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.status).toBe("complete");
    expect(state.config?.scenes.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("matches its own completion checksum", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE });
    timeline.add(scene("only", "One"));
    timeline.complete();

    const state = await play(timeline.stream);
    // A snapshot the host reproduces incorrectly is a stream the player
    // discards at the last event, after everything looked fine.
    expect(state.checksum).toBeDefined();
    expect(state.errors).toEqual([]);
  });

  it("carries a soundtrack declared up front", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE, audio: AUDIO });
    timeline.add(scene("first", "Opening"));
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.audio?.trackId).toBe("hosted-1");
  });

  it("holds scenes until the soundtrack is known", async () => {
    // audio.set is only valid before the first scene, so a timeline whose track
    // is resolved by a later call must not emit its openings yet.
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE, awaitAudio: true });
    timeline.add(scene("first", "Opening"));
    timeline.setAudio(AUDIO);
    timeline.add(scene("second", "Answer"));
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.audio?.trackId).toBe("hosted-1");
    expect(state.config?.scenes.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("releases held scenes when there turns out to be no soundtrack", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE, awaitAudio: true });
    timeline.add(scene("first", "Opening"));
    timeline.setAudio(undefined);
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.audio).toBeUndefined();
    expect(state.config?.scenes).toHaveLength(1);
  });

  it("releases held scenes when a run ends before its soundtrack resolves", async () => {
    // A failed run never says what the audio is; its openings still belong in
    // the video rather than nowhere.
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE, awaitAudio: true });
    timeline.add(scene("first", "Opening"));
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.scenes).toHaveLength(1);
  });

  it("ignores anything added after completion", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE });
    timeline.add(scene("first", "Opening"));
    timeline.complete();
    timeline.add(scene("late", "Too late"));
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.scenes.map((entry) => entry.id)).toEqual(["first"]);
  });

  it("carries the narration on the scenes it emits", async () => {
    const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE });
    timeline.add({ ...scene("first", "Opening"), narration: "Said while this shows." });
    timeline.complete();

    const state = await play(timeline.stream);
    expect(state.config?.scenes[0].narration).toBe("Said while this shows.");
  });
});
