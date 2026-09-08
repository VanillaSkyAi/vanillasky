/** Host-resolved footage on black, with no decorative layers over the picture. */
import { useEffect, useState } from "react";
import { resolveMediaType } from "./media-source";
import { useExternalVideoBackdrop } from "./external-video-backdrop";
import { resolveMediaPosition } from "./media-position";
import { SceneVideoBackdrop } from "./scene-video-backdrop";

export { SceneVideoBackdrop } from "./scene-video-backdrop";

export function getMediaBackgroundProps(variables: Record<string, unknown>) {
  return {
    mediaUrl: String(variables.mediaUrl || ""),
    mediaType: String(variables.mediaType || "auto"),
    mediaPoster: String(variables.mediaPoster || ""),
    mediaPosition: String(variables.mediaPosition || "center"),
    measuredSpeechDurationSec: typeof variables.measuredSpeechDurationSec === "number" && Number.isFinite(variables.measuredSpeechDurationSec) && variables.measuredSpeechDurationSec > 0
      ? variables.measuredSpeechDurationSec : undefined,
  };
}

export interface SceneBackgroundProps {
  progress: number;
  sceneDuration?: number;
  measuredSpeechDurationSec?: number;
  mediaUrl?: string;
  mediaType?: string;
  mediaPoster?: string;
  mediaPosition?: string;
  isPlaying?: boolean;
}

export function SceneBackground({
  progress, sceneDuration, measuredSpeechDurationSec, mediaUrl = "", mediaType = "auto",
  mediaPoster, mediaPosition = "center", isPlaying = true,
}: SceneBackgroundProps) {
  const resolved = resolveMediaType(mediaType, mediaUrl);
  const wantsMedia = resolved !== "gradient" && !!mediaUrl;
  const backdrop = useExternalVideoBackdrop();
  const external = backdrop !== false && resolved === "video";
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    if (!wantsMedia || resolved !== "photo" || typeof Image === "undefined") return;
    let cancelled = false;
    const probe = new Image();
    const fail = () => { if (!cancelled) setFailedUrl(mediaUrl); };
    probe.onerror = fail;
    probe.src = mediaUrl;
    if (probe.complete && probe.naturalWidth === 0) fail();
    return () => { cancelled = true; probe.onerror = null; };
  }, [mediaUrl, resolved, wantsMedia]);

  return <>
    {(!external || backdrop === "fallback") && <div data-scene-background="black"
      style={{ position: "absolute", inset: 0, background: "#000", pointerEvents: "none" }} />}
    {wantsMedia && failedUrl !== mediaUrl && !external && (resolved === "video"
      ? <SceneVideoBackdrop mediaUrl={mediaUrl} mediaPoster={mediaPoster} mediaPosition={mediaPosition}
          progress={progress} sceneDuration={sceneDuration} measuredSpeechDurationSec={measuredSpeechDurationSec} isPlaying={isPlaying}
          onError={() => setFailedUrl(mediaUrl)} />
      : <img src={mediaUrl} alt="" aria-hidden="true" draggable={false} data-media-position={mediaPosition}
          onError={() => setFailedUrl(mediaUrl)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            objectPosition: resolveMediaPosition(mediaPosition) }} />)}
  </>;
}
