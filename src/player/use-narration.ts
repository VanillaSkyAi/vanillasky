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
 * The provider is not the SDK's business. An application supplies something
 * that can speak - a realtime session, a speech model, the browser's own
 * synthesiser - and this decides what is said, when it starts, and when it
 * stops. That keeps the package free of provider dependencies and leaves the
 * choice of voice where the choice of model already is.
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
  speak(text: string, options: { offsetSeconds?: number; signal: AbortSignal; onStart?: (source?: "browser" | "generated") => void }): void | Promise<void>;
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

  const groupRef = useRef<{ id: string; text: string } | undefined>(undefined);
  const readyRef = useRef(true);
  const isReady = useCallback(() => readyRef.current, []);
  const currentRef = useRef<AbortController | undefined>(undefined);
  // The index a line was started for, so a scene reported twice - which the
  // player does on a re-render - is not said twice, while a loop back to it is.
  const spokenIndexRef = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    readyRef.current = true;
    currentRef.current?.abort();
    currentRef.current = undefined;
    groupRef.current = undefined;
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
    const line = group?.text ?? scene.narration?.trim();
    if (!line) return;

    const controller = new AbortController();
    currentRef.current = controller;
    readyRef.current = !group;
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
            readyRef.current = true;
            try { void Promise.resolve(optionsRef.current.onSpeechStart?.(source)).catch(() => undefined); }
            catch { /* Observer failures do not affect narration. */ }
          },
        });
      } catch {
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

  return { onSceneChange, interrupt, speaking, isReady };
}
