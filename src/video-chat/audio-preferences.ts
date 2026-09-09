import type { MusicPreference } from "../music-catalog.js";

export interface AudioPreferences {
  musicMood: MusicPreference;
  voiceVolume: number;
  musicVolume: number;
  sceneVolume: number;
}

export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = Object.freeze({
  musicMood: "auto", voiceVolume: 1, musicVolume: .2, sceneVolume: .2,
});
const STORAGE_KEY = "vanillasky.audio";

export function updateAudioPreferences(current: AudioPreferences, value: unknown): AudioPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  const candidate = value as Record<string, unknown>;
  const next = { ...current };
  if (["auto", "calm", "focused", "upbeat", "off"].includes(candidate.musicMood as string)) {
    next.musicMood = candidate.musicMood as MusicPreference;
  }
  for (const key of ["voiceVolume", "musicVolume", "sceneVolume"] as const) {
    const amount = candidate[key];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= 1) next[key] = amount;
  }
  return next;
}

export function readAudioPreferences(): AudioPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored.length <= 1000
      ? updateAudioPreferences(DEFAULT_AUDIO_PREFERENCES, JSON.parse(stored)) : { ...DEFAULT_AUDIO_PREFERENCES };
  } catch { return { ...DEFAULT_AUDIO_PREFERENCES }; }
}

export function saveAudioPreferences(preferences: AudioPreferences): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { /* Sound controls also work when browser storage is unavailable. */ }
}
