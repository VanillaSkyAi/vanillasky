import type { VideoScene } from "../protocol/types.js";
import { preloadBuiltinTemplate } from "../visual-system/catalog/builtin-player.js";
import { prepareSceneMedia } from "../player/prepare-scene-media.js";
import { warmSceneMedia } from "../player/warm-scene-media.js";
import { recoverSceneMedia } from "../player/recover-scene-media.js";
import { prepareNarratedScene } from "../player/scene-readiness.js";
import { VideoError } from "../player/video-error.js";
import { sanitizeVideoChatMedia } from "./media.js";
import { withDeadline } from "./deadline.js";
import { MEDIA_RECOVERY_NOTICE } from "./recovery.js";
import type { VideoChatVoice } from "./voice.js";

/** One turn owns its bounded speech queue and optional media preflight. */
export function createScenePreparation(options: {
  voice: () => VideoChatVoice;
  customVoice: boolean;
  signal: AbortSignal;
  onVoiceUnavailable: (text: string) => void;
  warn: (message: string) => void;
  onDuration?: (value: { speechDurationSec: number; clipDurationSec: number; recovered: boolean }) => void;
}) {
  const speechLoads = new Map<string, Promise<Awaited<ReturnType<VideoChatVoice["prepare"]>>>>();
  const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  const announced = new Set<string>();
  const announcedMedia = new Set<string>();
  let nextLane = 0;
  let customVoiceFailed = false;
  const prepareSpeech = (text: string, signal = options.signal) => {
    const cached = speechLoads.get(text);
    if (cached) return cached;
    const lane = nextLane++ % lanes.length;
    const prepared = lanes[lane]!.then(async () => {
      signal.throwIfAborted();
      try {
        if (customVoiceFailed) throw new Error("Voice preparation did not respond");
        return options.customVoice
          ? await withDeadline(child => options.voice().prepare(text, { signal: child }), 3_000, signal)
          : await options.voice().prepare(text, { signal });
      } catch (cause) {
        if (options.customVoice && !signal.aborted && !options.signal.aborted) {
          options.onVoiceUnavailable(text);
          if (cause instanceof DOMException && cause.name === "TimeoutError") customVoiceFailed = true;
        }
        throw cause;
      }
    });
    speechLoads.set(text, prepared);
    lanes[lane] = prepared.catch(() => undefined);
    return prepared;
  };
  const announce = (value: unknown) => {
    if (options.signal.aborted || !value || typeof value !== "object" || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    if (typeof data.sceneId !== "string" || !data.sceneId || data.sceneId.length > 200
      || typeof data.narration !== "string" || !data.narration.trim() || data.narration.length > 2_000
      || (!announced.has(data.sceneId) && announced.size >= 32)) return;
    announced.add(data.sceneId);
    if (speechLoads.size < 32 || speechLoads.has(data.narration.trim())) void prepareSpeech(data.narration.trim()).catch(() => undefined);
    // A preparation event can warm bytes, never create a playable scene. Only
    // validated ordered scene.add data enters the timeline.
    const media = sanitizeVideoChatMedia(data.media);
    if (media && !announcedMedia.has(data.sceneId)) {
      announcedMedia.add(data.sceneId);
      warmSceneMedia({ mediaUrl: media.url, mediaType: media.type === "image" ? "photo" : "video", mediaPoster: media.posterUrl }, options.signal);
    }
  };
  const prepareVisual = (scene: VideoScene): Promise<VideoScene> => {
    warmSceneMedia(scene.variables, options.signal);
    const prepared = Promise.resolve(preloadBuiltinTemplate(scene.templateId)).then(async () => {
      try { await prepareSceneMedia(scene.variables, options.signal); return scene; }
      catch (cause) {
        if (options.signal.aborted) throw cause;
        const recovered = recoverSceneMedia(scene);
        if (!recovered) throw new VideoError("Scene could not prepare its visual", { code: "media_not_ready" });
        options.warn(MEDIA_RECOVERY_NOTICE);
        return recovered;
      }
    });
    void prepared.catch(() => undefined);
    return prepared;
  };
  const pace = (scene: VideoScene, seconds: number | undefined, measured: boolean): VideoScene => {
    const prepared = prepareNarratedScene(scene, seconds, measured);
    if (prepared.recovered) options.warn(MEDIA_RECOVERY_NOTICE);
    if (seconds !== undefined && prepared.clipDurationSec !== undefined) {
      try { options.onDuration?.({ speechDurationSec: seconds, clipDurationSec: prepared.clipDurationSec, recovered: prepared.recovered }); }
      catch { /* Diagnostics cannot affect playback. */ }
    }
    return prepared.scene;
  };
  return { prepareSpeech, announce, prepareVisual, pace };
}
