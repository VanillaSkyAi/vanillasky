import React, { useEffect, useRef, useState } from "react";
import { getBackgroundTransform } from "../backgrounds";
import { useMediaAudio } from "./external-video-backdrop";
import { resolveMediaPosition } from "./media-position";

export interface SceneVideoBackdropProps {
  mediaUrl: string;
  mediaPoster?: string;
  mediaPosition?: string;
  backgroundEffect?: string;
  progress: number;
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
  const resolvedMuted = muted ?? inheritedAudio.muted;
  const resolvedVolume = volume ?? inheritedAudio.volume;
  const resolvedPosition = resolveMediaPosition(mediaPosition);
  const bgTransform = getBackgroundTransform(backgroundEffect, progress, beatIntensity);
  const [decodedVideoUrl, setDecodedVideoUrl] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedVideoUrl = useRef<string | undefined>(undefined);
  const startedPlaybackId = useRef<string | undefined>(undefined);
  const videoPresentationKey = `${playbackId}\0${mediaUrl}`;

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
      return;
    }
    if (startedPlaybackId.current === playbackId) {
      if (!video.ended) void video.play().catch(() => {});
      return;
    }
    const changingSource = startedVideoUrl.current !== undefined && startedVideoUrl.current !== mediaUrl;
    video.playbackRate = 1;
    if (!changingSource && video.currentTime > 0) video.currentTime = 0;
    video.play().catch(() => {});
    startedVideoUrl.current = mediaUrl;
    startedPlaybackId.current = playbackId;
  }, [isPlaying, mediaUrl, playbackId]);

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
      <video
        ref={videoRef}
        src={mediaUrl}
        poster={retainPoster || decodedVideoUrl !== mediaUrl ? mediaPoster || undefined : undefined}
        muted={resolvedMuted}
        loop={false}
        playsInline
        preload="auto"
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
        style={mediaStyle}
      />
    </>
  );
};
