import React, { useCallback, useEffect, useRef, useState } from "react";
import { getBackgroundTransform } from "../backgrounds";
import { useMediaAudio, useMediaFailure, useNarrationPreroll } from "./external-video-backdrop";
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
  retainPoster?: boolean;
  persistent?: boolean;
  preparedPoster?: {
    presentationKey: string;
    mediaPoster: string;
    mediaPosition: string;
    backgroundEffect?: string;
    /** Existing global transition progress. On decoder-constrained Safari,
     * this fades the decoded incoming still above the outgoing video before
     * the single video element changes source. */
    opacity?: number;
  };
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
  retainPoster = false,
  persistent = false,
  preparedPoster,
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
  const startedVideoUrl = useRef<string | undefined>(undefined);
  const startedPlaybackId = useRef<string | undefined>(undefined);
  const videoPresentationKey = `${playbackId}\0${mediaUrl}`;

  const presentationRef = useRef({ key: videoPresentationKey, playing: isPlaying });
  presentationRef.current = { key: videoPresentationKey, playing: isPlaying };
  const unavailable = () => {
    if (presentationRef.current.key === videoPresentationKey && presentationRef.current.playing) {
      setExhaustedKey(videoPresentationKey);
      onError?.();
      reportMediaFailure?.();
    }
  };
  useEffect(() => {
    if (!isPlaying || waitingKey !== videoPresentationKey) {
      if (waitingKey) setWaitingKey(undefined);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const initialTime = video.currentTime;
    let stopped = false;
    let frame: number | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const observe = () => {
      if (stopped) return;
      if (Math.abs(video.currentTime - initialTime) > .001) {
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
    const deadline = setTimeout(() => {
      if (!stopped) { stopped = true; unavailable(); }
    }, 1000);
    observe();
    return () => {
      stopped = true;
      clearTimeout(deadline);
      clearTimeout(poll);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    };
  }, [waitingKey, videoPresentationKey, isPlaying]);

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
    void video.play().catch(unavailable);
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
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      startedVideoUrl.current = undefined;
      startedPlaybackId.current = undefined;
    };
  }, [mediaUrl]);

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
      else void video.play().catch(unavailable);
      return;
    }
    const changingSource = startedVideoUrl.current !== undefined && startedVideoUrl.current !== mediaUrl;
    fitDuration(video);
    if (!changingSource && video.currentTime > 0) video.currentTime = 0;
    video.play().catch(unavailable);
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
    zIndex: persistent ? 1 : undefined,
  };
  const preparedPosition = preparedPoster
    ? resolveMediaPosition(preparedPoster.mediaPosition)
    : resolvedPosition;
  const preparedTransform = getBackgroundTransform(preparedPoster?.backgroundEffect, 0, 0);
  const posterPlanes = [
    ...(persistent && mediaPoster ? [{
      presentationKey: videoPresentationKey,
      mediaPoster,
      mediaPosition: resolvedPosition,
      transform: bgTransform.transform,
      transformOrigin: bgTransform.transformOrigin,
      opacity: 1,
      zIndex: 0,
      role: "current",
    }] : []),
    ...(preparedPoster && preparedPoster.presentationKey !== videoPresentationKey ? [{
      presentationKey: preparedPoster.presentationKey,
      mediaPoster: preparedPoster.mediaPoster,
      mediaPosition: preparedPosition,
      transform: preparedTransform.transform,
      transformOrigin: preparedTransform.transformOrigin,
      opacity: preparedPoster.opacity ?? 0,
      zIndex: 2,
      role: "prepared",
    }] : []),
  ];

  return (
    <>
      {posterPlanes.map((posterPlane) => (
        <img
          key={posterPlane.presentationKey}
          src={posterPlane.mediaPoster}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-video-poster-plane={posterPlane.role}
          data-video-poster-visible={posterPlane.opacity > 0 ? "true" : "false"}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: posterPlane.mediaPosition,
            transform: posterPlane.transform,
            transformOrigin: posterPlane.transformOrigin,
            zIndex: posterPlane.zIndex,
            opacity: posterPlane.opacity,
            pointerEvents: "none",
          }}
        />
      ))}
      {exhaustedKey === videoPresentationKey && <div
        role="status" data-media-continuity="exhausted"
        style={{ position: "absolute", inset: 0, zIndex: 3, background: "#000", color: "#bbb", display: "grid", placeContent: "center", font: "14px system-ui" }}
      >Visual unavailable</div>}
      <video
        ref={videoRef}
        src={mediaUrl}
        poster={retainPoster || decodedVideoUrl !== mediaUrl ? mediaPoster || undefined : undefined}
        muted={resolvedMuted}
        loop={false}
        playsInline
        preload="auto"
        onLoadedMetadata={event => fitDuration(event.currentTarget)}
        onEnded={event => continueMotion(event.currentTarget)}
        onWaiting={() => { if (isPlaying) setWaitingKey(videoPresentationKey); }}
        onPlaying={() => setWaitingKey(undefined)}
        onLoadedData={(event) => {
          const video = event.currentTarget;
          const markPresented = () => {
            if (!video.isConnected) return;
            onReady?.();
            if (!retainPoster) setDecodedVideoUrl(mediaUrl);
          };
          if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(markPresented);
            return;
          }
          markPresented();
        }}
        onError={onError}
        data-media-position={mediaPosition}
        data-video-backdrop={persistent ? "persistent" : "scene"}
        style={{ ...mediaStyle, visibility: exhaustedKey === videoPresentationKey ? "hidden" : undefined }}
      />
    </>
  );
};
