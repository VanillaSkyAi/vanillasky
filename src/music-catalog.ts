import type { VideoAudio } from "./protocol/types.js";

export type MusicMood = "calm" | "focused" | "upbeat" | "off";
export type MusicPreference = MusicMood | "auto";

export interface MusicTrack {
  readonly id: string;
  readonly name: string;
  readonly mood: Exclude<MusicMood, "off">;
  readonly audioUrl: string;
  readonly duration: number;
}

/** TAD's CC0 compositions; provenance and normalization are in public/audio-library/README.md. */
export const musicTracks: readonly MusicTrack[] = [
  { id: "countryside", name: "Countryside", mood: "calm", audioUrl: "/audio-library/countryside.mp3", duration: 92.212245 },
  { id: "florist", name: "Florist", mood: "calm", audioUrl: "/audio-library/florist.mp3", duration: 113.031837 },
  { id: "rainy-forest", name: "Rainy Forest", mood: "calm", audioUrl: "/audio-library/rainy-forest.mp3", duration: 99.578776 },
  { id: "cue", name: "Cue", mood: "focused", audioUrl: "/audio-library/cue.mp3", duration: 146.625306 },
  { id: "bartender", name: "Bartender", mood: "focused", audioUrl: "/audio-library/bartender.mp3", duration: 246.700408 },
  { id: "cat-caffe", name: "Cat Caffe", mood: "upbeat", audioUrl: "/audio-library/cat-caffe.mp3", duration: 133.041633 },
  { id: "oceanside", name: "Oceanside", mood: "upbeat", audioUrl: "/audio-library/oceanside.mp3", duration: 102.635102 },
];

export function getMusicTrack(id: string): MusicTrack | undefined {
  return musicTracks.find(track => track.id === id);
}

export function selectMusicTrack(mood: MusicMood, previousTrackId?: string): MusicTrack | undefined {
  const eligible = musicTracks.filter(track => track.mood === mood);
  const alternatives = eligible.filter(track => track.id !== previousTrackId);
  const choices = alternatives.length ? alternatives : eligible;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : undefined;
}

export interface AnswerMusicChoice {
  preference?: MusicPreference;
  /** The mood the answer brief asked for; decides the track under Auto. */
  briefMood: MusicMood;
  initialTrackId?: string;
  previousTrackId?: string;
}

/** One rule for the answer's soundtrack, shared by live planning and recorded replay. */
export function chooseAnswerMusic({ preference = "auto", briefMood, initialTrackId, previousTrackId }: AnswerMusicChoice): MusicTrack | undefined {
  const mood = preference === "auto" ? briefMood : preference;
  const initialTrack = initialTrackId ? getMusicTrack(initialTrackId) : undefined;
  // Auto keeps the track already started on Ask throughout this answer.
  return initialTrack && (preference === "auto" || initialTrack.mood === mood)
    ? initialTrack : selectMusicTrack(mood, previousTrackId);
}

export function createMusicAudio(track: MusicTrack): VideoAudio {
  return {
    trackId: track.id,
    audioUrl: track.audioUrl,
    sourceDuration: track.duration,
    duration: track.duration,
    beatDetection: { sensitivity: 0.5 },
    beatMarkers: [],
    volume: 0.20,
    fadeOutMs: 2000,
  };
}
