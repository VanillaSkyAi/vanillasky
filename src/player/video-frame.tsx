import { MountedSceneReadiness, PreparedSceneReadiness, sceneReadinessKey } from "./mounted-scene-readiness.js";
import {
  createElement,
  Component,
  type ReactNode,
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from "react";
import type { Video, VideoScene } from "../protocol/types.js";
import { resolveDensity } from "../visual-system/scene-templates/tokens.js";
import {
  getDimensions,
  getSafeZone,
  scaleSafeZone,
} from "../visual-system/layout.js";
import type { PlayerTemplateRegistry } from "../visual-system/catalog/player-kit.js";
import { getTemplateDefaults } from "../visual-system/catalog/schema.js";
import { resolveVideoTimeline, type VideoSceneRange } from "../protocol/timeline.js";
import {
  limitsConcurrentVideoDecoders,
  resolveMediaType,
} from "../visual-system/scene-templates/media-source.js";
import { ExternalVideoBackdropProvider } from "../visual-system/scene-templates/external-video-backdrop.js";
import { supportsExternalVideoBackdrop } from "../visual-system/catalog/video-backdrop-capability.js";

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

const SCENE_TRANSITION_SECONDS = 0.3;
const SceneVideoBackdrop = lazy(() => import(
  "../visual-system/scene-templates/scene-video-backdrop.js"
).then((module) => ({ default: module.SceneVideoBackdrop })));
/**
 * How long before a cut the next scene is mounted when it carries its own
 * backdrop.
 *
 * The blend above is a design decision — 0.3s of cross-fade. Mounting was
 * accidentally the same number, which gave a <video> 300ms to attach a
 * source, read metadata, decode a frame and start playing. It cannot, so the
 * scene arrived as a bare gradient and popped to its picture a beat later.
 * Warming the bytes ahead of time never fixed that: cached bytes still have
 * to be decoded by an element that does not exist yet.
 *
 * Mounting early costs nothing visually — the layer stays at opacity 0 until
 * the blend starts, so every rendered frame is identical — and the mounted
 * element is keyed by scene id, so React hands the very same DOM node (and
 * its decoded video) to the active layer at the cut instead of building a
 * fresh one.
 */
const MEDIA_PREROLL_SECONDS = 1.2;
const CONTIGUITY_ULP_FACTOR = 4;

// Device identity cannot change during a page session. useSyncExternalStore
// gives React a deterministic desktop-safe server snapshot, then applies the
// real browser capability after hydration without rebuilding a mismatched
// tree. Client-only roots receive the browser value on their first render.
const subscribeToDecoderPolicy = () => () => {};

function useDecoderConstraint(): boolean {
  return useSyncExternalStore(
    subscribeToDecoderPolicy,
    limitsConcurrentVideoDecoders,
    () => false,
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function supportsContinuousTransition(value: string | undefined): value is "crossfade" | "fade" {
  return value === "crossfade" || value === "fade";
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

function registrySupportsExternalVideoBackdrop(kit: PlayerTemplateRegistry): boolean {
  return kit.templates.every((template) => {
    const properties = template.schema?.properties;
    if (!properties?.mediaUrl) return true;
    const mediaTypes = properties.mediaType?.enum;
    const canRenderVideo = mediaTypes == null || mediaTypes.includes("video") || mediaTypes.includes("auto");
    return !canRenderVideo || supportsExternalVideoBackdrop(template);
  });
}

function sceneBackgroundChanges(
  left: VideoSceneRange,
  right: VideoSceneRange,
): boolean {
  const mediaUrl = (range: VideoSceneRange) =>
    String(range.scene.variables.mediaType || "auto") === "gradient"
      ? ""
      : String(range.scene.variables.mediaUrl || "");
  return mediaUrl(left) !== mediaUrl(right);
}

export interface VideoFrameProps {
  onFramePresented?: () => unknown;
  kit: PlayerTemplateRegistry;
  config: Video;
  time: number;
  width: number;
  height: number;
  playing?: boolean;
  mediaAudioMuted?: boolean;
  mediaAudioVolume?: number;
  className?: string;
  style?: CSSProperties;
}

interface SceneLayerProps {
  onFramePresented?: () => unknown;
  kit: PlayerTemplateRegistry;
  config: Video;
  range: VideoSceneRange;
  progress: number;
  motionProgress: number;
  width: number;
  height: number;
  playing: boolean;
  mediaAudioMuted: boolean;
  mediaAudioVolume: number;
  layer: "active" | "outgoing" | "incoming";
  opacity: number;
  interactive: boolean;
  zIndex: number;
  externalVideoBackdrop: false | "pending" | "ready" | "fallback";
}

function SceneLayer({
  onFramePresented,
  kit,
  config,
  range,
  progress,
  motionProgress,
  width,
  height,
  playing,
  mediaAudioMuted,
  mediaAudioVolume,
  layer,
  opacity,
  interactive,
  zIndex,
  externalVideoBackdrop,
}: SceneLayerProps): ReactElement {
  const mediaFailed = externalVideoBackdrop === "fallback";
  const recoveryTitle = mediaFailed && range.scene.templateId === "cinemaMedia"
    && typeof range.scene.variables.fallbackText === "string" ? range.scene.variables.fallbackText : undefined;
  const template = kit.getTemplate(recoveryTitle ? "chapterTitle" : range.scene.templateId);
  const duration = range.end - range.start;

  return (
    <ExternalVideoBackdropProvider
      mode={externalVideoBackdrop}
      audioMuted={mediaAudioMuted || !playing}
      audioVolume={mediaAudioVolume}
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
          // A changed-media transition can expose an incoming template's true
          // initial frame. Values that would be false placeholders at progress
          // zero opt into this inherited guard.
          "--vanillasky-transition-semantic-visibility": layer === "incoming" ? "hidden" : "visible",
          "--vanillasky-template-surface": externalVideoBackdrop !== false ? "transparent" : undefined,
        } as CSSProperties}
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
                  ...(template.defaults ?? getTemplateDefaults(template.schema!)),
                  ...range.scene.variables,
                  ...(mediaFailed ? { mediaUrl: "", mediaPoster: "", mediaType: "gradient" } : {}),
                  ...(recoveryTitle ? { title: recoveryTitle } : {}),
                },
                style: config.style,
                progress,
                motionProgress,
                beatIntensity: 0,
                width,
                height,
                textArchetype: range.scene.textArchetype ?? config.style.defaultTextArchetype,
                backgroundEffect: range.scene.backgroundEffect ?? config.style.defaultBackgroundEffect,
                safeZone: scaleSafeZone(
                  getSafeZone(config.orientation),
                  resolveDensity(config.style.density).safeZoneScale,
                ),
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
  kit,
  config,
  time,
  width,
  height,
  playing = false,
  mediaAudioMuted = true,
  mediaAudioVolume = 1,
  className,
  style,
}: VideoFrameProps): ReactElement {
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(() => new Set());
  const markMediaFailed = useCallback((key: string | undefined) => {
    if (!key || !config.scenes.some(scene => sceneReadinessKey(scene) === key)) return;
    setFailedMedia(previous => previous.has(key) ? previous : new Set([...previous, key]));
  }, [config.scenes]);
  useEffect(() => {
    const currentKeys = new Set(config.scenes.map(sceneReadinessKey));
    setFailedMedia(previous => {
      const retained = new Set([...previous].filter(key => currentKeys.has(key)));
      return retained.size === previous.size ? previous : retained;
    });
  }, [config.scenes]);
  const [readyPersistentVideo, setReadyPersistentVideo] = useState<string>();
  const decoderConstrainedDevice = useDecoderConstraint();
  const timeline = resolveVideoTimeline(config);
  const lastRange = timeline.at(-1);
  const foundIndex = timeline.findIndex((range) => time >= range.start && time < range.end);
  const afterEnd = lastRange && time >= lastRange.end;
  const activeIndex = foundIndex >= 0 ? foundIndex : afterEnd ? timeline.length - 1 : -1;
  const active = activeIndex >= 0 ? timeline[activeIndex] : undefined;

  if (!active) {
    return (
      <div
        data-video-frame={timeline.length === 0 ? "empty" : "gap"}
        className={className}
        style={{ width, height, background: "#000", ...style }}
      />
    );
  }

  if (!kit.getTemplate(active.scene.templateId)) {
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
  const transitionEnabled = supportsContinuousTransition(config.style.defaultTransition);
  const next = activeIndex < timeline.length - 1 ? timeline[activeIndex + 1] : undefined;
  const activeTemplate = kit.getTemplate(active.scene.templateId)!;
  const nextTemplate = next ? kit.getTemplate(next.scene.templateId) : undefined;
  const contiguousNext = next && rangesAreContiguous(active, next) ? next : undefined;
  const transitionableNext = contiguousNext &&
    activeTemplate.usesGlobalTransition &&
    activeTemplate.transitionTiming &&
    nextTemplate?.usesGlobalTransition &&
    nextTemplate.transitionTiming
    ? contiguousNext
    : undefined;
  const activeTiming = activeTemplate.transitionTiming;
  const nextTiming = nextTemplate?.transitionTiming;
  const eligibleNextTransition = Boolean(
    transitionEnabled &&
      transitionableNext &&
      activeTiming &&
      nextTiming &&
      sceneBackgroundChanges(active, transitionableNext),
  );
  const blendDuration = Math.min(
    SCENE_TRANSITION_SECONDS,
    Math.max(0, duration),
  );
  const blendStart = active.end - blendDuration;
  const blendEnd = blendStart + blendDuration;

  // Give a backdrop that has to decode a real head start, whether or not the
  // pair also qualifies for a cross-fade: an abrupt cut to an undecoded video
  // looks worse than a blended one, not better.
  // Only a backdrop the next scene does not already have on screen needs the
  // head start. Identical media across a cut is already decoded.
  const prerollsNext = Boolean(
    contiguousNext &&
      sceneHasBackdrop(contiguousNext) &&
      sceneBackgroundChanges(active, contiguousNext),
  );
  const prerollDuration = prerollsNext
    ? Math.min(Math.max(MEDIA_PREROLL_SECONDS, blendDuration), Math.max(0, duration))
    : blendDuration;
  const prerollStart = active.end - prerollDuration;
  // Mobile WebKit can terminate the renderer when two scene-sized video
  // decoders overlap, so never preroll a second video element there.
  const decoderConstrainedTransition = Boolean(
    contiguousNext &&
      decoderConstrainedDevice &&
      sceneHasVideoBackdrop(active) &&
      sceneHasVideoBackdrop(contiguousNext),
  );
  // Decoder ownership cannot depend on future streamed scenes: migrating a
  // live scene from its local element when scene.add arrives would itself
  // create the replacement/overlap this path avoids. Compatible registries
  // therefore use the player plane for every iOS video scene from its first
  // render. One stale or custom video-capable template disables the contract
  // for the whole stable registry, preserving the previous one-local-decoder
  // behavior instead of guessing whether it consumes the shared backdrop.
  const persistentVideoEnabled = decoderConstrainedDevice &&
    registrySupportsExternalVideoBackdrop(kit);
  const activeUsesPersistentVideo = persistentVideoEnabled && sceneHasVideoBackdrop(active);
  const incomingUsesPersistentVideo = Boolean(
    persistentVideoEnabled &&
      contiguousNext &&
      !sceneHasVideoBackdrop(active) &&
      sceneHasVideoBackdrop(contiguousNext) &&
      time >= prerollStart && time < blendEnd,
  );
  const persistentVideoRange = activeUsesPersistentVideo
    ? active
    : incomingUsesPersistentVideo && contiguousNext
      ? contiguousNext
      : undefined;
  const persistentVideoKey = persistentVideoRange
    ? `${persistentVideoRange.scene.id}\0${String(persistentVideoRange.scene.variables.mediaUrl || "")}`
    : undefined;
  const firstVideoRange = timeline.find(sceneHasVideoBackdrop);
  const posterPreparationRange = activeUsesPersistentVideo
    ? contiguousNext && sceneHasVideoBackdrop(contiguousNext)
      ? contiguousNext
      : activeIndex === timeline.length - 1 && firstVideoRange?.scene.id !== active.scene.id
        ? firstVideoRange
        : undefined
    : undefined;
  const preparedReadinessRange = posterPreparationRange ?? (contiguousNext && sceneHasVideoBackdrop(contiguousNext) ? contiguousNext : undefined);
  const preparedPoster = posterPreparationRange && String(
    posterPreparationRange.scene.variables.mediaPoster || "",
  ) ? {
      presentationKey: `${posterPreparationRange.scene.id}\0${String(
        posterPreparationRange.scene.variables.mediaUrl || "",
      )}`,
      mediaPoster: String(posterPreparationRange.scene.variables.mediaPoster),
      mediaPosition: String(posterPreparationRange.scene.variables.mediaPosition || "center"),
      backgroundEffect: posterPreparationRange.scene.backgroundEffect ?? config.style.defaultBackgroundEffect,
    } : undefined;
  const activeMediaFailed = failedMedia.has(sceneReadinessKey(active.scene));
  const persistentVideoFailed = persistentVideoKey !== undefined &&
    failedMedia.has(persistentVideoKey);
  const persistentVideoReady = persistentVideoRange !== undefined && (
    String(persistentVideoRange.scene.variables.mediaPoster || "") !== "" ||
    readyPersistentVideo === persistentVideoKey
  );
  const persistentVideoMode = persistentVideoFailed
    ? "fallback" as const
    : persistentVideoReady ? "ready" as const : "pending" as const;
  const mountingNext = Boolean(
    contiguousNext && !decoderConstrainedTransition &&
      time >= prerollStart && time < blendEnd &&
      (eligibleNextTransition || prerollsNext),
  );
  const previewingNext = Boolean(
    eligibleNextTransition && time >= blendStart && time < blendEnd,
  );
  // Zero until the blend window opens, so every frame before it is unchanged.
  const blendProgress = previewingNext && blendDuration > 0
    ? Math.round(clamp01((time - blendStart) / blendDuration) * 1_000_000) / 1_000_000
    : 0;
  const progress = rawProgress;
  // Body scenes own their complete 0→1 motion lifecycle so they can exit into
  // the next beat. A terminal scene has nowhere to exit to: once it reaches
  // its authored poster pose, hold that pose through the end instead of
  // fading out and then snapping back when playback stops. Raw progress still
  // reaches 1 so semantic values and background playback finish normally.
  const isFinalScene = activeIndex === timeline.length - 1;
  const motionProgress = isFinalScene && activeTiming
    ? Math.min(rawProgress, activeTiming.holdProgress)
    : rawProgress;
  const canvas = getDimensions(config.orientation);
  const scale = Math.min(width / canvas.width, height / canvas.height);
  const canvasLeft = (width - canvas.width * scale) / 2;
  const canvasTop = (height - canvas.height * scale) / 2;

  return (
    <div
      onErrorCapture={(event) => {
        const target = event.target;
        if ((target instanceof HTMLVideoElement || target instanceof HTMLImageElement)
          && target.getAttribute("src") === active.scene.variables.mediaUrl && supportsExternalVideoBackdrop(activeTemplate)
          && (target.closest("[data-layer-scene-id]")?.getAttribute("data-layer-scene-id") === active.scene.id
            || target.closest("[data-persistent-video-scene-id]")?.getAttribute("data-persistent-video-scene-id") === active.scene.id)) {
          markMediaFailed(sceneReadinessKey(active.scene));
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
      <MountedSceneReadiness scene={active.scene} playing={playing}
        fallback={activeMediaFailed}
        onFailure={sceneHasBackdrop(active) && supportsExternalVideoBackdrop(activeTemplate) && !activeMediaFailed
          ? () => markMediaFailed(sceneReadinessKey(active.scene)) : undefined} />
      {preparedReadinessRange && <PreparedSceneReadiness scene={preparedReadinessRange.scene} />}
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
        {persistentVideoRange && !persistentVideoFailed && (
          <div
            data-persistent-video-scene-id={persistentVideoRange.scene.id}
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, zIndex: 0 }}
          >
            <Suspense fallback={String(persistentVideoRange.scene.variables.mediaPoster || "") ? (
              <img
                src={String(persistentVideoRange.scene.variables.mediaPoster)}
                alt=""
                data-video-poster-plane="loading"
                data-video-poster-visible="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: String(persistentVideoRange.scene.variables.mediaPosition || "center"),
                }}
              />
            ) : null}>
              <SceneVideoBackdrop
                mediaUrl={String(persistentVideoRange.scene.variables.mediaUrl || "")}
                mediaPoster={String(persistentVideoRange.scene.variables.mediaPoster || "") || undefined}
                mediaPosition={String(persistentVideoRange.scene.variables.mediaPosition || "center")}
                backgroundEffect={persistentVideoRange.scene.backgroundEffect ?? config.style.defaultBackgroundEffect}
                progress={persistentVideoRange.scene.id === active.scene.id ? rawProgress : 0}
                sceneDuration={persistentVideoRange.end - persistentVideoRange.start}
                isPlaying={persistentVideoRange.scene.id === active.scene.id && playing}
                muted={mediaAudioMuted || persistentVideoRange.scene.id !== active.scene.id || !playing}
                volume={mediaAudioVolume}
                playbackId={persistentVideoRange.scene.id}
                retainPoster
                persistent
                preparedPoster={preparedPoster ? {
                  ...preparedPoster,
                  // The image is already decoded and costs no second video
                  // decoder. Fade it above the outgoing video using the same
                  // authored transition clock, then reuse that exact DOM image
                  // as the new source's underlay at the cut.
                  opacity: decoderConstrainedTransition ? blendProgress : 0,
                } : undefined}
                onReady={() => setReadyPersistentVideo(persistentVideoKey)}
                onError={() => markMediaFailed(persistentVideoKey)}
              />
            </Suspense>
          </div>
        )}
        {(
          mountingNext && contiguousNext
            ? [
            <SceneLayer
              key={active.scene.id}
              onFramePresented={onFramePresented}
              kit={kit}
              config={config}
              range={active}
              progress={progress}
              motionProgress={motionProgress}
              width={canvas.width}
              height={canvas.height}
              playing={playing}
              mediaAudioMuted={mediaAudioMuted}
              mediaAudioVolume={mediaAudioVolume}
              // Only a blend makes this scene "outgoing". During a preroll it
              // is still the scene on screen, fully opaque and interactive —
              // the layer beside it is invisible and only there to decode.
              layer={previewingNext ? "outgoing" : "active"}
              opacity={1 - blendProgress}
              interactive
              zIndex={1}
              externalVideoBackdrop={activeMediaFailed ? "fallback" : persistentVideoRange?.scene.id === active.scene.id
                ? persistentVideoMode
                : false}
            />,
            <SceneLayer
              key={contiguousNext.scene.id}
              kit={kit}
              config={config}
              range={contiguousNext}
              progress={0}
              motionProgress={0}
              width={canvas.width}
              height={canvas.height}
              playing={false}
              mediaAudioMuted={mediaAudioMuted}
              mediaAudioVolume={mediaAudioVolume}
              layer="incoming"
              opacity={blendProgress}
              interactive={false}
              zIndex={2}
              externalVideoBackdrop={persistentVideoRange?.scene.id === contiguousNext.scene.id
                ? persistentVideoMode
                : false}
            />,
          ]
            : [
          <SceneLayer
            key={active.scene.id}
            onFramePresented={onFramePresented}
            kit={kit}
            config={config}
            range={active}
            progress={progress}
            motionProgress={motionProgress}
            width={canvas.width}
            height={canvas.height}
            playing={playing}
            mediaAudioMuted={mediaAudioMuted}
            mediaAudioVolume={mediaAudioVolume}
            layer="active"
            opacity={1}
            interactive
            zIndex={1}
            externalVideoBackdrop={activeMediaFailed ? "fallback" : persistentVideoRange?.scene.id === active.scene.id
              ? persistentVideoMode
              : false}
          />,
        ])}
      </div>
    </div>
  );
}
