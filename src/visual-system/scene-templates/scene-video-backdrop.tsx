import React, { useCallback, useEffect, useRef, useState } from "react";
import { getBackgroundTransform } from "../backgrounds";
import { type MediaRecoveryReason, useMediaAudio, useMediaFailure, useNarrationPreroll } from "./external-video-backdrop";
import { resolveMediaPosition } from "./media-position";

export interface SceneVideoBackdropProps {
  mediaUrl: string;
  mediaPoster?: string;
  mediaPosition?: string;
  backgroundEffect?: string;
  progress: number;
  /** Narration-led visible duration; muted or pitch-preserving footage may be gently retimed. */
  sceneDuration?: number;
  /** Internal player-owned decoder priming, distinct from viewer pause. */
  preparingNarration?: boolean;
  beatIntensity?: number;
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
  backgroundEffect,
  progress,
  sceneDuration,
  preparingNarration = false,
  beatIntensity = 0,
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
  const resolvedMuted = muted ?? inheritedAudio.muted;
  const resolvedVolume = volume ?? inheritedAudio.volume;
  const resolvedPosition = resolveMediaPosition(mediaPosition);
  const bgTransform = getBackgroundTransform(backgroundEffect, progress, beatIntensity);
  const [decodedVideoUrl, setDecodedVideoUrl] = useState<string>();
  const [waitingKey, setWaitingKey] = useState<string>();
  const [exhaustedKey, setExhaustedKey] = useState<string>();

  const videoRef = useRef<HTMLVideoElement>(null);
  const presentedVideoUrl = useRef<string | undefined>(undefined);
  const startedVideoUrl = useRef<string | undefined>(undefined);
  const startedPlaybackId = useRef<string | undefined>(undefined);
  const videoPresentationKey = `${playbackId}\0${mediaUrl}`;

  const presentationRef = useRef({ key: videoPresentationKey, playing: isPlaying });
  presentationRef.current = { key: videoPresentationKey, playing: isPlaying };
  const unavailable = (reason: MediaRecoveryReason = "playback-error") => {
    if (presentationRef.current.key === videoPresentationKey && presentationRef.current.playing) {
      setExhaustedKey(videoPresentationKey);
      onError?.();
      reportMediaFailure?.(reason);
    }
  };
  useEffect(() => {
    if (!isPlaying || waitingKey !== videoPresentationKey) {
      if (waitingKey) setWaitingKey(undefined);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const expectedSource = video.getAttribute("src") === mediaUrl ? video.src : undefined;
    let awaitingFirstFrame = presentedVideoUrl.current !== mediaUrl || video.currentSrc !== expectedSource;
    let previousTime = video.currentTime;
    let forwardFrames = 0;
    let stopped = false;
    let frame: number | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const observe = (_now?: number, metadata?: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      const currentSource = video.currentSrc === expectedSource;
      if (currentSource && awaitingFirstFrame && (metadata || presentedVideoUrl.current === mediaUrl)) {
        awaitingFirstFrame = false;
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
    const fail = () => { if (!stopped) { stopped = true; unavailable(awaitingFirstFrame ? "frame-readiness-timeout" : "stalled-media"); } };
    // Initial network/decode work has the same bound as mounted readiness.
    // Only a source that has presented a frame can be judged as stalled motion.
    let deadline = setTimeout(fail, awaitingFirstFrame ? 8000 : 1000);
    observe();
    return () => {
      stopped = true;
      clearTimeout(deadline);
      clearTimeout(poll);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    };
  }, [waitingKey, videoPresentationKey, isPlaying]);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let frame: number | undefined;
    const markPresented = () => {
      if (stopped || !video.isConnected || presentationRef.current.key !== videoPresentationKey
        || video.getAttribute("src") !== mediaUrl || video.currentSrc !== video.src) return false;
      presentedVideoUrl.current = mediaUrl;
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

  const fitDuration = useCallback((video: HTMLVideoElement) => {
    // Allow a small decode-to-speech onset margin without changing narration.
    video.playbackRate = (resolvedMuted || video.preservesPitch === true) && sceneDuration && Number.isFinite(video.duration) && video.duration > 0
      ? Math.max(.75, Math.min(1, video.duration / (sceneDuration + .2))) : 1;
  }, [resolvedMuted, sceneDuration]);
  useEffect(() => {
    if (videoRef.current) fitDuration(videoRef.current);
  }, [fitDuration]);
  const continueMotion = (video: HTMLVideoElement) => {
    if (!isPlaying) return;
    // The finite scene clock bounds silent coverage. Speech may outlast a
    // short clip; repeat motion until the scene ends, never audible dialogue.
    if (!resolvedMuted) {
      unavailable();
      return;
    }
    video.currentTime = 0;
    void video.play().catch(() => unavailable());
  };

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
    if (video) video.volume = resolvedVolume;
  }, [resolvedVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying) {
      video.pause();
      if (rewindPreroll && video.currentTime > 0) video.currentTime = 0;
      return;
    }
    if (startedPlaybackId.current === playbackId) {
      if (video.ended) continueMotion(video);
      else void video.play().catch(() => unavailable());
      return;
    }
    const changingSource = startedVideoUrl.current !== undefined && startedVideoUrl.current !== mediaUrl;
    fitDuration(video);
    if (!changingSource && video.currentTime > 0) video.currentTime = 0;
    video.play().catch(() => unavailable());
    startedVideoUrl.current = mediaUrl;
    startedPlaybackId.current = playbackId;
  }, [isPlaying, mediaUrl, playbackId, rewindPreroll]);

  const mediaStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: resolvedPosition,
    transform: bgTransform.transform,
    transformOrigin: bgTransform.transformOrigin,
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
        onEnded={event => continueMotion(event.currentTarget)}
        onWaiting={() => { if (isPlaying) setWaitingKey(videoPresentationKey); }}
        onError={onError}
        data-media-position={mediaPosition}
        data-video-backdrop="scene"
        style={{ ...mediaStyle, visibility: exhaustedKey === videoPresentationKey ? "hidden" : undefined }}
      />
    </>
  );
};
