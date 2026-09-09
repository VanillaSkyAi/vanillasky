import { getMusicTrack } from "../music-catalog.js";
import type { AudioPreferences } from "./audio-preferences.js";

export function AudioSettings({ preferences, change, reset, shuffle, trackId, sceneAudioAvailable }: {
  preferences: AudioPreferences;
  change(value: Partial<AudioPreferences>): void;
  reset(): void;
  shuffle(): void;
  trackId?: string;
  sceneAudioAvailable: boolean;
}) {
  const track = getMusicTrack(trackId ?? "");
  const sliders = [
    { key: "voiceVolume", label: "Voice volume" },
    { key: "musicVolume", label: "Music volume" },
    ...(sceneAudioAvailable ? [{ key: "sceneVolume", label: "Sound from video" }] : []),
  ] as const;
  return <fieldset className="audio-settings">
    <legend>Sound</legend>
    <label className="switch-row music-mood"><span><strong>Music mood</strong></span>
      <select aria-label="Music mood" value={preferences.musicMood}
        onChange={event => change({ musicMood: event.target.value as AudioPreferences["musicMood"] })}>
        <option value="auto">Auto</option><option value="calm">Calm</option>
        <option value="focused">Focused</option><option value="upbeat">Upbeat</option><option value="off">Off</option>
      </select>
    </label>
    {sliders.map(({ key, label }) => {
      const field = key as "voiceVolume" | "musicVolume" | "sceneVolume";
      const value = Math.round(preferences[field] * 100);
      return <label className="audio-slider" key={field}>
        <span><strong>{label}</strong><output aria-hidden="true">{value}%</output></span>
        <input type="range" aria-label={label} aria-valuetext={`${value}%`} min="0" max="100" step="1" value={value}
          onChange={event => change({ [field]: Number(event.target.value) / 100 })} />
      </label>;
    })}
    <div className="music-track"><span>{preferences.musicMood === "off" ? "Music is off" : track?.name ?? "Chosen for each answer"}</span>
      {track && preferences.musicMood !== "off" && <button type="button" onClick={shuffle}>Try another track</button>}
    </div>
    <p className="audio-hint">Background sound softens while the voice speaks.</p>
    <button className="audio-reset" type="button" onClick={reset}>Reset sound settings</button>
  </fieldset>;
}
