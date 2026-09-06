/**
 * Shared photo/video backdrop for built-in and customer-owned templates.
 * Media is host-resolved; this component never searches or generates assets.
 * The base is fixed black. Photos and videos cover it when available, and
 * optional scrims appear only once the media can paint. The cinematic built-ins
 * request no scrim; custom templates can choose a treatment and text anchor.
 * The retained internal "gradient" media sentinel selects the black base and
 * ignores mediaUrl. It is not a built-in authoring mode or brand-color control.
 * Video playback can be owned by the player's persistent external backdrop.
 */

import React, { useEffect, useState } from "react";
import {
  hasSceneMedia,
  resolveMediaType,
  type ResolvedMediaType,
} from "./media-source";
import type { TemplateStyle } from "../template-context";
import { BrandGradientOverlay } from "../backgrounds";
import { getBackgroundTransform } from "../backgrounds";
import { useExternalVideoBackdrop } from "./external-video-backdrop";
import { resolveMediaPosition, type MediaPosition } from "./media-position";
import { SceneVideoBackdrop } from "./scene-video-backdrop";

export { hasSceneMedia, resolveMediaType };
export { resolveMediaPosition } from "./media-position";
export { SceneVideoBackdrop } from "./scene-video-backdrop";
export type { ResolvedMediaType };

export type { MediaPosition };
export type MediaTreatment = "none" | "subtle" | "cinematic" | "text-safe";

export function resolveMediaTreatment(value: string): MediaTreatment {
  return value === "none" || value === "subtle" || value === "text-safe" ? value : "cinematic";
}

export interface MediaTreatmentLayer {
  id: "vignette" | "center-scrim" | "bottom-scrim";
  background: string;
  style?: React.CSSProperties;
}

/**
 * Where the template puts its type. The scrim is shaped to the copy, not to
 * the frame: darkening picture the type never touches costs contrast in the
 * photo and buys no legibility. "full" is the conservative default for
 * templates that have not declared an anchor.
 */
export type MediaTextAnchor = "center" | "bottom" | "full";

/**
 * Smoothstep-sampled alpha stops between `start`% and `end`% of the gradient
 * box, held at full strength before `start` and after `end`.
 *
 * A two-stop `rgba(0,0,0,a) → transparent` scrim ramps alpha linearly, so it
 * ends with a constant slope. Lateral inhibition in the eye amplifies that
 * slope discontinuity into a visible band — the grey bar cutting across the
 * frame that makes an overlay read as an overlay. Smoothstep flattens the
 * curve at both ends, so the scrim holds where the type sits and then leaves
 * without an edge: the same peak coverage over the copy, noticeably less of
 * the picture spent getting there.
 */
const SCRIM_STOP_COUNT = 7;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function easedStops(
  peakAlpha: number,
  start: number,
  end: number,
  direction: "fade-out" | "fade-in",
): string {
  const alphaAt = (t: number): string => {
    const eased = direction === "fade-out" ? 1 - smoothstep(t) : smoothstep(t);
    return `rgba(0,0,0,${Number((peakAlpha * eased).toFixed(3))})`;
  };
  const stops: string[] = [];
  if (start > 0) stops.push(`${alphaAt(0)} 0%`);
  for (let i = 0; i < SCRIM_STOP_COUNT; i += 1) {
    const t = i / (SCRIM_STOP_COUNT - 1);
    const position = Number((start + (end - start) * t).toFixed(2));
    stops.push(`${alphaAt(t)} ${position}%`);
  }
  if (end < 100) stops.push(`${alphaAt(1)} 100%`);
  return stops.join(", ");
}

/**
 * Export-safe contrast recipes. Overlays only: SVG capture cannot rely on CSS
 * filters, so a blur-behind-text plate is off the table.
 *
 * The scrims deliberately stop short of solving legibility on their own. A
 * uniform darkening strong enough to carry white type over a blown-out sky
 * needs roughly 0.8 alpha — at that point the photo is a texture, not a
 * picture. The cheaper half of the job belongs to the type: a per-glyph halo
 * (MEDIA_TEXT_SHADOW) buys local contrast exactly where it is needed and
 * costs the image nothing. Scrim for the plate, halo for the glyph.
 */
export function getMediaTreatmentLayers(
  value: string,
  anchor: MediaTextAnchor = "full",
): MediaTreatmentLayer[] {
  const treatment = resolveMediaTreatment(value);
  // Nothing over the picture at all. Every other treatment exists to carry
  // type across a photograph; where the scene has no type - a generated clip
  // that is the whole point of the beat - even a vignette is something the
  // viewer did not ask to look through.
  if (treatment === "none") return [];
  const vignette: MediaTreatmentLayer = {
    id: "vignette",
    background:
      treatment === "subtle"
        ? `radial-gradient(ellipse at center, ${easedStops(0.28, 45, 100, "fade-in")})`
        : `radial-gradient(ellipse at center, ${easedStops(0.72, 32, 100, "fade-in")})`,
  };
  if (treatment === "subtle") return [vignette];

  const textSafe = treatment === "text-safe";
  const layers: MediaTreatmentLayer[] = [vignette];

  if (anchor !== "bottom") {
    layers.push({
      id: "center-scrim",
      background: textSafe
        ? `radial-gradient(ellipse 92% 58% at 50% 50%, ${easedStops(0.46, 34, 90, "fade-out")})`
        : `radial-gradient(ellipse 88% 52% at 50% 50%, ${easedStops(0.26, 30, 88, "fade-out")})`,
    });
  }

  if (anchor !== "center") {
    layers.push({
      id: "bottom-scrim",
      background: `linear-gradient(to top, ${easedStops(textSafe ? 0.64 : 0.5, 8, 100, "fade-out")})`,
      style: { top: "55%" },
    });
  }

  return layers;
}

/**
 * Whether the backdrop is actually painting, which is what decides if a scrim
 * is earned. "pending" is a browser-only state: static and export renders
 * never run effects and never wait on a network, so they start (and stay)
 * ready and their output is unchanged.
 */
type MediaPaintState = "pending" | "ready" | "failed";

function initialMediaPaint(
  wantsMedia: boolean,
  resolved: ResolvedMediaType,
  mediaUrl: string,
  mediaPoster: string | undefined,
): MediaPaintState {
  if (typeof window === "undefined") return "ready";
  if (!wantsMedia) return "ready";
  // A poster paints the video's frame immediately, so the scene is already
  // showing footage even though the stream is still decoding.
  if (resolved === "video") return mediaPoster ? "ready" : "pending";
  if (typeof Image === "undefined") return "ready";
  // Preloaded or browser-cached media decodes synchronously. Reporting it
  // ready on the first render keeps the common mid-playback case free of a
  // black-then-photo flicker.
  const cached = new Image();
  cached.src = mediaUrl;
  return cached.complete && cached.naturalWidth > 0 ? "ready" : "pending";
}

export function getMediaBackgroundProps(variables: Record<string, unknown>) {
  return {
    mediaUrl: String(variables.mediaUrl || ""),
    mediaType: String(variables.mediaType || "auto"),
    mediaPoster: String(variables.mediaPoster || ""),
    mediaPosition: String(variables.mediaPosition || "center"),
    mediaTreatment: String(variables.mediaTreatment || "cinematic"),
  };
}

export interface SceneBackgroundProps {
  style: TemplateStyle;
  progress: number;
  sceneDuration?: number;
  width: number;
  height: number;
  mediaUrl?: string;
  mediaType?: string;
  /** Still image URL shown while the <video> backdrop decodes its first
   *  frame. Without it the element renders transparent during the
   *  decode window and the black base shows through. */
  mediaPoster?: string;
  /** Cover-crop focal anchor. Keeps the important edge/subject visible. */
  mediaPosition?: string;
  /** Overlay recipe: subtle, cinematic, or stronger text-safe contrast. */
  mediaTreatment?: string;
  /** Where this template's copy sits, so the scrim is shaped to the type
   *  instead of to the frame. Defaults to "full" (scrim both the middle and
   *  the lower third) for templates that have not declared an anchor. */
  textAnchor?: MediaTextAnchor;
  /** Background motion effect (drift / pulse / Ken Burns). Applied to the photo/video. */
  backgroundEffect?: string;
  /** Retained seed input for customer-owned backdrop compositions. */
  seed?: number | string;
  /** Pause video when preview is paused. Defaults to true (export path). */
  isPlaying?: boolean;
  beatIntensity?: number;
}

export const SceneBackground: React.FC<SceneBackgroundProps> = ({
  style,
  progress,
  sceneDuration,
  width: _width, // accepted for symmetry; not currently used in render
  height: _height,
  mediaUrl = "",
  mediaType = "auto",
  mediaPoster,
  mediaPosition = "center",
  mediaTreatment = "cinematic",
  textAnchor = "full",
  backgroundEffect,
  seed,
  isPlaying = true,
  beatIntensity = 0,
}) => {
  void _width;
  void _height;
  const resolved = resolveMediaType(mediaType, mediaUrl);
  const wantsMedia = resolved !== "gradient" && !!mediaUrl;
  const externalVideoBackdrop = useExternalVideoBackdrop();
  const hasExternalVideoBackdrop = externalVideoBackdrop !== false && resolved === "video";
  const externalVideoFailed = externalVideoBackdrop === "fallback" && resolved === "video";
  const externalVideoReady = externalVideoBackdrop === "ready" && resolved === "video";

  // Apply picture and scrim together. A loading or failed asset keeps the
  // fixed black base instead of painting contrast treatment over empty media.
  const [mediaPaint, setMediaPaint] = useState<MediaPaintState>(() =>
    initialMediaPaint(wantsMedia, resolved, mediaUrl, mediaPoster),
  );
  useEffect(() => {
    setMediaPaint(initialMediaPaint(wantsMedia, resolved, mediaUrl, mediaPoster));
    // Video reports its own paint through onLoadedData / onError below.
    if (!wantsMedia || resolved !== "photo") return;
    if (typeof Image === "undefined") return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) setMediaPaint("ready");
    };
    probe.onerror = () => {
      if (!cancelled) setMediaPaint("failed");
    };
    probe.src = mediaUrl;
    if (probe.complete) setMediaPaint(probe.naturalWidth > 0 ? "ready" : "failed");
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [mediaUrl, mediaPoster, resolved, wantsMedia]);

  // The element stays mounted while pending — that is what loads it. Only a
  // confirmed failure takes it back out.
  const showMedia = wantsMedia && mediaPaint !== "failed";
  const showTreatment = wantsMedia && mediaPaint === "ready";
  const resolvedPosition = resolveMediaPosition(mediaPosition);
  const resolvedTreatment = resolveMediaTreatment(mediaTreatment);
  const treatmentLayers = getMediaTreatmentLayers(resolvedTreatment, textAnchor);

  const gradSeed =
    typeof seed === "number"
      ? seed
      : typeof seed === "string"
        ? seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
        : 0;

  const bgTransform = getBackgroundTransform(
    backgroundEffect,
    progress,
    beatIntensity,
  );

  return (
    <>
      {(!hasExternalVideoBackdrop || externalVideoFailed) && (
        <BrandGradientOverlay
          style={style}
          progress={progress}
          sceneDuration={sceneDuration}
          seed={gradSeed}
        />
      )}

      {showMedia && !hasExternalVideoBackdrop &&
        (resolved === "video" ? (
          <SceneVideoBackdrop
            mediaUrl={mediaUrl}
            mediaPoster={mediaPoster}
            mediaPosition={mediaPosition}
            backgroundEffect={backgroundEffect}
            progress={progress}
            sceneDuration={sceneDuration}
            beatIntensity={beatIntensity}
            isPlaying={isPlaying}
            onReady={() => setMediaPaint("ready")}
            onError={() => setMediaPaint("failed")}
          />
        ) : (
          <img
            src={mediaUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-media-position={mediaPosition}
            style={{
              position: "absolute",
              inset: 0,
              transform: bgTransform.transform,
              transformOrigin: bgTransform.transformOrigin,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: resolvedPosition,
            }}
          />
        ))}

      {(hasExternalVideoBackdrop ? externalVideoReady : showTreatment) && !externalVideoFailed &&
        treatmentLayers.map((layer) => (
          <div
            key={layer.id}
            data-media-treatment={resolvedTreatment}
            data-media-overlay={layer.id}
            style={{
              position: "absolute",
              inset: 0,
              background: layer.background,
              pointerEvents: "none",
              ...layer.style,
            }}
          />
        ))}
    </>
  );
};
