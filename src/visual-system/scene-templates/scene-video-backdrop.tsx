import { rampMediaVolume } from "../../player/audio-volume.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { type MediaRecoveryReason, useMediaAudio, useMediaFailure, useNarrationPreroll } from "./external-video-backdrop";
import { resolveMediaPosition } from "./media-position";
import { measuredClipPlayback } from "../../player/clip-repeat.js";

export interface SceneVideoBackdropProps {
  mediaUrl: string;
  mediaPoster?: string;
  mediaPosition?: string;
  progress: number;
  /** Prepared narration duration; quiet tails never require a repeat. */
  sceneDuration?: number;
  /** Fresh measured voice evidence supplied by client scene preparation. */
  measuredSpeechDurationSec?: number;
  /** Internal player-owned decoder priming, distinct from viewer pause. */
  preparingNarration?: boolean;
  isPlaying: boolean;
  muted?: boolean;
  volume?: number;
  playbackId?: string;
  onReady?: () => void;
  onError?: () => void;
}

export const SceneVideoBackdrop: React.FC<SceneVideoBackdropProps> = ({
  mediaUrl,
  mediaPoster,
  mediaPosition = "center",
  progress,
  sceneDuration,
  measuredSpeechDurationSec,
  preparingNarration = false,
  isPlaying,
  muted,
  volume,
  playbackId = mediaUrl,
  onReady,
  onError,
}) => {
  const inheritedAudio = useMediaAudio();
  const reportMediaFailure = useMediaFailure();
  const inheritedPreroll = useNarrationPreroll();
  const rewindPreroll = preparingNarration || inheritedPreroll;
  const [gainUnavailable, setGainUnavailable] = useState(false);
  const resolvedMuted = (muted ?? inheritedAudio.muted) || gainUnavailable;
  const resolvedVolume = volume ?? inheritedAudio.volume;
  const resolvedPosition = resolveMediaPosition(mediaPosition);
  const [decodedVideoUrl, setDecodedVideoUrl] = useState<string>();
  const [waitingKey, setWaitingKey] = useState<string>();
  const [exhaustedKey, setExhaustedKey] = useState<string>();
  const [repeatingKey, setRepeatingKey] = useState<string>();
  const [endedKey, setEndedKey] = useState<string>();

  const videoRef = useRef<HTMLVideoElement>(null);
  const playableVideoUrl = useRef<string | undefined>(undefined);
  const startedVideoUrl = useRef<string | undefined>(undefined);
  const startedPlaybackId = useRef<string | undefined>(undefined);
  const videoPresentationKey = `${playbackId}\0${mediaUrl}`;

  const presentationRef = useRef({ key: videoPresentationKey, playing: isPlaying, progress });
  const failedPresentationRef = useRef<string | undefined>(undefined);
  const repeatedPresentationRef = useRef<string | undefined>(undefined);
  const previousProgressRef = useRef({ key: videoPresentationKey, progress });
  presentationRef.current = { key: videoPresentationKey, playing: isPlaying, progress };
  const unavailable = (reason: MediaRecoveryReason = "playback-error") => {
    if (presentationRef.current.key === videoPresentationKey && failedPresentationRef.current !== videoPresentationKey
      && (presentationRef.current.playing || reason === "duration-mismatch")) {
      failedPresentationRef.current = videoPresentationKey;
      setExhaustedKey(videoPresentationKey);
      onError?.();
      reportMediaFailure?.(reason);
    }
  };
  useEffect(() => {
    // Hidden preparation is bounded by mounted readiness once its cut is due.
    // It must not spend the next scene's stall deadline while still incoming.
    if (!isPlaying || rewindPreroll || waitingKey !== videoPresentationKey) {
      if (waitingKey) setWaitingKey(undefined);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const expectedSource = video.getAttribute("src") === mediaUrl ? video.src : undefined;
    let awaitingPlayback = playableVideoUrl.current !== mediaUrl || video.currentSrc !== expectedSource;
    let previousTime = video.currentTime;
    let forwardFrames = 0;
    let stopped = false;
    let frame: number | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const observe = (_now?: number, metadata?: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      const currentSource = video.currentSrc === expectedSource;
      if (currentSource && awaitingPlayback && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        playableVideoUrl.current = mediaUrl;
        awaitingPlayback = false;
        clearTimeout(deadline);
        deadline = setTimeout(fail, 1000);
      }
      const time = metadata?.mediaTime ?? video.currentTime;
      if (!currentSource || video.seeking || time < previousTime) forwardFrames = 0;
      else if (time > previousTime + .001) forwardFrames++;
      previousTime = time;
      // One seek frame is not resumed motion. Require consecutive forward
      // observations before releasing the original bounded stall deadline.
      if (forwardFrames >= 2) {
        playableVideoUrl.current = mediaUrl;
        stopped = true;
        clearTimeout(deadline);
        setWaitingKey(undefined);
        return;
      }
      if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(observe);
      else poll = setTimeout(observe, 50);
    };
    // A seek can emit waiting without another playing event, even while frames
    // resume. Keep the decoder visible and observe motion directly. A real
    // stall gets the player's authored chapter instead of an endless spinner.
    const fail = () => { if (!stopped) { stopped = true; unavailable(awaitingPlayback ? "frame-readiness-timeout" : "stalled-media"); } };
    // Initial network/decode work has the same bound as mounted readiness.
    // A decoded still with no future data is still cold, even after its first
    // frame callback. Keep the short bound only after playback was available.
    let deadline = setTimeout(fail, awaitingPlayback ? 8000 : 1000);
    observe();
    return () => {
      stopped = true;
      clearTimeout(deadline);
      clearTimeout(poll);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    };
  }, [waitingKey, videoPresentationKey, isPlaying, rewindPreroll]);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let frame: number | undefined;
    const markPresented = () => {
      if (stopped || !video.isConnected || presentationRef.current.key !== videoPresentationKey
        || video.getAttribute("src") !== mediaUrl || video.currentSrc !== video.src
        || failedPresentationRef.current === videoPresentationKey) return false;
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) playableVideoUrl.current = mediaUrl;
      video.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true }));
      onReadyRef.current?.();
      setDecodedVideoUrl(mediaUrl);
      stopped = true;
      return true;
    };
    const observe = () => {
      if (stopped || frame !== undefined) return;
      if (video.requestVideoFrameCallback) {
        frame = video.requestVideoFrameCallback(() => {
          frame = undefined;
          if (!markPresented()) observe();
        });
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markPresented();
    };
    // A cached resource can finish loading while its Suspense tree is still
    // detached. Observe the mounted frame even if loadeddata was missed.
    video.addEventListener("loadeddata", observe);
    observe();
    return () => {
      stopped = true;
      video.removeEventListener("loadeddata", observe);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    };
  }, [mediaUrl, videoPresentationKey]);

  const allowsRepeat = (video: HTMLVideoElement) => {
    const fit = measuredClipPlayback(measuredSpeechDurationSec, video.duration);
    return fit?.repeat === true && sceneDuration !== undefined && sceneDuration <= fit.durationSec + 1e-6;
  };
  const fitDuration = useCallback((video: HTMLVideoElement) => {
    video.playbackRate = 1;
    if (sceneDuration && Number.isFinite(video.duration) && video.duration > 0 && sceneDuration > video.duration + .05 && !allowsRepeat(video)) {
      video.pause();
      unavailable("duration-mismatch");
      return false;
    }
    return true;
  }, [sceneDuration, measuredSpeechDurationSec, videoPresentationKey]);
  useEffect(() => {
    if (videoRef.current) fitDuration(videoRef.current);
  }, [fitDuration]);
  useEffect(() => {
    if (!isPlaying || endedKey !== videoPresentationKey) return;
    // Let the final clock tick commit, but never hold an exhausted outgoing
    // clip indefinitely while the next scene is still cold.
    const timer = setTimeout(() => {
      if (videoRef.current?.ended) unavailable();
    }, 50);
    return () => clearTimeout(timer);
  }, [endedKey, videoPresentationKey, isPlaying]);
  useEffect(() => {
    if (!isPlaying || repeatingKey !== videoPresentationKey) return;
    let frame: number;
    const observe = () => {
      const video = videoRef.current;
      const fit = video && measuredClipPlayback(measuredSpeechDurationSec, video.duration);
      if (!video || presentationRef.current.progress >= 1) return;
      // The same decoder bounds actual recovery too: a voice that outlives
      // its measurement must not spend the rest of a second full clip.
      if (!fit?.repeat || video.currentTime > fit.durationSec - video.duration + .05) {
        unavailable("duration-mismatch");
        return;
      }
      frame = requestAnimationFrame(observe);
    };
    frame = requestAnimationFrame(observe);
    return () => cancelAnimationFrame(frame);
  }, [repeatingKey, videoPresentationKey, isPlaying, measuredSpeechDurationSec]);
  const finishMotion = () => {
    if (!isPlaying) return;
    const video = videoRef.current;
    const fit = video && measuredClipPlayback(measuredSpeechDurationSec, video.duration);
    // Native ended may precede the final animation-frame commit. A completed
    // fitting line needs neither recovery nor a repeat during that last tick.
    if (video?.ended && fit && !fit.repeat && sceneDuration !== undefined
      && sceneDuration <= video.duration + .05 && (1 - progress) * sceneDuration <= .05) {
      setEndedKey(videoPresentationKey);
      return;
    }
    if (video && video.ended && !video.error && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && video.currentSrc === video.src && playableVideoUrl.current === mediaUrl
      && failedPresentationRef.current !== videoPresentationKey && waitingKey !== videoPresentationKey
      && repeatedPresentationRef.current !== videoPresentationKey && progress < 1 && allowsRepeat(video)) {
      repeatedPresentationRef.current = videoPresentationKey;
      setRepeatingKey(videoPresentationKey);
      video.currentTime = 0;
      void video.play().catch(() => unavailable());
      return;
    }
    // Unknown, larger or unhealthy overruns retain the complete spoken line
    // on a chapter. A second exhaustion cannot purchase another repetition.
    unavailable();
  };

  useEffect(() => {
    const previous = previousProgressRef.current;
    previousProgressRef.current = { key: videoPresentationKey, progress };
    const video = videoRef.current;
    // Only an explicit backward playhead move rewinds this decoder. A pause,
    // an ended clip, or an active/next promotion must never cause a replay.
    if (!video || rewindPreroll || previous.key !== videoPresentationKey || progress >= previous.progress - .05
      || !sceneDuration || !Number.isFinite(sceneDuration)) return;
    const target = Math.max(0, progress * sceneDuration);
    setEndedKey(undefined);
    const seekingRepeated = allowsRepeat(video) && target >= video.duration;
    setRepeatingKey(seekingRepeated ? videoPresentationKey : undefined);
    if (seekingRepeated) repeatedPresentationRef.current = videoPresentationKey;
    else if (progress <= .001) repeatedPresentationRef.current = undefined;
    video.currentTime = seekingRepeated ? target % video.duration : target;
    failedPresentationRef.current = undefined;
    setExhaustedKey(undefined);
    if (isPlaying && video.paused) void video.play().catch(() => unavailable());
  }, [progress, videoPresentationKey, sceneDuration, measuredSpeechDurationSec, rewindPreroll, isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React Strict Mode rehearses setup → cleanup → setup in development.
    // The cleanup deliberately releases the decoder, so the repeated setup
    // must restore the declarative source before the playback effect runs.
    if (video.getAttribute("src") !== mediaUrl) {
      video.setAttribute("src", mediaUrl);
      video.load();
    }
  }, [mediaUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // A source change already starts a native load via React's src update.
    // Tear down the decoder only on unmount, never cancel that new request.
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      startedVideoUrl.current = undefined;
      startedPlaybackId.current = undefined;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) return rampMediaVolume(video, resolvedVolume, () => setGainUnavailable(true));
  }, [resolvedVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying) {
      video.pause();
      // Keep silent prepared data intact through narration startup. Seeking
      // back a few milliseconds can trigger another cold Range request.
      if (rewindPreroll && !resolvedMuted && video.currentTime > 0) video.currentTime = 0;
      return;
    }
    if (startedPlaybackId.current === playbackId) {
      if (video.ended) finishMotion();
      else void video.play().catch(() => unavailable());
      return;
    }
    const changingSource = startedVideoUrl.current !== undefined && startedVideoUrl.current !== mediaUrl;
    if (!fitDuration(video)) return;
    if (!changingSource && video.currentTime > 0) video.currentTime = 0;
    video.play().catch(() => unavailable());
    startedVideoUrl.current = mediaUrl;
    startedPlaybackId.current = playbackId;
  }, [isPlaying, mediaUrl, playbackId, rewindPreroll]);

  const enforceRequestedPause = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    // WebKit may enter playback without a playing event while seeking or
    // waiting. Both native start events must honor the latest requested hold.
    if (presentationRef.current.playing) return;
    event.currentTarget.pause();
    // A late start can advance WebKit's decoded frames while its paused clock
    // stays pinned. Reset this unexpected preroll, including silent footage,
    // so resuming narration does not wait for the clock to catch stale pixels.
    if (rewindPreroll && event.currentTarget.currentTime > 0) event.currentTarget.currentTime = 0;
  };

  const mediaStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: resolvedPosition,
  };
  return (
    <>
      {exhaustedKey === videoPresentationKey && <div
        role="status" data-media-continuity="exhausted"
        style={{ position: "absolute", inset: 0, zIndex: 3, background: "#000", color: "#bbb", display: "grid", placeContent: "center", font: "14px system-ui" }}
      >Visual unavailable</div>}
      <video
        ref={videoRef}
        src={mediaUrl}
        poster={decodedVideoUrl !== mediaUrl ? mediaPoster || undefined : undefined}
        muted={resolvedMuted}
        loop={false}
        playsInline
        preload="auto"
        onLoadedMetadata={event => fitDuration(event.currentTarget)}
        onEnded={finishMotion}
        onPlay={enforceRequestedPause}
        onPlaying={event => {
          if (event.currentTarget.currentSrc === event.currentTarget.src
            && event.currentTarget.getAttribute("src") === mediaUrl
            && event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) playableVideoUrl.current = mediaUrl;
          enforceRequestedPause(event);
        }}
        onWaiting={() => { if (isPlaying) setWaitingKey(videoPresentationKey); }}
        onError={onError}
        data-media-position={mediaPosition}
        data-video-backdrop="scene"
        style={{ ...mediaStyle, visibility: exhaustedKey === videoPresentationKey ? "hidden" : undefined }}
      />
    </>
  );
};
