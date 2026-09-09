import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoScene } from "../protocol/types.js";

/**
 * Say a video's narration as it plays.
 *
 * A narrated video is not a video with audio bolted on. The line belongs to the
 * scene, so it has to begin when that scene does and stop when the viewer moves
 * on - and every one of those was a bug in the application this was extracted
 * from: the voice starting before the first frame, a follow-up question
 * silently cutting the response off mid-sentence, a line still playing over the
 * scene after it.
 *
 * The application supplies a voice callback backed by a speech model, a
 * realtime session or the browser synthesiser. This hook decides what is said
 * and when speech starts and stops; provider selection stays in the app.
 */
export interface NarrationVoice {
  /**
   * Say this line, and resolve when it has been said.
   *
   * The signal aborts when the scene changes, when the viewer interrupts, or
   * when the player goes away. Stop speaking promptly: talking over the next
   * scene is worse than being cut off. Report onStart only when speech actually
   * begins playing; leave it uncalled when onset cannot be observed.
   */
  /** True only when the provider can start prepared audio at an exact offset. */
  supportsOffsets?: boolean;
  /** Active prepared audio time in seconds, including any requested seek offset. */
  getCurrentTime?: () => number | undefined;
  speak(text: string, options: { offsetSeconds?: number; signal: AbortSignal; onStart?: (source?: "browser" | "generated") => void; onBoundary?: (charIndex: number) => void; onPlaybackSource?: (source: "browser" | "generated") => void }): void | Promise<void>;
}

export interface NarrationOptions {
  voice: NarrationVoice;
  /** Say nothing at all while false. Defaults to true. */
  enabled?: boolean;
  /** Observes actual speech onset when the voice supports it. */
  onSpeechStart?: (source?: "browser" | "generated") => void;
}

export interface Narration {
  /** Pair with VideoPlayer.narrationReady to hold grouped cuts until actual audio onset. */
  isReady: () => boolean;
  getTime: (scene: VideoScene) => number | undefined;
  /** Confirmed onset through completion; pair with VideoPlayer.narrationActive. */
  isSpeaking: (scene: VideoScene) => boolean;
  /**
   * Hand this to the player's `onSceneChange`.
   *
   * The player already reports which scene is showing, which is the only cue a
   * narrator needs, so nothing here has to run its own clock.
   */
  onSceneChange: (scene: VideoScene, index: number) => void;
  /** Stop the current line. Nothing is said again until the next scene. */
  interrupt: () => void;
  /** Whether a line is being spoken right now. */
  speaking: boolean;
}

export function useNarration(options: NarrationOptions): Narration {
  const [speaking, setSpeaking] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const groupRef = useRef<VideoScene["narrationGroup"]>(undefined);
  const clockRef = useRef<number | undefined>(undefined);
  const clockSceneRef = useRef<string | undefined>(undefined);
  const readyRef = useRef(true);
  const startedRef = useRef(false);
  const getTime = useCallback((scene: VideoScene) => {
    const group = groupRef.current;
    if (optionsRef.current.enabled === false || (group ? scene.narrationGroup?.id !== group.id : scene.id !== clockSceneRef.current)) return undefined;
    if (!optionsRef.current.voice.getCurrentTime) return undefined;
    const time = currentRef.current ? optionsRef.current.voice.getCurrentTime() : undefined;
    if (currentRef.current && readyRef.current && time === undefined) return undefined;
    if (time !== undefined && Number.isFinite(time)) {
      if (currentRef.current && time >= (group?.offsetSeconds ?? 0) + .04) startedRef.current = true;
      // Browsers may expose duration before dispatching ended. Keep the final
      // audio frame inside its scene until speak resolves, so a cut cannot
      // abort the still-active utterance at that boundary.
      const end = group?.totalSeconds ?? scene.timing.fixedDuration ?? Infinity;
      const limit = currentRef.current ? Math.max(0, end - .01) : end;
      clockRef.current = Math.min(limit, Math.max(group?.offsetSeconds ?? 0, time));
    }
    return clockRef.current;
  }, []);
  const isReady = useCallback(() => optionsRef.current.enabled === false || readyRef.current
    || (clockRef.current !== undefined && clockRef.current >= (groupRef.current?.offsetSeconds ?? 0) + 0.04), []);
  const currentRef = useRef<AbortController | undefined>(undefined);
  const isSpeaking = useCallback((scene: VideoScene) => optionsRef.current.enabled !== false
    && startedRef.current && Boolean(currentRef.current) && (groupRef.current ? scene.narrationGroup?.id === groupRef.current.id : scene.id === clockSceneRef.current), []);
  // The index a line was started for, so a scene reported twice - which the
  // player does on a re-render - is not said twice, while a loop back to it is.
  const spokenIndexRef = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    readyRef.current = true;
    startedRef.current = false;
    currentRef.current?.abort();
    currentRef.current = undefined;
    groupRef.current = undefined;
    clockRef.current = undefined;
    clockSceneRef.current = undefined;
    setSpeaking(false);
  }, []);

  const interrupt = useCallback(() => {
    spokenIndexRef.current = undefined;
    stop();
  }, [stop]);

  // A player that goes away should not keep talking.
  useEffect(() => () => currentRef.current?.abort(), []);

  const onSceneChange = useCallback((scene: VideoScene, index: number) => {
    const { voice, enabled = true } = optionsRef.current;
    if (!enabled) return;
    if (spokenIndexRef.current === index) return;

    const group = scene.narrationGroup;
    if (group && voice.supportsOffsets !== true) { stop(); return; }
    if (group && currentRef.current && groupRef.current?.id === group.id && groupRef.current.text === group.text && spokenIndexRef.current === index - 1) {
      spokenIndexRef.current = index;
      return;
    }
    stop();
    spokenIndexRef.current = index;
    groupRef.current = group;
    clockRef.current = group?.offsetSeconds ?? 0;
    clockSceneRef.current = scene.id;
    const line = group?.text ?? scene.narration?.trim();
    if (!line) { clockRef.current = undefined; return; }

    const controller = new AbortController();
    currentRef.current = controller;
    readyRef.current = !group && !voice.getCurrentTime;
    setSpeaking(true);
    void (async () => {
      try {
        let started = false;
        await voice.speak(line, {
          signal: controller.signal,
          ...(group ? { offsetSeconds: group.offsetSeconds } : {}),
          onStart: (source) => {
            if (started || controller.signal.aborted || currentRef.current !== controller
              || (!group && spokenIndexRef.current !== index) || optionsRef.current.enabled === false) return;
            started = true;
            startedRef.current = true;
            readyRef.current = true;
            try { void Promise.resolve(optionsRef.current.onSpeechStart?.(source)).catch(() => undefined); }
            catch { /* Observer failures do not affect narration. */ }
          },
        });
        if (currentRef.current === controller && !controller.signal.aborted) {
          clockRef.current = group && started ? group.totalSeconds : undefined;
        }
      } catch {
        if (currentRef.current === controller) { groupRef.current = undefined; clockRef.current = undefined; }
        // A voice that fails is a video without narration, not a broken video.
        // The application hears about it through its own provider.
      } finally {
        if (currentRef.current === controller) {
          currentRef.current = undefined;
          readyRef.current = true;
          setSpeaking(false);
        }
      }
    })();
  }, [stop]);

  return { onSceneChange, interrupt, speaking, isReady, getTime, isSpeaking };
}
