import type { CSSProperties } from "react";
import type { VideoEvent } from "../protocol/events.js";
import type { VideoState } from "../protocol/state.js";
import type { Video, VideoOrientation, VideoScene } from "../protocol/types.js";
import type { VideoPlaybackMode } from "./playback-policy.js";

export interface NativeMediaAudioOptions {
  /** Volume of the active scene video's embedded audio, from 0 to 1. */
  volume?: number;
}

export type PlaybackWaitReason = "scene-generation" | "speech" | "media-decoding";
export type MediaPlaybackMetric =
  | { type: "media-playback"; clipDurationSec: number; sceneDurationSec: number; repeatCount: number }
  | { type: "buffer"; bufferedSeconds: number };

interface VideoPlayerSharedProps {
  /** High-level startup policy. When set, this overrides autoPlay and startMuted. */
  playbackMode?: VideoPlaybackMode;
  /** Initial playback state. Reduced-motion preferences take precedence. */
  autoPlay?: boolean;
  startMuted?: boolean;
  /** Play embedded audio from active scene videos as a layer beneath the master mute control. */
  nativeMediaAudio?: NativeMediaAudioOptions;
  /** Fixed display width. Omit to observe and fill the parent width. */
  width?: number;
  /** Override the streamed orientation, or switch at the container breakpoint. */
  orientation?: VideoOrientation | "auto";
  /** Container width at or below which auto orientation uses portrait. */
  responsiveBreakpoint?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the player region. */
  ariaLabel?: string;
  /**
   * Show the player's own controls: play, mute, fullscreen, and the replay
   * offered when the video ends. Default true.
   *
   * Turn them off where the host drives playback itself and a second set of
   * controls would contradict it - a narrated answer whose voice and picture
   * are one thing, where pausing the picture alone desynchronises them, and
   * where a replay scrim would cover the answer the moment it finished.
   */
  controls?: boolean;
  /** Optional synchronous onset handshake from useNarration.isReady. Does not pause audio or prevent the first scene cue. */
  narrationReady?: () => boolean;
  /** Active audio time: paragraph-relative for a narration group, scene-relative otherwise. Undefined resumes the normal clock. */
  narrationTime?: (scene: VideoScene) => number | undefined;
  /** Actual utterance completion when a voice has no audio clock. Pair with useNarration.isSpeaking. */
  narrationActive?: (scene: VideoScene) => boolean;
  /**
   * Hold the playhead where it is, and release it again.
   *
   * The counterpart to turning `controls` off. A host that owns playback needs
   * a lever to drive it with, and until this there was none: the clock is the
   * player's, so a narrated answer could silence its voice but not stop its
   * picture, and the two came apart. Setting it back to false resumes from the
   * same playhead rather than restarting.
   *
   * Leave it undefined to keep the player's own behaviour untouched. A video
   * that has already reached its end is not resumed by it - the playhead is
   * already there, and starting again is a replay, which is a different act.
   */
  paused?: boolean;
  /** Repeat the saved video and its soundtrack instead of showing the replay affordance. */
  loop?: boolean;
  /** Fires once when the playhead reaches the end of a non-looping video. */
  onPlaybackEnd?: (video: Video) => void;
  /** Fires when a streamed response has finished composing. */
  onComplete?: (video: Video) => void;
  onError?: (error: Error) => void;
  /** First active scene committed, observed at the next animation frame; excludes idle posters. */
  onFramePresented?: () => unknown;
  /** First actual mounted video frame; excludes graphics, posters and safe fallbacks. */
  onMediaFramePresented?: () => unknown;
  /** Stream playback has reached its available scenes; excludes initial waiting and deliberate pauses. */
  onStallChange?: (stalled: boolean, reason?: PlaybackWaitReason) => unknown;
  /** Opt-in local native-media diagnostics; contains no scene IDs, URLs, or content. */
  onPlaybackMetric?: (metric: MediaPlaybackMetric) => unknown;
  /** Fires when the scene under the playhead changes, including on a loop wrap. */
  onSceneChange?: (scene: VideoScene, index: number) => void;
}

export type VideoPlayerProps = VideoPlayerSharedProps & (
  | { video: Video; stream?: never }
  | { stream?: AsyncIterable<VideoEvent>; video?: never }
);

export interface VideoPlayerRuntimeProps extends Omit<VideoPlayerSharedProps, "onComplete" | "onPlaybackEnd" | "onError"> {
  stream?: AsyncIterable<VideoEvent>;
  video?: Video;
  onComplete?: (state: VideoState) => void;
  onPlaybackEnd?: (state: VideoState) => void;
  onError?: (error: Error, state: VideoState) => void;
  onStateChange?: (state: VideoState) => void;
}
