import { afterEach, describe, expect, it, vi } from "vitest";
import { createMusicAudio, getMusicTrack, musicTracks, selectMusicTrack } from "../src/music-catalog";

afterEach(() => vi.restoreAllMocks());

describe("answer music catalog", () => {
  it("chooses only eligible tracks and avoids the previous track when another fits", () => {
    for (const mood of ["calm", "focused", "upbeat"] as const) {
      const eligible = musicTracks.filter(track => track.mood === mood);
      expect(eligible.length).toBeGreaterThan(1);
      for (const previous of eligible) {
        for (const random of [0, 0.49, 0.99999]) {
          vi.spyOn(Math, "random").mockReturnValue(random);
          const selected = selectMusicTrack(mood, previous.id);
          expect(selected?.mood).toBe(mood);
          expect(selected?.id).not.toBe(previous.id);
          expect(getMusicTrack(selected!.id)).toBe(selected);
        }
      }
    }
  });

  it("returns silence for off, and ignores unknown previous identifiers", () => {
    expect(selectMusicTrack("off", "cue")).toBeUndefined();
    expect(getMusicTrack("https://untrusted.example/music.mp3")).toBeUndefined();
    expect(selectMusicTrack("focused", "retired-track")?.mood).toBe("focused");
  });

  it("creates detached, replayable soundtrack metadata with a narration-friendly base level", () => {
    const track = getMusicTrack("cue")!;
    const audio = createMusicAudio(track);
    expect(audio).toMatchObject({ trackId: track.id, audioUrl: track.audioUrl, sourceDuration: track.duration,
      duration: track.duration, volume: 0.15, fadeOutMs: 2000, beatMarkers: [] });
    audio.beatMarkers.push({ time: 1 });
    expect(createMusicAudio(track).beatMarkers).toEqual([]);
  });
});
