import { MountedSceneReadiness, sceneReadinessKey, type MountedVideoProof } from "./mounted-scene-readiness.js";
import {
  createElement,
  Component,
  type ReactNode,
  Suspense,
  useState,
  useRef,
  useCallback,
  useEffect,
  type CSSProperties,
  type ReactElement,
} from "react";
import type { Video, VideoScene } from "../protocol/types.js";
import { getDimensions } from "../visual-system/layout.js";
import { getBuiltinSceneRenderer } from "../visual-system/catalog/builtin-player.js";
import { resolveVideoTimeline, type VideoSceneRange } from "../protocol/timeline.js";
import {
  resolveMediaType,
} from "../visual-system/scene-templates/media-source.js";
import { ExternalVideoBackdropProvider, type MediaRecoveryReason } from "../visual-system/scene-templates/external-video-backdrop.js";

function PresentedScene({ notify }: { notify?: () => unknown }): null {
  useEffect(() => {
    if (!notify) return;
    const frame = requestAnimationFrame(() => {
      try { void Promise.resolve(notify()).catch(() => undefined); }
      catch { /* Observers cannot affect scene rendering. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [notify]);
  return null;
}

function SafeScene({ scene, onFramePresented }: { scene: VideoScene; onFramePresented?: () => unknown }): ReactElement {
  const copy = scene.narration?.trim() || Object.values(scene.variables)
    .filter((value): value is string => typeof value === "string" && !/^https?:/i.test(value))
    .join(" ");
  return <div
    data-scene-fallback="true"
    style={{
      width: "100%", height: "100%", display: "grid", placeContent: "center",
      boxSizing: "border-box", padding: "8%", background: "#090712", color: "#fff",
      font: "500 clamp(20px, 4vw, 64px)/1.3 system-ui", overflow: "hidden",
    }}
  >
    <MountedSceneReadiness scene={scene} playing fallback />
    <PresentedScene notify={onFramePresented} />
    <p>{copy.slice(0, 600) || "Your response continues."}</p>
    <small style={{ fontSize: "0.3em" }} role="status">This scene uses a simpler layout.</small>
  </div>;
}

class SceneBoundary extends Component<
  { scene: VideoScene; children: ReactNode; onFramePresented?: () => unknown },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <SafeScene scene={this.props.scene} onFramePresented={this.props.onFramePresented} /> : this.props.children;
  }
}

const CONTIGUITY_ULP_FACTOR = 4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rangesAreContiguous(left: VideoSceneRange, right: VideoSceneRange): boolean {
  const scale = Math.max(1, Math.abs(left.end), Math.abs(right.start));
  const ulpTolerance = Number.EPSILON * scale * CONTIGUITY_ULP_FACTOR;
  return Math.abs(left.end - right.start) <= ulpTolerance;
}

/** True when the scene paints a photo or video rather than black. */
function sceneHasBackdrop(range: VideoSceneRange): boolean {
  return String(range.scene.variables.mediaType || "auto") !== "gradient" &&
    String(range.scene.variables.mediaUrl || "").trim() !== "";
}

function sceneHasVideoBackdrop(range: VideoSceneRange): boolean {
  const mediaUrl = String(range.scene.variables.mediaUrl || "").trim();
  return mediaUrl !== "" && resolveMediaType(
    String(range.scene.variables.mediaType || "auto"),
    mediaUrl,
  ) === "video";
}

export interface VideoFrameProps {
  onFramePresented?: () => unknown;
  config: Video;
  time: number;
  width: number;
  height: number;
  playing?: boolean;
  preparingNarration?: boolean;
  narrationActive?: (scene: VideoScene) => boolean;
  mediaAudioMuted?: boolean;
  mediaAudioVolume?: number;
  mediaAudioAmbientOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface SceneLayerProps {
  onFramePresented?: () => unknown;
  onMediaError?: (reason?: MediaRecoveryReason) => void;
  range: VideoSceneRange;
  progress: number;
  motionProgress: number;
  width: number;
  height: number;
  playing: boolean;
  preparingNarration: boolean;
  narrationActive?: (scene: VideoScene) => boolean;
  mediaAudioMuted: boolean;
  mediaAudioVolume: number;
  layer: "active" | "incoming";
  opacity: number;
  interactive: boolean;
  zIndex: number;
  externalVideoBackdrop: false | "pending" | "ready" | "fallback";
}

function SceneLayer({
  onFramePresented,
  onMediaError,
  range,
  progress,
  motionProgress,
  width,
  height,
  playing,
  preparingNarration,
  narrationActive,
  mediaAudioMuted,
  mediaAudioVolume,
  layer,
  opacity,
  interactive,
  zIndex,
  externalVideoBackdrop,
}: SceneLayerProps): ReactElement {
  const mediaFailed = externalVideoBackdrop === "fallback"
    || (range.scene.templateId === "cinemaMedia" && !String(range.scene.variables.mediaUrl || "").trim());
  const recoveryTitle = mediaFailed && range.scene.templateId === "cinemaMedia"
    ? (typeof range.scene.variables.fallbackText === "string" && range.scene.variables.fallbackText.trim()) || "Your response continues." : undefined;
  const template = getBuiltinSceneRenderer(recoveryTitle ? "chapterTitle" : range.scene.templateId);
  const duration = range.end - range.start;
  const readNarration = useCallback(() => layer === "active" && narrationActive?.(range.scene) === true, [layer, narrationActive, range.scene]);

  return (
    <ExternalVideoBackdropProvider
      mode={externalVideoBackdrop}
      audioMuted={mediaAudioMuted || !playing}
      audioVolume={mediaAudioVolume}
      preparingNarration={preparingNarration}
      narrationActive={narrationActive && range.scene.narration?.trim() ? readNarration : undefined}
      onMediaError={onMediaError}
    >
      <div
        data-scene-layer={layer}
        data-scene-fallback={mediaFailed ? "true" : undefined}
        data-layer-scene-id={range.scene.id}
        data-layer-template-id={range.scene.templateId}
        aria-hidden={interactive ? undefined : true}
        {...(interactive
          ? {}
          // React 18 requires the string form at runtime; React 19 types the
          // now-standard HTML attribute as boolean.
          : { inert: "inert" as unknown as boolean })}
        style={{
          position: "absolute",
          inset: 0,
          opacity,
          zIndex,
          pointerEvents: interactive ? "auto" : "none",
        }}
      >
        {range.scene.templateId === "cinemaMedia" && !recoveryTitle && (mediaFailed || !String(range.scene.variables.mediaUrl || "").trim()) && <div
          role="status" data-media-unavailable="true"
          style={{ position: "absolute", inset: 0, zIndex: 2, display: "grid", placeContent: "center", color: "#bbb", font: "14px system-ui", background: "#000" }}
        >Visual unavailable</div>}
        {template ? (
          <SceneBoundary key={range.scene.id} scene={range.scene} onFramePresented={onFramePresented}>
            <Suspense fallback={
              <div
                data-template-loading={range.scene.templateId}
                style={{ position: "absolute", inset: 0 }}
              />
            }>
              <PresentedScene notify={onFramePresented} />
              {createElement(template.component, {
                variables: {
                  ...template.defaults,
                  ...range.scene.variables,
                  ...(mediaFailed ? { mediaUrl: "", mediaPoster: "", mediaType: "gradient" } : {}),
                  ...(recoveryTitle ? { title: recoveryTitle } : {}),
                },
                progress,
                motionProgress,
                width,
                height,
                sceneDuration: duration,
                isPlaying: playing,
              })}
            </Suspense>
          </SceneBoundary>
        ) : (
          <SafeScene scene={range.scene} onFramePresented={onFramePresented} />
        )}
      </div>
    </ExternalVideoBackdropProvider>
  );
}

export function VideoFrame({
  onFramePresented,
  config,
  time,
  width,
  height,
  playing = false,
  preparingNarration = false,
  narrationActive,
  mediaAudioMuted = true,
  mediaAudioVolume = 1,
  mediaAudioAmbientOnly = false,
  className,
  style,
}: VideoFrameProps): ReactElement {
  const recoveryRoot = useRef<HTMLDivElement>(null);
  const displayedKey = useRef<string | undefined>(undefined);
  const displayedWasPlaying = useRef(false);
  const handoffProof = useRef<MountedVideoProof | undefined>(undefined);
  const confirmedHandoff = useRef<string | undefined>(undefined);
  const [preparedMedia, setPreparedMedia] = useState<ReadonlySet<string>>(() => new Set());
  // Reconfirmation must render even when a previously ready source lost data.
  const markPrepared = useCallback((key: string) => setPreparedMedia(previous => new Set([...previous, key])), []);
  const reportedFailures = useRef(new Set<string>());
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(() => new Set());
  const markMediaFailed = useCallback((key: string | undefined, reason: MediaRecoveryReason = "playback-error") => {
    if (!key || !config.scenes.some(scene => sceneReadinessKey(scene) === key)) return;
    if (!reportedFailures.current.has(key)) {
      reportedFailures.current.add(key);
      // Internal development signal: never include scene IDs, URLs or copy.
      recoveryRoot.current?.dispatchEvent(new CustomEvent("vanillasky:media-recovery", { bubbles: true, detail: { reason: ["decode-error", "frame-readiness-timeout", "stalled-media", "playback-error", "duration-mismatch"].includes(reason) ? reason : "playback-error" } }));
    }
    setFailedMedia(previous => previous.has(key) ? previous : new Set([...previous, key]));
  }, [config.scenes]);
  useEffect(() => {
    const currentKeys = new Set(config.scenes.map(sceneReadinessKey));
    setPreparedMedia(previous => {
      const retained = new Set([...previous].filter(key => currentKeys.has(key)));
      return retained.size === previous.size ? previous : retained;
    });
    for (const key of reportedFailures.current) if (!currentKeys.has(key)) reportedFailures.current.delete(key);
    setFailedMedia(previous => {
      const retained = new Set([...previous].filter(key => currentKeys.has(key)));
      return retained.size === previous.size ? previous : retained;
    });
  }, [config.scenes]);
  const timeline = resolveVideoTimeline(config);
  const lastRange = timeline.at(-1);
  const foundIndex = timeline.findIndex((range) => time >= range.start && time < range.end);
  const afterEnd = lastRange && time >= lastRange.end;
  const targetIndex = foundIndex >= 0 ? foundIndex : afterEnd ? timeline.length - 1 : -1;
  const target = timeline[targetIndex];
  const targetKey = target ? sceneReadinessKey(target.scene) : undefined;
  if (confirmedHandoff.current !== targetKey || !(playing || preparingNarration)) {
    confirmedHandoff.current = undefined;
    handoffProof.current = undefined;
  }
  const previousIndex = timeline.findIndex(range => sceneReadinessKey(range.scene) === displayedKey.current);
  const previous = timeline[previousIndex];
  const audioMutedFor = (range: VideoSceneRange) => mediaAudioMuted || (mediaAudioAmbientOnly && range.scene.variables.mediaAudio !== "ambient");
  const canPrepare = (range: VideoSceneRange | undefined) => Boolean(range && (audioMutedFor(range) || !sceneHasVideoBackdrop(range))
    && sceneHasBackdrop(range) && range.scene.templateId === "cinemaMedia");
  const canRetain = (range: VideoSceneRange | undefined) => canPrepare(range) || range?.scene.templateId === "chapterTitle";
  const hasPlayableMedia = (range: VideoSceneRange | undefined) => {
    if (!range || !preparedMedia.has(sceneReadinessKey(range.scene))) return false;
    const layer = [...(recoveryRoot.current?.querySelectorAll('[data-layer-scene-id]') ?? [])].find(node => node.getAttribute('data-layer-scene-id') === range.scene.id);
    if (!sceneHasVideoBackdrop(range)) {
      const image = [...(layer?.querySelectorAll('img') ?? [])].find(element => element.getAttribute('src') === range.scene.variables.mediaUrl);
      return Boolean(image && image.getAttribute('src') === range.scene.variables.mediaUrl
        && image.complete && image.naturalWidth > 0);
    }
    const video = layer?.querySelector('video');
    return Boolean(video && video.getAttribute('src') === range.scene.variables.mediaUrl
      && video.currentSrc === video.src && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
  };
  // The visual clock waits at the new range's start while its decoder warms.
  // Keep the committed outgoing surface until that target can actually play.
  const handoffPending = Boolean(displayedWasPlaying.current && target && previous && targetIndex === previousIndex + 1
    && time <= target.start + .001 && rangesAreContiguous(previous, target)
    && canRetain(previous) && canPrepare(target)
    && !failedMedia.has(sceneReadinessKey(target.scene)) && !hasPlayableMedia(target)
    && confirmedHandoff.current !== targetKey);
  const activeIndex = handoffPending ? previousIndex : targetIndex;
  const active = timeline[activeIndex];
  const displayKey = active ? sceneReadinessKey(active.scene) : undefined;
  displayedWasPlaying.current = (displayedKey.current === displayKey && displayedWasPlaying.current) || playing || preparingNarration;
  displayedKey.current = displayKey;

  if (!active) {
    return (
      <div
        data-video-frame={timeline.length === 0 ? "empty" : "gap"}
        className={className}
        style={{ width, height, background: "#000", ...style }}
      />
    );
  }

  if (!getBuiltinSceneRenderer(active.scene.templateId)) {
    return (
      <div
        data-video-frame="unsupported"
        data-template-id={active.scene.templateId}
        className={className}
        style={{ width, height, background: "#090712", color: "#fff", ...style }}
      >
        <SafeScene scene={active.scene} onFramePresented={onFramePresented} />
      </div>
    );
  }

  const duration = active.end - active.start;
  const rawProgress = clamp01((time - active.start) / duration);
  const next = activeIndex < timeline.length - 1 ? timeline[activeIndex + 1] : undefined;
  const contiguousNext = next && rangesAreContiguous(active, next) ? next : undefined;

  // All browsers use the same bounded active-and-next decoder window.
  const activeMediaFailed = failedMedia.has(sceneReadinessKey(active.scene));
  const preparingNext = canRetain(active) && canPrepare(contiguousNext);
  const nextPlayable = hasPlayableMedia(contiguousNext);
  const mountingNext = handoffPending || Boolean(contiguousNext && time < active.end && sceneHasBackdrop(contiguousNext));
  const progress = rawProgress;
  // Body scenes own their complete 0→1 motion lifecycle so they can exit into
  // the next beat. A terminal scene has nowhere to exit to: once it reaches
  // its authored poster pose, hold that pose through the end instead of
  // fading out and then snapping back when playback stops. Raw progress still
  // reaches 1 so semantic values and background playback finish normally.
  const isFinalScene = activeIndex === timeline.length - 1;
  const presentsChapter = active.scene.templateId === "chapterTitle"
    || (active.scene.templateId === "cinemaMedia"
      && (activeMediaFailed || !String(active.scene.variables.mediaUrl || "").trim()));
  // Recovery uses the chapter's presentation even when the planned template
  // was footage. Keep its final readable pose through completion.
  const finalHold = presentsChapter ? .76 : undefined;
  const holdChapter = presentsChapter && preparingNext && !nextPlayable;
  const motionProgress = (isFinalScene || holdChapter) && finalHold !== undefined
    ? Math.min(rawProgress, finalHold)
    : rawProgress;
  const canvas = getDimensions(config.orientation);
  const scale = Math.min(width / canvas.width, height / canvas.height);
  const canvasLeft = (width - canvas.width * scale) / 2;
  const canvasTop = (height - canvas.height * scale) / 2;

  return (
    <div
      ref={recoveryRoot}
      onErrorCapture={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement || target instanceof HTMLImageElement)) return;
        const ownerId = target.closest("[data-layer-scene-id]")?.getAttribute("data-layer-scene-id");
        const owner = [active, contiguousNext].find(range => range?.scene.id === ownerId);
        if (owner?.scene.templateId === "cinemaMedia"
          && target.getAttribute("src") === owner.scene.variables.mediaUrl) {
          markMediaFailed(sceneReadinessKey(owner.scene), "decode-error");
        }
      }}
      data-video-frame="ready"
      data-scene-id={active.scene.id}
      data-template-id={active.scene.templateId}
      className={className}
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: "#000",
        ...style,
      }}
    >
      <MountedSceneReadiness scene={active.scene} playing={playing && !handoffPending}
        fallback={activeMediaFailed}
        preparedProof={confirmedHandoff.current === sceneReadinessKey(active.scene) ? handoffProof.current : undefined}
        onFailure={sceneHasBackdrop(active) && active.scene.templateId === "cinemaMedia" && !activeMediaFailed
          ? () => markMediaFailed(sceneReadinessKey(active.scene), "frame-readiness-timeout") : undefined} />
      {mountingNext && contiguousNext && preparingNext && <MountedSceneReadiness
        scene={contiguousNext.scene} playing={playing || preparingNarration} observeIncoming
        timeoutMs={handoffPending ? 8000 : null}
        onReady={proof => {
          const key = sceneReadinessKey(contiguousNext.scene);
          // Fresh target proof may be sustained motion at readyState two.
          // Do not veto it with the earlier cached future-data snapshot.
          if (handoffPending) { confirmedHandoff.current = key; handoffProof.current = proof; }
          markPrepared(key);
        }}
        onFailure={() => markMediaFailed(sceneReadinessKey(contiguousNext.scene), "frame-readiness-timeout")}
      />}
      <div
        data-video-canvas="true"
        style={{
          position: "absolute",
          left: canvasLeft,
          top: canvasTop,
          width: canvas.width,
          height: canvas.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div
          data-player-background="black"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            backgroundColor: "#000",
            pointerEvents: "none",
          }}
        />
        {(
          mountingNext && contiguousNext
            ? [
            <SceneLayer
              key={active.scene.id}
              onFramePresented={onFramePresented}
              range={active}
              onMediaError={reason => markMediaFailed(sceneReadinessKey(active.scene), reason)}
              progress={progress}
              motionProgress={motionProgress}
              width={canvas.width}
              height={canvas.height}
              playing={handoffPending ? playing || preparingNarration : playing}
              preparingNarration={handoffPending ? false : preparingNarration}
              narrationActive={narrationActive}
              mediaAudioMuted={audioMutedFor(active)}
              mediaAudioVolume={mediaAudioVolume}
              layer="active"
              opacity={1}
              interactive
              zIndex={1}
              externalVideoBackdrop={activeMediaFailed ? "fallback" : false}
            />,
            <SceneLayer
              key={contiguousNext.scene.id}
              range={contiguousNext}
              progress={0}
              motionProgress={0}
              width={canvas.width}
              height={canvas.height}
              playing={Boolean(preparingNext && (!preparedMedia.has(sceneReadinessKey(contiguousNext.scene)) || handoffPending) && (playing || preparingNarration))}
              preparingNarration={preparingNext}
              narrationActive={narrationActive}
              mediaAudioMuted={true}
              mediaAudioVolume={mediaAudioVolume}
              layer="incoming"
              opacity={0}
              interactive={false}
              zIndex={2}
              onMediaError={reason => markMediaFailed(sceneReadinessKey(contiguousNext.scene), reason)}
              externalVideoBackdrop={failedMedia.has(sceneReadinessKey(contiguousNext.scene)) ? "fallback" : false}
            />,
          ]
            : [
          <SceneLayer
            key={active.scene.id}
            onFramePresented={onFramePresented}
            range={active}
            onMediaError={reason => markMediaFailed(sceneReadinessKey(active.scene), reason)}
            progress={progress}
            motionProgress={motionProgress}
            width={canvas.width}
            height={canvas.height}
            playing={playing}
            preparingNarration={preparingNarration}
            narrationActive={narrationActive}
            mediaAudioMuted={audioMutedFor(active)}
            mediaAudioVolume={mediaAudioVolume}
            layer="active"
            opacity={1}
            interactive
            zIndex={1}
            externalVideoBackdrop={activeMediaFailed ? "fallback" : false}
          />,
        ])}
      </div>
    </div>
  );
}
