import { MountedReadinessContext } from "./mounted-scene-readiness.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { VideoEvent } from "../protocol/events.js";
import type { Video } from "../protocol/types.js";
import {
  applyVideoEvent,
  createVideoState,
  type VideoState,
} from "../protocol/state.js";
import { getDimensions } from "../visual-system/layout.js";
import { VideoFrame } from "./video-frame.js";
import { getVideoDuration, resolveVideoTimeline } from "../protocol/timeline.js";
import { parseVideo } from "../protocol/persistence.js";
import { overlayPlayerTemplateRegistry } from "../visual-system/catalog/player-kit.js";
import { BUILTIN_PLAYER_KIT, preloadBuiltinTemplate } from "../visual-system/catalog/builtin-player.js";
import { warmSceneMedia } from "./warm-scene-media.js";
import { resolvePlaybackPolicy } from "./playback-policy.js";
import {
  EndedOverlay,
  GenerationCover,
  PlayerControls,
  StartPosterButton,
} from "./player-controls.js";
import { usePlaybackClock } from "./use-playback-clock.js";
import type { VideoPlayerProps, VideoPlayerRuntimeProps } from "./video-player-types.js";

export type { VideoPlaybackMode } from "./playback-policy.js";
export type { VideoPlayerProps } from "./video-player-types.js";

const MINIMUM_GENERATION_INTRO_MS = 3_000;

function savedVideoState(video: Video): VideoState {
  return {
    ...createVideoState(),
    status: "complete",
    config: video,
  };
}

type FullscreenMode = "none" | "native" | "fallback";

export function VideoPlayerRuntime({
  kit,
  stream,
  video,
  playbackMode,
  autoPlay = true,
  startMuted = true,
  nativeMediaAudio,
  width,
  orientation: orientationOverride,
  responsiveBreakpoint = 520,
  className,
  style,
  ariaLabel = "Video response",
  controls = true,
  paused,
  loop = false,
  onPlaybackEnd,
  onComplete,
  onError,
  onSceneChange,
  onFramePresented,
  onStallChange,
  onStateChange,
}: VideoPlayerRuntimeProps): ReactElement {
  const nativeMediaVolume = Math.max(0, Math.min(1,
    typeof nativeMediaAudio?.volume === "number" && Number.isFinite(nativeMediaAudio.volume)
      ? nativeMediaAudio.volume
      : 1,
  ));
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const { resolvedStartMuted, shouldAutoPlay, autoStartGeneration } = resolvePlaybackPolicy({
    playbackMode,
    autoPlay,
    startMuted,
    audioUnlocked,
    reducedMotion,
    hasStream: Boolean(stream),
  });
  const [isPlaying, setIsPlaying] = useState(() => shouldAutoPlay && !reducedMotion && !autoStartGeneration);
  const [isMuted, setIsMuted] = useState(resolvedStartMuted);
  const [fullscreenMode, setFullscreenMode] = useState<FullscreenMode>("none");
  const [state, setState] = useState<VideoState>(() => video ? savedVideoState(video) : createVideoState());
  const [currentTime, setCurrentTime] = useState(0);
  const [activeStream, setActiveStream] = useState(stream);
  const [activeSavedVideo, setActiveSavedVideo] = useState(video);
  const [replacementPending, setReplacementPending] = useState(false);
  const [startRequested, setStartRequested] = useState(autoStartGeneration);
  const [introPlaying, setIntroPlaying] = useState(autoStartGeneration);
  const [generationIntroComplete, setGenerationIntroComplete] = useState(() => !playbackMode || !stream);
  const [observedWidth, setObservedWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const timeRef = useRef(currentTime);
  const audioRef = useRef<HTMLAudioElement>(null);
  const introStartedAtRef = useRef<number | null>(autoStartGeneration ? performance.now() : null);
  const callbacksRef = useRef({ onComplete, onPlaybackEnd, onError, onSceneChange, onFramePresented, onStallChange, onStateChange });
  const loopRef = useRef(loop);
  const sceneIndexRef = useRef(-1);
  const visualReadyRef = useRef<string | undefined>(undefined);
  const reportVisualReady = useMemo(() => (key: string, error?: Error) => {
    if (error) {
      setIsPlaying(false);
      callbacksRef.current.onError?.(error, stateRef.current);
    } else visualReadyRef.current = key;
  }, []);
  const playbackEndedRef = useRef(false);

  stateRef.current = state;
  timeRef.current = currentTime;
  callbacksRef.current = { onComplete, onPlaybackEnd, onError, onSceneChange, onFramePresented, onStallChange, onStateChange };
  loopRef.current = loop;

  const reportFramePresented = useMemo(() => {
    let reported = false;
    return () => {
      if (reported) return;
      reported = true;
      try { void Promise.resolve(callbacksRef.current.onFramePresented?.()).catch(() => undefined); }
      catch { /* Observers cannot stop playback. */ }
    };
  }, [stream, video]);

  const primeSoundtrack = () => {
    const audio = audioRef.current;
    if (!audio || audio.dataset.audioOutput) return;
    const Context = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    // Resume inside the gesture that triggered this. iOS only unlocks audio
    // synchronously from a user gesture, and everything after the dynamic
    // import below runs too late to count as one.
    const unlocked = context.resume().catch(Boolean);
    void import("./control-visibility.js")
      .then(async (output) => {
        await unlocked;
        // Routing an element through a context that is not running silences
        // it outright: its audio stops going to the speakers and starts
        // going into a stalled graph. Playing directly is the safe answer —
        // the volume ramp is worth less than audible sound.
        if (context.state !== "running") {
          void context.close();
          return;
        }
        output.default(audio, context);
      })
      .catch(() => context.close());
  };

  if (stream !== activeStream || video !== activeSavedVideo) {
    const autoStartReplacement = Boolean(playbackMode && stream && shouldAutoPlay && !reducedMotion);
    setActiveStream(stream);
    setActiveSavedVideo(video);
    sceneIndexRef.current = -1;
    setReplacementPending(stream != null);
    setState(video ? savedVideoState(video) : createVideoState());
    setCurrentTime(0);
    setIsMuted(resolvedStartMuted);
    setIsPlaying(shouldAutoPlay && !reducedMotion && !autoStartReplacement);
    setStartRequested(autoStartReplacement);
    setIntroPlaying(autoStartReplacement);
    setGenerationIntroComplete(!playbackMode || !stream);
    introStartedAtRef.current = autoStartReplacement ? performance.now() : null;
  }

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
      if (event.matches) {
        introStartedAtRef.current = null;
        setStartRequested(false);
        setIntroPlaying(false);
        setIsPlaying(false);
      }
    };
    preference.addEventListener?.("change", handleChange);
    return () => preference.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    import("./control-visibility.js");
  }, []);

  useEffect(() => setIsMuted(resolvedStartMuted), [resolvedStartMuted]);

  /**
   * The host's hand on the clock.
   *
   * Only a change acts, so a host that passes `paused={false}` alongside
   * `autoPlay={false}` is not contradicted into playing on mount. The clock
   * holds `timeRef` while it is stopped and restarts from `performance.now()`,
   * so resuming continues rather than jumping.
   */
  const pausedRef = useRef(paused);
  useEffect(() => {
    const previous = pausedRef.current;
    pausedRef.current = paused;
    if (paused === undefined || paused === previous) return;
    if (paused) {
      setIsPlaying(false);
      audioRef.current?.pause();
      return;
    }
    const config = stateRef.current.config;
    if (!config?.scenes.length) return;
    // A finished video has its playhead at the end already. Releasing it there
    // would hold a last frame and call it playback; starting over is a replay,
    // which the host does by remounting.
    if (timeRef.current >= getVideoDuration(config) - 0.001) return;
    setIsPlaying(true);
    const audio = audioRef.current;
    if (audio?.paused) void audio.play().catch(Boolean);
  }, [paused]);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const reset = video ? savedVideoState(video) : createVideoState();
    stateRef.current = reset;
    timeRef.current = 0;
    setState(reset);
    setCurrentTime(0);

    if (video) {
      for (const scene of video.scenes) {
        preloadBuiltinTemplate(scene.templateId);
        warmSceneMedia(scene.variables);
      }
      return;
    }
    if (!stream) return;

    const consume = async () => {
      try {
        for await (const event of stream) {
          if (cancelled) return;
          const current = stateRef.current;
          const next = applyVideoEvent(current, event);
          stateRef.current = next;
          setReplacementPending(false);
          setState(next);
          callbacksRef.current.onStateChange?.(next);
          if (next.status === "complete" && current.status !== "complete") {
            callbacksRef.current.onComplete?.(next);
          } else if (next.status === "error" && current.status !== "error") {
            callbacksRef.current.onError?.(new Error("Video response could not finish"), next);
          }
        }
      } catch {
        if (!cancelled) {
          callbacksRef.current.onError?.(new Error("Video playback stream failed"), stateRef.current);
        }
      }
    };

    queueMicrotask(() => {
      if (cancelled) return;
      started = true;
      void consume();
    });
    return () => {
      cancelled = true;
      if (started) {
        (stream as AsyncIterable<VideoEvent> & { cancel?: () => void }).cancel?.();
      }
    };
  }, [stream, video]);

  useEffect(() => {
    if (width != null) return;
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      setObservedWidth(container.clientWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [width]);

  usePlaybackClock({
    isPlaying,
    stateRef,
    timeRef,
    audioRef,
    loopRef,
    sceneIndexRef,
    visualReadyRef,
    callbacksRef,
    setCurrentTime,
    setIsPlaying,
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = state.config?.audio?.volume ?? 1;
  }, [state.config?.audio?.audioUrl, state.config?.audio?.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying || introPlaying) {
      void audio.play()
        .then(() => {
          if (!audio.muted) setAudioUnlocked(true);
        })
        .catch(() => {
          // Do not let visuals silently run ahead when a browser blocks audible
          // autoplay. Return to the poster so a visible play control can provide
          // the required user gesture and restart audio and motion together.
          audio.currentTime = 0;
          timeRef.current = 0;
          setCurrentTime(0);
          setStartRequested(false);
          setIntroPlaying(false);
          setIsPlaying(false);
        });
    } else {
      audio.pause();
    }
  }, [introPlaying, isPlaying, state.config?.audio?.audioUrl]);

  useEffect(() => {
    if (!state.config?.scenes.length) {
      const terminalWithoutVideo = state.status === "complete" || state.status === "error" || state.status === "aborted";
      if (terminalWithoutVideo) {
        audioRef.current?.pause();
        introStartedAtRef.current = null;
        setStartRequested(false);
        setIntroPlaying(false);
        setGenerationIntroComplete(true);
      }
      return;
    }
    if (!startRequested) return;

    if (state.config.scenes[0]?.id === "supplied-opening") {
      timeRef.current = 0;
      setCurrentTime(0);
      if (audioRef.current) audioRef.current.volume = state.config.audio?.volume ?? 1;
      introStartedAtRef.current = null;
      setStartRequested(false);
      setIntroPlaying(false);
      setGenerationIntroComplete(true);
      setIsPlaying(true);
      return;
    }

    const startedAt = introStartedAtRef.current ?? performance.now();
    introStartedAtRef.current = startedAt;
    const remaining = Math.max(0, MINIMUM_GENERATION_INTRO_MS - (performance.now() - startedAt));
    const startGeneratedVideo = () => {
      timeRef.current = 0;
      setCurrentTime(0);
      if (audioRef.current) audioRef.current.volume = state.config?.audio?.volume ?? 1;
      introStartedAtRef.current = null;
      setStartRequested(false);
      setIntroPlaying(false);
      setGenerationIntroComplete(true);
      setIsPlaying(true);
    };
    if (remaining <= 0) {
      startGeneratedVideo();
      return;
    }
    const timer = setTimeout(startGeneratedVideo, remaining);
    return () => clearTimeout(timer);
  }, [startRequested, state.config?.audio?.volume, state.config?.scenes.length, state.status]);

  const streamOrientation = state.config?.orientation ?? "portrait";
  const isFullscreen = fullscreenMode !== "none";
  const responsiveWidth = isFullscreen ? window.innerWidth : width ?? observedWidth;
  const orientation = orientationOverride === "auto"
    ? responsiveWidth > 0
      ? responsiveWidth <= responsiveBreakpoint ? "portrait" : "landscape"
      : streamOrientation
    : orientationOverride ?? streamOrientation;
  const dimensions = getDimensions(orientation);
  const displayWidth = (width ?? observedWidth) || dimensions.width;
  const displayHeight = displayWidth * dimensions.height / dimensions.width;
  const scale = displayWidth / dimensions.width;
  const config = state.config;
  const displayConfig = config && config.orientation !== orientation
    ? { ...config, orientation }
    : config;
  const duration = config ? getVideoDuration(config) : 0;
  const terminal = state.status === "complete" || state.status === "error" || state.status === "aborted";
  const playheadAtEnd = terminal && duration > 0 && currentTime >= duration - 0.001;
  const ended = !loop && playheadAtEnd;
  useEffect(() => {
    if (!playheadAtEnd) {
      playbackEndedRef.current = false;
      return;
    }
    if (loop || playbackEndedRef.current) return;
    playbackEndedRef.current = true;
    callbacksRef.current.onPlaybackEnd?.(stateRef.current);
  }, [loop, playheadAtEnd]);
  const generationIntroWaiting = Boolean(playbackMode && stream && !generationIntroComplete);
  const firstSceneRange = config ? resolveVideoTimeline(config)[0] : undefined;
  const hasSuppliedOpening = firstSceneRange?.scene.id === "supplied-opening";
  const showStartPoster = (!generationIntroWaiting || hasSuppliedOpening) && !startRequested && !isPlaying && !ended && currentTime <= 0.001 && Boolean(config?.scenes.length);
  const firstSceneHoldProgress = firstSceneRange
    ? kit.getTemplate(firstSceneRange.scene.templateId)?.transitionTiming?.holdProgress ?? 0.7
    : 0;
  const posterTime = firstSceneRange
    ? firstSceneRange.start + Math.max(0, firstSceneRange.end - firstSceneRange.start) * firstSceneHoldProgress
    : currentTime;
  const startPlayback = () => {
    setGenerationIntroComplete(true);
    containerRef.current?.setAttribute("data-touch-controls", "false");
    const audio = audioRef.current;
    if (audio) {
      void audio.play()
        .then(() => {
          if (!audio.muted) setAudioUnlocked(true);
        })
        .catch(() => {
          audio.currentTime = 0;
          timeRef.current = 0;
          setCurrentTime(0);
          setIsPlaying(false);
        });
    }
    setIsPlaying(true);
  };
  const armPlayback = () => {
    introStartedAtRef.current = performance.now();
    setStartRequested(true);
    setIntroPlaying(true);
    const audio = audioRef.current;
    if (!audio) return;

    const volume = stateRef.current.config?.audio?.volume ?? 1;
    audio.volume = volume;
    void audio.play()
      .then(() => {
        if (!audio.muted) setAudioUnlocked(true);
      })
      .catch(() => {
        audio.volume = volume;
        audio.currentTime = 0;
        timeRef.current = 0;
        setCurrentTime(0);
        introStartedAtRef.current = null;
        setStartRequested(false);
        setIntroPlaying(false);
        setIsPlaying(false);
      });
  };
  const togglePlayback = () => {
    if (startRequested) return;
    if (!stateRef.current.config?.scenes.length) {
      armPlayback();
      return;
    }
    if (!isPlaying && ended) {
      timeRef.current = 0;
      setCurrentTime(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
      startPlayback();
      return;
    }
    if (isPlaying) setIsPlaying(false);
    else startPlayback();
  };
  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    void import("./control-visibility.js").then((output) => output.togglePlayerFullscreen(container, setFullscreenMode));
  };
  const pendingReplacement = replacementPending && state.status === "idle";
  const displayedStatus = pendingReplacement ? "streaming" : state.status;
  const generationCoverVisible = (generationIntroWaiting && !hasSuppliedOpening) || (displayedStatus === "streaming" && !config?.scenes.length);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      onClickCapture={primeSoundtrack}
      onKeyDownCapture={primeSoundtrack}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) {
          event.preventDefault();
          togglePlayback();
        }
      }}
      data-testid="video-player"
      data-status={displayedStatus}
      data-finish-reason={state.finishReason}
      data-scenes={config?.scenes.length ?? 0}
      data-orientation={orientation}
      data-current-time={currentTime.toFixed(3)}
      data-playing={isPlaying || introPlaying}
      data-ended={ended}
      data-start-poster={showStartPoster}
      data-start-requested={startRequested}
      data-intro-playing={introPlaying}
      data-generation-intro-complete={generationIntroComplete}
      data-audio-unlocked={audioUnlocked}
      data-playback-mode={playbackMode ?? "custom"}
      data-fullscreen={fullscreenMode}
      className={className}
      style={{
        width: width ?? "100%",
        height: displayHeight,
        position: "relative",
        overflow: "hidden",
        background: "#090712",
        ...style,
      }}
    >
      <GenerationCover
        visible={generationCoverVisible}
        config={config}
        isMuted={isMuted}
        startRequested={startRequested}
        isPlaying={isPlaying}
        onStart={armPlayback}
      />
      {!generationCoverVisible && config?.scenes.length ? (
        <MountedReadinessContext.Provider value={reportVisualReady}>
          <VideoFrame
          kit={kit}
          onFramePresented={!showStartPoster && onFramePresented ? reportFramePresented : undefined}
          config={displayConfig!}
          time={showStartPoster ? posterTime : currentTime}
          width={dimensions.width}
          height={dimensions.height}
          playing={isPlaying}
          mediaAudioMuted={!nativeMediaAudio || isMuted}
          mediaAudioVolume={nativeMediaVolume}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
        </MountedReadinessContext.Provider>
      ) : null}
      <StartPosterButton
        visible={showStartPoster}
        config={config}
        isMuted={isMuted}
        onStart={startPlayback}
      />
      {config?.audio ? (
        <audio
          key={config.audio.audioUrl}
          ref={audioRef}
          src={config.audio.audioUrl}
          data-v={config.audio.volume}
          autoPlay={isPlaying}
          muted={isMuted}
          preload="auto"
          loop={loop || state.status === "streaming" || introPlaying}
        />
      ) : null}
      <EndedOverlay ended={controls && ended} onReplay={togglePlayback} />
      <PlayerControls
        visible={controls && !generationCoverVisible && !showStartPoster && Boolean(config?.scenes.length)}
        displayWidth={displayWidth}
        ended={ended}
        isPlaying={isPlaying}
        isMuted={isMuted}
        isFullscreen={isFullscreen}
        hasAudio={Boolean(config?.audio) || Boolean(nativeMediaAudio)}
        onTogglePlayback={togglePlayback}
        onToggleMuted={() => setIsMuted((muted) => {
          if (muted) setAudioUnlocked(true);
          return !muted;
        })}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}

export function VideoPlayer({
  templates,
  stream,
  video,
  onPlaybackEnd,
  onComplete,
  onError,
  ...props
}: VideoPlayerProps): ReactElement | null {
  const savedVideo = useMemo(() => video ? parseVideo(video) : undefined, [video]);
  const kit = useMemo(
    () => overlayPlayerTemplateRegistry(BUILTIN_PLAYER_KIT, templates),
    [templates],
  );
  if (!stream && !savedVideo) return null;
  return <VideoPlayerRuntime
    {...props}
    kit={kit}
    stream={stream}
    video={savedVideo}
    onPlaybackEnd={(state) => {
      if (state.config) onPlaybackEnd?.(state.config);
    }}
    onComplete={(state) => {
      if (state.config) onComplete?.(state.config);
    }}
    onError={(error) => onError?.(error)}
  />;
}
